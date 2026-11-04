import { AnimatePresence, motion } from "framer-motion";
import { forwardRef, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BOARDS } from "../theme";
import type { BoardAction, BoardItem, BoardPage } from "../types";

const W = 800, H = 500, PAD = 24;
let uid = 1;

export interface BoardHandle {
  apply(a: BoardAction): void; clear(): void; newPage(): void; undo(): void; redo(): void;
  prevPage(): void; getPages(): BoardPage[]; load(p: BoardPage[]): void; hasContent(): boolean;
}

const wrap = (s: string, n: number) => {
  const out: string[] = []; let cur = "";
  for (const w of s.split(/\s+/)) { if ((cur + " " + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) out.push(cur);
  return out.length ? out : [""];
};

/** Wraps text into lines, remembering character offsets so parts of a sentence can be colour-coded. */
function wrapOff(s: string, n: number): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = []; let start = 0, last = 0, pos = 0;
  for (const w of s.split(/(\s+)/)) {
    if (!/\S/.test(w)) { pos += w.length; continue; }
    if (pos + w.length - start > n && last > start) { out.push({ s: start, e: last }); start = pos; }
    pos += w.length; last = pos;
  }
  if (last > start) out.push({ s: start, e: last });
  return out;
}
/** colour index per character: each listed part gets its own colour (first occurrence, in order). */
function colorMap(text: string, parts: string[]): number[] {
  const m = Array(text.length).fill(-1); let from = 0;
  parts.forEach((p, k) => { const i = text.indexOf(p, from); if (i >= 0) { for (let j = i; j < i + p.length; j++) m[j] = k; from = i + p.length; } });
  return m;
}

function heightOf(a: BoardAction): number {
  switch (a.type) {
    case "definition": return 64 + wrapOff(a.text, 54).length * 30;
    case "heading": return 56;
    case "text": return 12 + wrap(a.text, 56).length * 30;
    case "formula": return 78;
    case "dots": return 96;
    case "table": return 20 + (a.rows.length + 1) * 32;
    case "code": return 24 + a.lines.length * 25;
    case "flow": return 100;
    case "compare": return 64 + Math.max(a.left.items.length, a.right.items.length) * 30;
    case "shape": return 110;
    case "output": return 36 + a.lines.length * 24;
    default: return 0;
  }
}

function inkColor(c: string | undefined, ink: string, light: boolean) {
  const m: Record<string, string> = light
    ? { white: ink, yellow: "#b45309", pink: "#be185d", blue: "#1d4ed8", green: "#15803d" }
    : { white: ink, yellow: "#fde68a", pink: "#f9a8d4", blue: "#93c5fd", green: "#86efac" };
  return m[c ?? "white"] ?? ink;
}

function Reveal({ id, animate, dur, children }: { id: number; animate: boolean; dur: number; children: React.ReactNode }) {
  if (!animate) return <g>{children}</g>;
  return (
    <g clipPath={`url(#c${id})`}>
      <defs><clipPath id={`c${id}`}><motion.rect x={0} y={0} height={H} initial={{ width: 0 }} animate={{ width: W }} transition={{ duration: dur, ease: "easeOut" }} /></clipPath></defs>
      {children}
    </g>
  );
}

function Action({ a, y, theme }: { a: BoardAction; y: number; theme: { ink: string; light: boolean } }) {
  const { ink, light } = theme;
  const mono = "Consolas, 'Courier New', monospace";
  const hand = "'Segoe Print','Bradley Hand','Comic Sans MS',cursive";
  switch (a.type) {
    case "heading": return (<g><text x={PAD} y={y + 36} fontSize={32} fontWeight={800} fontFamily={hand} fill={inkColor(a.color ?? "yellow", ink, light)}>{a.text}</text><line x1={PAD} x2={Math.min(W - PAD, PAD + a.text.length * 19 + 20)} y1={y + 46} y2={y + 46} stroke={inkColor("yellow", ink, light)} strokeWidth={3} strokeLinecap="round" /></g>);
    case "text": return (<g>{wrap(a.text, 56).map((l, i) => <text key={i} x={PAD} y={y + 28 + i * 30} fontSize={22} fontFamily={hand} fill={inkColor(a.color, ink, light)}>{l}</text>)}</g>);
    case "definition": {
      const lines = wrapOff(a.text, 54), map = colorMap(a.text, a.parts ?? []), cols = ["yellow", "pink", "blue", "green", "white"];
      return (<g>
        <rect x={PAD} y={y + 4} width={W - 2 * PAD} height={64 + lines.length * 30 - 12} rx={14} fill={ink} fillOpacity={0.07} stroke={inkColor("yellow", ink, light)} strokeWidth={2} />
        <text x={PAD + 16} y={y + 28} fontSize={14} fontWeight={800} fill={inkColor("yellow", ink, light)} fontFamily={hand}>DEFINITION — from your book</text>
        {lines.map((ln, li) => {
          const segs: { t: string; c: number }[] = [];
          for (let i = ln.s; i < ln.e; i++) { const c = map[i]; if (segs.length && segs[segs.length - 1].c === c) segs[segs.length - 1].t += a.text[i]; else segs.push({ t: a.text[i], c }); }
          return <text key={li} x={PAD + 16} y={y + 58 + li * 30} fontSize={21} fontFamily={hand} fill={ink} xmlSpace="preserve" style={{ whiteSpace: "pre" }}>
            {segs.map((sg, k) => sg.c < 0 ? <tspan key={k}>{sg.t}</tspan> : <tspan key={k} fill={inkColor(cols[sg.c % 5], ink, light)} fontWeight={700} textDecoration="underline">{sg.t}</tspan>)}</text>;
        })}</g>);
    }
    case "formula": {
      const i = a.hl ? a.text.indexOf(a.hl) : -1;
      const w = Math.min(W - 2 * PAD, a.text.length * 21 + 40);
      return (<g><rect x={(W - w) / 2} y={y + 6} width={w} height={62} rx={14} fill="none" stroke={inkColor("blue", ink, light)} strokeWidth={2} strokeDasharray="6 5" />
        <text x={W / 2} y={y + 49} fontSize={34} textAnchor="middle" fontFamily="Cambria, 'Times New Roman', serif" fontStyle="italic" fill={ink}>
          {i >= 0 ? (<><tspan>{a.text.slice(0, i)}</tspan><tspan fill={inkColor("yellow", ink, light)} fontWeight={800} textDecoration="underline">{a.hl}</tspan><tspan>{a.text.slice(i + a.hl!.length)}</tspan></>) : a.text}
        </text></g>);
    }
    case "dots": {
      const total = a.groups.reduce((s, n) => s + n, 0);
      const step = Math.min(38, 560 / Math.max(total + a.groups.length, 1));
      let x = PAD + 20;
      const els: React.ReactNode[] = []; const cols = ["#f9a8d4", "#93c5fd", "#86efac", "#fde68a"];
      a.groups.forEach((n, gi) => {
        if (gi > 0) { els.push(<text key={`o${gi}`} x={x + 6} y={y + 52} fontSize={36} fill={ink} fontFamily="Georgia,serif">{a.op}</text>); x += 46; }
        for (let k = 0; k < n; k++) els.push(<circle key={`${gi}-${k}`} cx={x + k * step + 14} cy={y + 44} r={Math.min(15, step / 2.4)} fill={cols[gi % 4]} stroke={ink} strokeWidth={1.5} />);
        els.push(<text key={`n${gi}`} x={x + (n * step) / 2} y={y + 86} fontSize={20} textAnchor="middle" fill={ink} fontFamily={hand}>{n}</text>);
        x += n * step + 16;
      });
      const res = a.result ?? (a.op === "+" ? total : null);
      if (res !== null && a.groups.length > 1) els.push(<text key="res" x={x + 6} y={y + 54} fontSize={36} fontWeight={800} fill={inkColor("yellow", ink, light)} fontFamily="Georgia,serif">= {res}</text>);
      return <g>{els}</g>;
    }
    case "table": {
      const cols = Math.max(a.headers.length, ...a.rows.map((r) => r.length), 1);
      const cw = Math.min(170, (W - 2 * PAD) / cols);
      const all = [a.headers, ...a.rows];
      return (<g>{all.map((row, ri) => Array.from({ length: cols }).map((_, ci) => (
        <g key={`${ri}-${ci}`}><rect x={PAD + ci * cw} y={y + 10 + ri * 32} width={cw} height={32} fill={ri === 0 ? inkColor("blue", ink, light) : "none"} fillOpacity={ri === 0 ? 0.22 : 0} stroke={ink} strokeOpacity={0.6} />
          <text x={PAD + ci * cw + cw / 2} y={y + 32 + ri * 32} fontSize={15} textAnchor="middle" fontWeight={ri === 0 ? 800 : 400} fill={ink} fontFamily={hand}>{(row[ci] ?? "").slice(0, Math.floor(cw / 8.5))}</text></g>)))}</g>);
    }
    case "code": return (<g>
      <rect x={PAD} y={y + 4} width={W - 2 * PAD} height={a.lines.length * 25 + 16} rx={12} fill="#0b1020" stroke="#334155" />
      {a.hl && <rect x={PAD + 4} y={y + 12 + (a.hl - 1) * 25} width={W - 2 * PAD - 8} height={24} rx={6} fill="#fde68a" opacity={0.2} />}
      {a.lines.map((l, i) => (<g key={i}><text x={PAD + 14} y={y + 29 + i * 25} fontSize={15} fill="#64748b" fontFamily={mono}>{i + 1}</text><text x={PAD + 46} y={y + 29 + i * 25} fontSize={18} fill="#e2e8f0" fontFamily={mono} xmlSpace="preserve" style={{ whiteSpace: "pre" }}>{l}</text></g>))}
    </g>);
    case "flow": {
      const n = Math.max(a.nodes.length, 1); const gap = 38; const bw = Math.min(160, (W - 2 * PAD - gap * (n - 1)) / n);
      const total = n * bw + (n - 1) * gap; const x0 = (W - total) / 2;
      return (<g>{a.nodes.map((t, i) => {
        const x = x0 + i * (bw + gap); const lines = wrap(t, Math.max(8, Math.floor(bw / 9)));
        return (<g key={i}><rect x={x} y={y + 14} width={bw} height={64} rx={14} fill={inkColor(["blue", "pink", "green", "yellow"][i % 4], ink, light)} fillOpacity={0.18} stroke={inkColor(["blue", "pink", "green", "yellow"][i % 4], ink, light)} strokeWidth={2} />
          {lines.slice(0, 3).map((l, k) => <text key={k} x={x + bw / 2} y={y + 46 + (k - (Math.min(lines.length, 3) - 1) / 2) * 17} textAnchor="middle" fontSize={14} fill={ink} fontFamily={hand}>{l}</text>)}
          {i < n - 1 && <g stroke={ink} strokeWidth={3} strokeLinecap="round" fill="none"><line x1={x + bw + 6} x2={x + bw + gap - 8} y1={y + 46} y2={y + 46} /><path d={`M${x + bw + gap - 16} ${y + 38} l9 8 l-9 8`} /></g>}</g>);
      })}</g>);
    }
    case "compare": return (<g>{[a.left, a.right].map((s, si) => {
      const x = si === 0 ? PAD + 10 : W / 2 + 20;
      return (<g key={si}><text x={x} y={y + 32} fontSize={26} fontWeight={800} fontFamily={hand} fill={inkColor(si ? "pink" : "blue", ink, light)}>{s.title}</text>
        <line x1={x} x2={x + 300} y1={y + 42} y2={y + 42} stroke={inkColor(si ? "pink" : "blue", ink, light)} strokeWidth={2.5} />
        {s.items.map((it, i) => <text key={i} x={x} y={y + 74 + i * 30} fontSize={20} fontFamily={hand} fill={ink}>• {it}</text>)}</g>);
    })}<line x1={W / 2} x2={W / 2} y1={y + 10} y2={y + heightOf(a) - 10} stroke={ink} strokeOpacity={0.5} strokeDasharray="5 6" /></g>);
    case "shape": return (<g>
      {a.shape === "circle" && <circle cx={W / 2} cy={y + 52} r={42} fill="none" stroke={inkColor("pink", ink, light)} strokeWidth={3} />}
      {a.shape === "rect" && <rect x={W / 2 - 80} y={y + 16} width={160} height={72} rx={12} fill="none" stroke={inkColor("blue", ink, light)} strokeWidth={3} />}
      {a.shape === "arrow" && <g stroke={inkColor("yellow", ink, light)} strokeWidth={4} fill="none" strokeLinecap="round"><line x1={W / 2 - 80} x2={W / 2 + 70} y1={y + 52} y2={y + 52} /><path d={`M${W / 2 + 52} ${y + 36} l20 16 l-20 16`} /></g>}
      <text x={W / 2} y={y + 58} textAnchor="middle" fontSize={20} fontFamily={hand} fill={ink}>{a.label}</text></g>);
    case "output": return (<g>
      <text x={PAD} y={y + 22} fontSize={16} fontWeight={800} fill={inkColor("green", ink, light)} fontFamily={hand}>Output:</text>
      <rect x={PAD + 70} y={y + 4} width={260} height={a.lines.length * 24 + 14} rx={8} fill="#04130b" stroke="#16a34a" />
      {a.lines.map((l, i) => <text key={i} x={PAD + 84} y={y + 28 + i * 24} fontSize={17} fill="#86efac" fontFamily={mono}>{l}</text>)}</g>);
    default: return null;
  }
}

export function PageSvg({ page, theme, animate, fresh = 0 }: { page: BoardPage; theme: string; animate: boolean; fresh?: number }) {
  const t = BOARDS[theme] ?? BOARDS.green; const light = theme === "white";
  const items = page.items;
  return (
    <>
      <rect width={W} height={H} fill={t.bg} />
      {items.map((it) => {
        const isNew = animate && it.id > fresh;
        if (it.kind === "stroke") {
          const d = it.points!.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
          return <path key={it.id} d={d + (it.points!.length === 1 ? " l0.1 0" : "")} stroke={it.color} strokeWidth={it.width} strokeOpacity={it.hl ? 0.38 : 1} fill="none" strokeLinecap="round" strokeLinejoin="round" />;
        }
        return <Reveal key={it.id} id={it.id} animate={isNew} dur={Math.min(1.6, 0.5 + it.h / 120)}><Action a={it.action!} y={it.y} theme={{ ink: t.ink, light }} /></Reveal>;
      })}
    </>
  );
}

const svgWrap = (inner: string, bg: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}" style="background:${bg}">${inner}</svg>`;
function pageToPng(page: BoardPage, theme: string): Promise<string> {
  const markup = svgWrap(renderToStaticMarkup(<PageSvg page={page} theme={theme} animate={false} />), BOARDS[theme]?.bg ?? "#000");
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2; c.getContext("2d")!.drawImage(img, 0, 0); res(c.toDataURL("image/png")); };
    img.onerror = () => rej(new Error("Could not render board image"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
  });
}

type Tool = "pen" | "highlighter" | "eraser";
const INKS = ["#fde68a", "#f9a8d4", "#93c5fd", "#86efac", "#f4f1e8", "#ef4444"];

interface Props { theme: string; lowPower?: boolean; readOnly?: boolean; initial?: BoardPage[]; onSave?: (pages: BoardPage[]) => void; onChange?: () => void; toolbarExtra?: React.ReactNode }

export const Board = forwardRef<BoardHandle, Props>(function Board({ theme, lowPower, readOnly, initial, onSave, onChange, toolbarExtra }, ref) {
  const S = useRef({ pages: initial?.length ? initial : [{ items: [], cursor: 12 }] as BoardPage[], idx: 0, undo: [] as string[], redo: [] as string[], freshAfter: 0 });
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [tool, setTool] = useState<Tool>("pen"); const [ink, setInk] = useState(INKS[0]);
  const [zoom, setZoom] = useState(1); const [live, setLive] = useState<[number, number][] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null); const svgRef = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState("");
  const [toolsOpen, setToolsOpen] = useState(false);
  // AUTO-SCROLL: when the teacher writes something new, the board scrolls so that part is in view (like following the teacher's hand).
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef<{ y: number; h: number } | null>(null);   // board area (in page units) to bring into view after the next render   // toolbar starts hidden; the floating toggle button shows / hides it
  const st = S.current; const page = st.pages[st.idx];
  const lightBoard = theme === "white";

  const snap = () => { st.undo.push(JSON.stringify({ p: st.pages, i: st.idx })); if (st.undo.length > 60) st.undo.shift(); st.redo = []; };
  const changed = () => { force(); onChange?.(); };

  const api: BoardHandle = {
    apply(a) {
      if (a.type === "clear") return api.clear();
      if (a.type === "newpage") return api.newPage();
      snap(); st.freshAfter = uid - 1;
      let p = st.pages[st.idx]; const h = heightOf(a);
      if (p.cursor + h > H - 8 && p.items.length) { st.pages.push({ items: [], cursor: 12 }); st.idx = st.pages.length - 1; p = st.pages[st.idx]; }
      p.items.push({ id: uid++, kind: "action", action: a, y: p.cursor, h }); followRef.current = { y: p.cursor, h }; p.cursor += h + 8;
      changed();
    },
    clear() { followRef.current = { y: 0, h: 0 }; snap(); st.freshAfter = uid; if (page.items.length) { st.pages.push({ items: [], cursor: 12 }); if (st.pages.length > 30) st.pages.shift(); } st.idx = st.pages.length - 1; changed(); },
    newPage() { followRef.current = { y: 0, h: 0 }; snap(); st.pages.push({ items: [], cursor: 12 }); st.idx = st.pages.length - 1; changed(); },
    undo() { const s = st.undo.pop(); if (!s) return; st.redo.push(JSON.stringify({ p: st.pages, i: st.idx })); const o = JSON.parse(s); st.pages = o.p; st.idx = o.i; st.freshAfter = uid; changed(); },
    redo() { const s = st.redo.pop(); if (!s) return; st.undo.push(JSON.stringify({ p: st.pages, i: st.idx })); const o = JSON.parse(s); st.pages = o.p; st.idx = o.i; st.freshAfter = uid; changed(); },
    prevPage() { st.idx = Math.max(0, st.idx - 1); st.freshAfter = uid; changed(); },
    getPages: () => st.pages,
    load(p) { st.pages = p.length ? p : [{ items: [], cursor: 12 }]; st.idx = 0; st.undo = []; st.redo = []; st.freshAfter = uid; uid = Math.max(uid, ...p.flatMap((x) => x.items.map((i) => i.id)), 0) + 1; changed(); },
    hasContent: () => st.pages.some((p) => p.items.length > 0),
  };
  useImperativeHandle(ref, () => api);
  useEffect(() => {                       // runs after each render; does nothing unless the teacher just wrote / turned a page
    const f = followRef.current, box = scrollRef.current, svg = svgRef.current;
    if (!f || !box || !svg) return;
    followRef.current = null;
    const scale = svg.getBoundingClientRect().height / H;                  // page units -> pixels (handles zoom)
    const top = svg.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + f.y * scale;
    const bottom = top + f.h * scale;
    let target = box.scrollTop;
    if (bottom > target + box.clientHeight - 16) target = bottom - box.clientHeight + 16;   // new part below the view: scroll down to it
    if (top < target + 8) target = top - 8;                                               // taller than the view / above it: show its start
    if (Math.abs(target - box.scrollTop) > 2) box.scrollTo({ top: Math.max(0, target), behavior: lowPower ? "auto" : "smooth" });
  });
  useEffect(() => { if (initial?.length) { uid = Math.max(uid, ...initial.flatMap((x) => x.items.map((i) => i.id)), 0) + 1; st.freshAfter = uid; force(); } /* eslint-disable-next-line */ }, []);

  // ---- manual drawing ----
  const pt = (e: React.PointerEvent): [number, number] => {
    const svg = svgRef.current!; const r = svg.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
  };
  const erasing = useRef(false);
  const eraseAt = (p: [number, number]) => {
    const before = page.items.length;
    page.items = page.items.filter((it) => it.kind === "stroke" ? !it.points!.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 16) : !(p[1] >= it.y && p[1] <= it.y + it.h && Math.abs(p[0] - W / 2) < W / 2 - 4));
    if (page.items.length !== before) changed();
  };
  const down = (e: React.PointerEvent) => {
    if (readOnly) return; (e.target as Element).setPointerCapture?.(e.pointerId); const p = pt(e);
    if (tool === "eraser") { snap(); erasing.current = true; eraseAt(p); } else setLive([p]);
  };
  const move = (e: React.PointerEvent) => { if (readOnly) return; const p = pt(e); if (erasing.current) eraseAt(p); else if (live) setLive((l) => (l ? [...l, p] : l)); };
  const up = () => {
    erasing.current = false;
    if (live && live.length) {
      snap(); st.freshAfter = uid;
      page.items.push({ id: uid++, kind: "stroke", y: 0, h: 0, points: live, color: ink, width: tool === "highlighter" ? 18 : 3.5, hl: tool === "highlighter" } as BoardItem);
      changed();
    }
    setLive(null);
  };

  const download = async () => {
    setBusy("png");
    try { const a = document.createElement("a"); a.href = await pageToPng(page, theme); a.download = `lumetra-board-page-${st.idx + 1}.png`; a.click(); }
    finally { setBusy(""); }
  };
  const pdf = async () => {
    setBusy("pdf");
    try {
      const imgs = await Promise.all(st.pages.filter((p) => p.items.length).map((p) => pageToPng(p, theme)));
      if (!imgs.length) return;
      const w = window.open("", "_blank"); if (!w) return;
      w.document.write(`<title>LUMETRA CLASSORA board</title><style>@page{size:landscape;margin:8mm}body{margin:0}img{width:100%;page-break-after:always}</style>${imgs.map((s) => `<img src="${s}"/>`).join("")}<script>setTimeout(()=>print(),400)<\/script>`);
      w.document.close();
    } finally { setBusy(""); }
  };
  const fullscreen = () => { const el = wrapRef.current; if (!el) return; document.fullscreenElement ? document.exitFullscreen() : el.requestFullscreen?.(); };

  const t = BOARDS[theme] ?? BOARDS.green;
  const tb = "btn btn-sm !px-2";
  return (
    <div ref={wrapRef} className="relative flex flex-col h-full min-h-0" style={{ background: "var(--bg2)" }}>
      {/* Floating show/hide button: always visible, stays in the same spot whether the toolbar is open or closed */}
      <button type="button" onClick={() => setToolsOpen((o) => !o)} aria-expanded={toolsOpen} aria-controls="board-toolbar"
        aria-label={toolsOpen ? "Hide board tools" : "Show board tools"} title={toolsOpen ? "Hide tools" : "Show tools"}
        className={`${tb} absolute top-1.5 right-1.5 z-20 !h-9 !w-9 !p-0 grid place-items-center shadow-lg btn-primary`}>
        <motion.span aria-hidden className="inline-block leading-none" animate={{ rotate: toolsOpen ? 90 : 0 }} transition={{ duration: lowPower ? 0 : 0.25 }}>{toolsOpen ? "✕" : "🛠️"}</motion.span>
      </button>
      <AnimatePresence initial={false}>
      {toolsOpen && (
      <motion.div key="board-toolbar" className="overflow-hidden shrink-0"
        initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
        transition={{ duration: lowPower ? 0 : 0.25, ease: "easeInOut" }}>
      <div id="board-toolbar" className="flex flex-wrap items-center justify-end gap-1 p-1.5 pr-12 border-b" style={{ borderColor: "var(--panel-border)" }} role="toolbar" aria-label="Board tools">
        {!readOnly && (<>
          {(["pen", "highlighter", "eraser"] as Tool[]).map((x) => <button key={x} className={`${tb} ${tool === x ? "sel" : ""}`} onClick={() => setTool(x)} title={x} aria-pressed={tool === x}>{x === "pen" ? "✏️" : x === "highlighter" ? "🖍️" : "🧽"}</button>)}
          {INKS.map((c) => <button key={c} onClick={() => setInk(c)} aria-label={`ink ${c}`} className={`h-5 w-5 rounded-full border ${ink === c ? "sel" : ""}`} style={{ background: c, borderColor: "#fff6" }} />)}
          <button className={tb} onClick={() => api.undo()} title="Undo" disabled={!st.undo.length}>↩️</button>
          <button className={tb} onClick={() => api.redo()} title="Redo" disabled={!st.redo.length}>↪️</button>
          <button className={tb} onClick={() => api.clear()} title="Clear board (old pages stay in history)">🗑️ Clear</button>
          <button className={tb} onClick={() => api.newPage()} title="New page">＋ Page</button>
        </>)}
        <span className="mx-1 flex items-center gap-1 text-xs">
          <button className={tb} onClick={() => { st.idx = Math.max(0, st.idx - 1); st.freshAfter = uid; changed(); }} disabled={st.idx === 0} aria-label="Previous page">‹</button>
          <span className="text-muted tabular-nums">{st.idx + 1}/{st.pages.length}</span>
          <button className={tb} onClick={() => { st.idx = Math.min(st.pages.length - 1, st.idx + 1); st.freshAfter = uid; changed(); }} disabled={st.idx >= st.pages.length - 1} aria-label="Next page">›</button>
        </span>
        <button className={tb} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))} aria-label="Zoom out">－</button>
        <span className="text-xs text-muted w-9 text-center">{Math.round(zoom * 100)}%</span>
        <button className={tb} onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))} aria-label="Zoom in">＋</button>
        <button className={tb} onClick={fullscreen} title="Full screen">⛶</button>
        <button className={tb} onClick={download} disabled={busy === "png"} title="Download this page as image">⬇ PNG</button>
        <button className={tb} onClick={pdf} disabled={busy === "pdf"} title="Opens print dialog → Save as PDF">⬇ PDF</button>
        {onSave && !readOnly && <button className={`${tb} btn-primary`} onClick={() => onSave(st.pages)} disabled={!api.hasContent()}>💾 Save</button>}
        <span className="ml-auto flex gap-1">{toolbarExtra}</span>
      </div>
      </motion.div>
      )}
      </AnimatePresence>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto p-2" style={{ background: "#0006" }}>
        <div className="mx-auto rounded-lg overflow-hidden shadow-2xl" style={{ width: `${zoom * 100}%`, border: `6px solid ${t.frame}`, touchAction: "none" }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full select-none" style={{ cursor: readOnly ? "default" : tool === "eraser" ? "cell" : "crosshair" }}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} role="img" aria-label="Interactive digital blackboard">
            <PageSvg page={page} theme={theme} animate={!lowPower} fresh={st.freshAfter} />
            {live && <path d={live.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ")} stroke={ink} strokeWidth={tool === "highlighter" ? 18 : 3.5} strokeOpacity={tool === "highlighter" ? 0.38 : 1} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
            {!page.items.length && !live && <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={22} fill={t.ink} opacity={0.35} fontFamily="'Segoe Print',cursive">{lightBoard ? "" : ""}{readOnly ? "Empty board" : "Ask the teacher to explain on the board, or draw here ✏️"}</text>}
          </svg>
        </div>
      </div>
    </div>
  );
});

