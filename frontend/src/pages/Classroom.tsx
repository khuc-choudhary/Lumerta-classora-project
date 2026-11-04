import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Avatar, AVATAR_BG } from "../components/Avatar";
import { Board, type BoardHandle } from "../components/Board";
import { Speakable } from "../components/Speakable";
import { Spinner } from "../components/ui";
import { createListener, getVoices, matchWake, speak, speechLang, sttSupported, stopSpeaking, type ListenState } from "../speech";
import { useApp } from "../store";
import { MODES, type Beat, type DocDetail, type Emotion, type Gesture, type Prefs, type Script, type User } from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LANGS: Record<string, string> = { english: "English", hindi: "Hindi", hinglish: "Hinglish", gujarati: "Gujarati", mix3: "English+Hindi+Gujarati", auto: "Auto-match" };
const LEVELS: Record<string, string> = { very_simple: "Very simple", beginner: "Beginner", normal: "Normal", technical: "Technical", exam: "Exam level" };
const PERS: Record<string, string> = { friendly: "Friendly", strict: "Strict but supportive", funny: "Funny", motivational: "Motivational", professor: "Professional professor", beginner: "Beginner-friendly", interactive: "Interactive", storyteller: "Storytelling" };

// Short replies at a "did you understand?" checkpoint. STUCK is tested first so "samajh nahi aaya" never counts as "samajh aaya".
const STUCK = /(samajh|samjh|samaj)\s*(mein|me)?\s*(nahi|nahin|nhi)|nahi\s*(aaya|samjha|samajh)|not\s*(clear|understood)|don'?t\s*(understand|get)|didn'?t\s*(understand|get)|confus|dobara|phir\s*se|again|explain\s*again/i;
const UNDERSTOOD = /^\s*(ok(ay)?|yes|yeah|yep|haan|han|haa|ji(\s*haan)?|clear|got\s*it|understood|(i\s*)?(samajh|samjh)\s*(aa\s*)?gaya|(samajh|samjh)\s*aaya|theek\s*hai|thik\s*hai|bilkul|next|aage\s*(badho|chalo)|continue|chalo)\b/i;
const KIND_LABEL: Record<string, string> = { definition: "Book's definition (exact)", parts: "Each part explained", connect: "Putting it together", intro: "Introduction", meaning: "Simple meaning", terms: "Difficult words", example: "Real-life example", technical: "How it works", practical: "Practical example", recap: "Recap", check: "Your turn" };

/** Makes it obvious what is the BOOK's wording and what is the teacher's own explanation or example. */
function originLabel(kind?: string, src?: string) {
  if (kind === "definition") return "📘 Original definition from your book";
  if (kind === "example" || src === "extra" && kind !== "parts" && kind !== "connect" && kind !== "recap") return "💡 Extra example — not from your book";
  if (kind === "parts" || kind === "connect" || kind === "recap") return "🧠 Teacher's explanation";
  return src === "extra" ? "💡 Extra — not from your book" : "📘 From your book";
}

function useMobile() {
  const [m, setM] = useState(() => window.matchMedia("(max-width: 1023px)").matches);
  useEffect(() => { const q = window.matchMedia("(max-width: 1023px)"); const f = () => setM(q.matches); q.addEventListener("change", f); return () => q.removeEventListener("change", f); }, []);
  return m;
}

function Highlighted({ text, marks, onBefore, difficult }: { text: string; marks: string[]; onBefore: () => void; difficult?: string[] }) {
  const ranges: [number, number][] = [];
  marks.forEach((m) => { const i = text.indexOf(m); if (i >= 0) ranges.push([i, i + m.length]); });
  ranges.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = []; let pos = 0;
  const plain = (s: string, k: string) => <Speakable key={k} text={s} onBefore={onBefore} difficult={difficult} />;   // 🔊 beside technical / difficult words
  ranges.forEach(([s, e], k) => { if (s < pos) return; out.push(plain(text.slice(pos, s), `p${k}`), <mark key={k} style={{ background: "#fde04799", color: "inherit", borderRadius: 4 }}>{text.slice(s, e)}</mark>); pos = e; });
  out.push(plain(text.slice(pos), "pend"));
  return <>{out}</>;
}

export default function Classroom() {
  const { prefs, user, setUser, savePrefs, toast } = useApp();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const mobile = useMobile();
  const board = useRef<BoardHandle>(null);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const lessonOn = useRef(false);
  const [settingsOpen, setSettingsOpen] = useState(false);   // language / level / personality / mode / memes: hidden behind the ⚙️ toggle   // a document lesson is playing or paused (so a style change should re-teach it)
  const run = useRef({
    token: 0, lesson: 0, script: null as Script | null, idx: 0, awakeUntil: 0, lastDef: "",
    release: null as null | ((a: "ok" | "stuck" | "cancel") => void),                       // set while waiting at a checkpoint
    resume: null as null | { script: Script; idx: number; final: boolean },
  });
  const ctx = useRef({ topic: "", mode: "classroom", page: null as number | null });        // latest values for the playback loop
  const covered = useRef<string[]>([]);           // short recaps of what was already taught (teaching continuity)
  const prefsRef = useRef(prefs); prefsRef.current = prefs;
  useEffect(() => { ctx.current = { topic: topic?.title ?? "", mode, page: doc ? pageNo : null }; });   // latest values for the playback loop

  const [docs, setDocs] = useState<{ id: number; title: string }[] | null>(null);
  const [docId, setDocId] = useState<number | null>(sp.get("doc") ? Number(sp.get("doc")) : null);
  const [doc, setDoc] = useState<DocDetail | null>(null);
  const [topicId, setTopicId] = useState<string | null>(sp.get("topic"));
  const [pageNo, setPageNo] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [marks, setMarks] = useState<string[]>([]);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [sel, setSel] = useState("");

  const [status, setStatus] = useState<"idle" | "thinking" | "speaking" | "paused" | "waiting">("idle");
  const [waiting, setWaiting] = useState(false);       // lesson is paused at a "did you understand?" checkpoint
  const [canResume, setCanResume] = useState(false);
  const [caption, setCaption] = useState("");
  const [emotion, setEmotion] = useState<Emotion>("friendly");
  const [gesture, setGesture] = useState<Gesture>("none");
  const [pulse, setPulse] = useState(0);
  const [beatIdx, setBeatIdx] = useState(0);
  const [beatTotal, setBeatTotal] = useState(0);
  const [source, setSource] = useState("");
  const [beatMeta, setBeatMeta] = useState<{ kind?: string; src?: string }>({});
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [text, setText] = useState("");
  const [mode, setMode] = useState("classroom");

  const [tab, setTab] = useState<"material" | "teacher" | "board">("teacher");
  const [boardMode, setBoardMode] = useState<"normal" | "max" | "hidden">("normal");
  const [teacherMin, setTeacherMin] = useState(false);
  const [split, setSplit] = useState(40);
  const [teacherH, setTeacherH] = useState<number | null>(null);   // desktop: height of the teacher panel (null = natural height); the board gets the rest
  const teacherRef = useRef<HTMLElement>(null);
  const [listen, setListen] = useState<ListenState>("off");
  const [micMsg, setMicMsg] = useState("");
  const [interim, setInterim] = useState("");
  const [consent, setConsent] = useState<null | "ptt" | "wake">(null);
  const [welcome, setWelcome] = useState<string | null>(null);

  const teacherName = prefs.teacher_name || (prefs.teacher === "aira" ? "AIRA" : "NEX");
  const honor = prefs.teacher === "aira" ? "Ma'am" : "Sir";

  useEffect(() => { getVoices().then((v) => (voices.current = v)); return () => { run.current.token++; stopSpeaking(); ptt.current?.stop(); wake.current?.stop(); }; /* eslint-disable-next-line */ }, []);
  useEffect(() => { api("/documents").then(setDocs).catch((e) => toast(e.message, "err")); }, [toast]);

  // load document
  useEffect(() => {
    if (!docId) { setDoc(null); return; }
    setDoc(null);
    api<DocDetail>(`/documents/${docId}`).then((d) => {
      setDoc(d); setPageNo(1);
      setMarks(JSON.parse(localStorage.getItem(`hl.${d.id}`) || "[]")); setBookmarks(JSON.parse(localStorage.getItem(`bm.${d.id}`) || "[]"));
      const done = d.roadmap.filter((t) => d.progress[t.id]?.completed);
      if (done.length) {
        const last = done[done.length - 1]; const idx = d.roadmap.findIndex((t) => t.id === last.id);
        const nxt = d.roadmap[idx + 1];
        setWelcome(`Welcome back! Last time we completed "${last.title}".${nxt ? ` Shall we continue with "${nxt.title}"?` : " You have finished every topic — shall we revise?"}`);
        if (!topicId && nxt) setTopicId(nxt.id);
      } else setWelcome(null);
      if (topicId) { const t = d.roadmap.find((x) => x.id === topicId); if (t) setPageNo(t.page); }
    }).catch((e) => { toast(e.message, "err"); setDocId(null); });
    // eslint-disable-next-line
  }, [docId]);

  const topic = doc?.roadmap.find((t) => t.id === topicId) ?? null;

  // ---------- playback engine ----------
  const interrupt = useCallback(() => {
    run.current.release?.("cancel"); run.current.release = null; setWaiting(false);      // unblock a lesson that is waiting for the student
    run.current.token++; run.current.lesson++; stopSpeaking(); setStatus("idle"); setGesture("none");
    setCanResume(!!run.current.resume);
  }, []);

  /** Plays a script beat by beat. Resolves true only if it ran to the end without being interrupted.
   *  `sub` = a re-explanation played INSIDE a running lesson (same token, does not replace the lesson's script). */
  const play = useCallback(async (script: Script, start = 0, final = true, sub = false): Promise<boolean> => {
    const tok = sub ? run.current.token : ++run.current.token;
    if (!sub) { run.current.script = script; setCanResume(false); }
    setBeatTotal(script.beats.length); setSource(script.mode === "read" ? "read" : script.source);
    for (let i = start; i < script.beats.length; i++) {
      if (tok !== run.current.token) return false;
      const b: Beat = script.beats[i];
      if (!sub) run.current.resume = { script, idx: i, final };           // any interruption leaves a resume point
      run.current.idx = i; setBeatIdx(i); setBeatMeta({ kind: b.kind, src: b.src }); setCaption(b.say); setEmotion(b.emotion); setGesture(b.gesture); setStatus("speaking");
      if (b.kind === "definition") run.current.lastDef = b.say;
      if (b.board.length) {
        setBoardMode((m) => (m === "hidden" ? "normal" : m));
        b.board.forEach((a, k) => setTimeout(() => { if (tok === run.current.token) board.current?.apply(a); }, k * 900));
      }
      await speak(b.speech || b.say, prefsRef.current, b.emotion, voices.current, { onWord: () => setPulse((p) => p + 1) }, b.say);
      if (tok !== run.current.token) return false;
      if (docId && topicId && !sub) api("/teach/progress", { method: "POST", body: { document_id: docId, topic_id: topicId, beat: i } }).catch(() => {});

      // CHECKPOINT: after a definition's check question the teacher waits - it never rushes to the next concept.
      if (b.kind === "check" && i < script.beats.length - 1 && !sub && script.mode !== "read") {
        let attempts = 0;
        for (;;) {
          setStatus("waiting"); setWaiting(true); setGesture("open");
          const ans = await new Promise<"ok" | "stuck" | "cancel">((res) => { run.current.release = res; });
          run.current.release = null; setWaiting(false);
          if (tok !== run.current.token || ans === "cancel") { run.current.resume = { script, idx: i + 1, final }; return false; }
          if (ans === "ok") { setStatus("speaking"); break; }
          if (++attempts > 3) {                                          // still stuck: move on, come back later
            await speak(prefsRef.current.language === "english" ? "No problem, let's move ahead and we will come back to this later." : "Koi baat nahi, hum aage badhte hain, baad mein is par wapas aayenge.", prefsRef.current, "friendly", voices.current);
            break;
          }
          setStatus("thinking"); setCaption("Let me explain it another way…");
          try {                                                           // SAME definition, DIFFERENT example / simpler analogy
            const c = ctx.current;
            const r = await api<any>("/teach/ask", { method: "POST", body: { message: "Samajh nahi aaya. Dusre simple example se samjhao.", document_id: docId, selection: "", history: [], last_topic: c.topic, mode: c.mode, page: c.page, covered: covered.current, context: run.current.lastDef || b.say } });
            if (tok !== run.current.token) return false;
            await play(r.script, 0, true, true);
            if (tok !== run.current.token) return false;
          } catch (e: any) { toast(e.message, "err"); break; }
        }
        if (tok !== run.current.token) return false;
      }
      await sleep(220);
    }
    if (tok !== run.current.token) return false;
    setGesture("none");
    if (script.recap) covered.current = [...covered.current, script.recap].slice(-8);   // continuity memory for later requests
    if (final && script.check) {
      setBeatMeta({ kind: "check", src: "extra" }); setCaption(script.check); setEmotion("curious"); setGesture("open");
      await speak(script.check_speech || script.check, prefsRef.current, "curious", voices.current, { onWord: () => setPulse((p) => p + 1) }, script.check);
    }
    if (tok !== run.current.token) return false;
    if (final) { setStatus("idle"); setGesture("none"); if (!sub) run.current.resume = null; }
    return true;
  }, [docId, topicId, toast]);

  /** Continue the lesson from where it was interrupted. */
  const resumeLesson = useCallback(async () => {
    const rs = run.current.resume; if (!rs) return;
    setCanResume(false);
    const done = await play(rs.script, rs.idx, rs.final);
    if (done && rs.final && docId && topicId) api("/teach/progress", { method: "POST", body: { document_id: docId, topic_id: topicId, beat: 0, completed: true } }).catch(() => {});
  }, [play, docId, topicId]);

  const startLesson = useCallback(async (tid?: string) => {
    const t = tid ?? topicId;
    lessonOn.current = true;
    if (!docId || !t) { toast("Pick a document and a topic first (or just ask a question).", "err"); return; }
    interrupt(); const myLesson = run.current.lesson;
    setStatus("thinking"); setCaption(`Preparing the lesson…`); setWelcome(null); setTab("teacher");
    try {
      // Long topics are taught in several parts so nothing from the book is cut off; each part links to what came before.
      let part = 0, parts = 1, finished = true;
      board.current?.newPage();
      do {
        const r = await api<{ script: Script; title: string; part: number; parts: number }>("/teach/lesson", { method: "POST", body: { document_id: docId, topic_id: t, mode, part, covered: covered.current } });
        parts = r.parts;
        if (run.current.lesson !== myLesson) { finished = false; break; }  // student interrupted while the next part was loading
        finished = await play(r.script, 0, part >= parts - 1);
        if (!finished) break;
        part++;
        if (part < parts) setStatus("thinking");
      } while (part < parts);
      if (finished) lessonOn.current = false;
      if (finished) api("/teach/progress", { method: "POST", body: { document_id: docId, topic_id: t, beat: 0, completed: true } })
        .then(() => api<DocDetail>(`/documents/${docId}`).then(setDoc)).catch(() => {});
    } catch (e: any) { toast(e.message, "err"); setStatus("idle"); setCaption(""); }
  }, [docId, topicId, mode, play, interrupt, toast]);

  /** Language / level / personality changed: save it, and if a lesson is going on, re-teach the current topic in the new
   *  style right away (the old lesson was already written in the old style, so only a fresh lesson can switch). */
  const changeStyle = async (p: Partial<Prefs>) => {
    await savePrefs(p);
    if (lessonOn.current && docId && topicId) { toast("Okay! Re-teaching this topic in the new style…"); startLesson(); }
  };

  const refreshUser = () => api<User>("/me").then(setUser).catch(() => {});

  const handleControl = useCallback((c: string) => {
    const r = run.current;
    if (r.release && (c === "continue" || c === "next")) { r.release("ok"); return; }       // "continue" at a checkpoint = I understood
    if (r.release && c === "repeat") { r.release("stuck"); return; }                        // "repeat" at a checkpoint = explain again
    if (c === "stop") { interrupt(); setCaption("Okay, I've stopped. Ask me anything when you're ready."); }
    else if (c === "pause") { interrupt(); setStatus("paused"); }
    else if (c === "continue" && r.script) play(r.script, r.idx);
    else if (c === "repeat" && r.script) play(r.script, r.idx);
    else if (c === "previous" && r.script) play(r.script, Math.max(0, r.idx - 1));
    else if (c === "next" && r.script) { if (r.idx + 1 < r.script.beats.length) play(r.script, r.idx + 1); else { const i = doc?.roadmap.findIndex((t) => t.id === topicId) ?? -1; const n = doc?.roadmap[i + 1]; if (n) { setTopicId(n.id); setPageNo(n.page); startLesson(n.id); } else toast("That was the last topic 🎉"); } }
    else if (c === "clear_board") board.current?.clear();
    else if (c === "rate") toast("Speaking speed updated.");
    else toast("Nothing to continue yet — start a lesson or ask a question.");
  }, [interrupt, play, doc, topicId, startLesson, toast]);

  const ask = useCallback(async (q: string, selection = "") => {
    const message = q.trim() || (selection ? "Explain this line" : "");
    if (!message) return;
    if (run.current.release) {          // lesson is waiting at a checkpoint: short replies answer "did you understand?"
      if (STUCK.test(message)) { run.current.release("stuck"); setText(""); return; }
      if (UNDERSTOOD.test(message)) { run.current.release("ok"); setText(""); return; }
    }
    if (/^(start|begin)\s+(teaching|lesson|class)|shuru\s*karo|padhana\s*shuru/i.test(message) && docId && topicId) { startLesson(); return; }
    const answering = !!run.current.release;                       // a real answer to the check question (not just "ok")
    interrupt(); setStatus("thinking"); setCaption("Thinking…"); setSel(""); setText("");
    try {
      const r = await api<any>("/teach/ask", { method: "POST", body: { message, document_id: docId, selection, history: history.slice(-8), last_topic: topic?.title ?? "", mode, page: doc ? pageNo : null, covered: covered.current,
        context: run.current.lastDef, answering_check: answering } });
      if (r.changed && Object.keys(r.changed).length) refreshUser();
      if (r.control) { handleControl(r.control); return; }
      if (r.open_board) setBoardMode((m) => (m === "hidden" ? "normal" : m));
      setHistory((h) => [...h, { role: "user" as const, content: message }, { role: "assistant" as const, content: r.script.beats.map((b: Beat) => b.say).join(" ").slice(0, 700) }].slice(-12));
      const resume = run.current.resume;
      const done = await play(r.script, 0);
      const styleChanged = !!(r.changed && (r.changed.language || r.changed.level || r.changed.personality));
      if (done && styleChanged && lessonOn.current && docId && topicId) { run.current.resume = null; startLesson(); return; }   // continue the lesson in the NEW style, not the old script
      if (done) {
        run.current.resume = resume; setCanResume(!!resume);
        if (answering && resume) { setCanResume(false); const rs = resume; if (await play(rs.script, rs.idx, rs.final) && rs.final && docId && topicId) api("/teach/progress", { method: "POST", body: { document_id: docId, topic_id: topicId, beat: 0, completed: true } }).catch(() => {}); }
      }
    } catch (e: any) { toast(e.message, "err"); setStatus("idle"); setCaption(""); }
  }, [docId, topicId, topic, history, mode, doc, pageNo, interrupt, play, handleControl, startLesson, toast]);
  const askRef = useRef(ask); askRef.current = ask;

  // ---------- voice input ----------
  const ptt = useRef<ReturnType<typeof createListener> | null>(null);
  const wake = useRef<ReturnType<typeof createListener> | null>(null);

  const startPTT = () => {
    if (!sttSupported) { toast("Voice input needs Chrome or Edge. You can type your doubt instead.", "err"); return; }
    interrupt();
    ptt.current?.stop();
    ptt.current = createListener({
      lang: speechLang(prefs.language), continuous: false,
      onInterim: setInterim,
      onFinal: (t) => { setInterim(""); const w = matchWake(t, prefsRef.current); askRef.current(w ? w.command || "continue" : t); },
      onState: (s, m) => { setListen(s); setMicMsg(m ?? ""); if (m) toast(m, "err"); if (s !== "listening") setInterim(""); },
    });
    ptt.current.start();
  };
  const stopPTT = () => ptt.current?.stop();

  const startWake = () => {
    if (!sttSupported) { toast("Wake-word needs Chrome or Edge. Push-to-talk is not available here either — please type.", "err"); return; }
    wake.current?.stop();
    wake.current = createListener({
      lang: speechLang(prefs.language), continuous: true,
      onInterim: (t) => { setInterim(t); if (matchWake(t, prefsRef.current)) { if (run.current.token && !run.current.release) { run.current.token++; stopSpeaking(); setStatus("idle"); } } }, // barge-in as soon as the teacher is addressed
      onFinal: (t, conf) => {
        setInterim("");
        const w = matchWake(t, prefsRef.current);
        const awake = Date.now() < run.current.awakeUntil;
        if (!w && !awake) return;                       // background speech is ignored
        if (w && conf < 0.35) return;                   // low-confidence command is not executed
        const cmd = w ? w.command : t;
        if (!cmd) { run.current.awakeUntil = Date.now() + 8000; speak("Yes? I'm listening.", prefsRef.current, "friendly", voices.current); return; }
        run.current.awakeUntil = Date.now() + 8000;
        askRef.current(cmd);
      },
      onState: (s, m) => { setListen(s); setMicMsg(m ?? ""); if (m) { toast(m, "err"); savePrefs({ listen_wake: false }); } },
    });
    wake.current.start();
  };
  const toggleWake = () => {
    if (listen !== "off" && prefs.listen_wake) { wake.current?.stop(); savePrefs({ listen_wake: false }); return; }
    if (!localStorage.getItem("lumetra.micConsent")) { setConsent("wake"); return; }
    savePrefs({ listen_wake: true }); startWake();
  };
  // The microphone listens in the teaching language (Hindi / Gujarati / Indian English). When the language changes while
  // the wake word is on, restart it so the new language is understood immediately (not only after a page reload).
  const langRef = useRef(prefs.language);
  useEffect(() => {
    if (langRef.current === prefs.language) return;
    langRef.current = prefs.language;
    if (prefs.listen_wake && listen !== "off") startWake();
    // eslint-disable-next-line
  }, [prefs.language]);
  const onPTT = () => { if (listen === "listening" && !prefs.listen_wake) return stopPTT(); if (!localStorage.getItem("lumetra.micConsent")) return setConsent("ptt"); startPTT(); };
  const giveConsent = () => { localStorage.setItem("lumetra.micConsent", "1"); const c = consent; setConsent(null); if (c === "wake") { savePrefs({ listen_wake: true }); startWake(); } else startPTT(); };

  // ---------- reader ----------
  const pageText = doc?.pages[pageNo - 1] ?? "";
  const onSelect = () => { const s = window.getSelection()?.toString().trim() ?? ""; setSel(s.length > 3 ? s.slice(0, 900) : ""); };
  const addMark = () => { if (!doc || !sel) return; const m = [...new Set([...marks, sel])]; setMarks(m); localStorage.setItem(`hl.${doc.id}`, JSON.stringify(m)); setSel(""); window.getSelection()?.removeAllRanges(); };
  const toggleBm = () => { if (!doc) return; const b = bookmarks.includes(pageNo) ? bookmarks.filter((x) => x !== pageNo) : [...bookmarks, pageNo].sort((a, b) => a - b); setBookmarks(b); localStorage.setItem(`bm.${doc.id}`, JSON.stringify(b)); };
  const pageMarks = useMemo(() => marks.filter((m) => pageText.includes(m)), [marks, pageText]);

  const saveBoard = async (pages: any) => {
    try { await api("/items/board", { method: "POST", body: { title: `${topic?.title ?? doc?.title ?? "Board"} — ${new Date().toLocaleDateString()}`, data: { pages, theme: prefs.theme.board } } }); toast("Board saved to your library ✔"); }
    catch (e: any) { toast(e.message, "err"); }
  };
  const nextTopic = (d: number) => { if (!doc) return; const i = doc.roadmap.findIndex((t) => t.id === topicId); const t = doc.roadmap[Math.min(doc.roadmap.length - 1, Math.max(0, i + d))]; if (t) { setTopicId(t.id); setPageNo(t.page); } };

  const compact = teacherMin || (mobile && tab === "board");
  const statusLabel = status === "waiting" ? "Waiting for you" : status === "thinking" ? "Thinking…" : status === "speaking" ? "Speaking" : status === "paused" ? "Paused" : listen === "listening" ? "Listening" : "Ready";
  const showMat = tab === "material" ? "flex" : "hidden";
  const full = boardMode === "max";

  // ---------- render ----------
  return (
    <div className="h-[calc(100vh-56px)] lg:h-screen flex flex-col">
      {/* mobile tabs */}
      <div className="lg:hidden flex gap-1 p-2" role="tablist">
        {(["material", "teacher", "board"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`btn btn-sm flex-1 ${tab === t ? "btn-primary" : ""}`}>{t === "material" ? "📄 Material" : t === "teacher" ? "🧑‍🏫 Teacher" : "🧾 Board"}</button>)}
      </div>

      <div className="flex-1 min-h-0 relative grid gap-3 p-2 lg:p-3 grid-cols-1 lg:[grid-template-columns:var(--split)_1fr]" style={{ ["--split" as any]: full ? "0px" : `${split}%` }}>
        {/* ---------- LEFT: study material ---------- */}
        <section className={`glass ${showMat} ${full ? "lg:hidden" : "lg:flex"} flex-col min-h-0 overflow-hidden`} aria-label="Study material">
          <div className="p-2 border-b flex flex-wrap items-center gap-2" style={{ borderColor: "var(--panel-border)" }}>
            <select className="input !py-1.5 !w-auto flex-1 min-w-[8rem]" value={docId ?? ""} onChange={(e) => { setTopicId(null); setDocId(e.target.value ? Number(e.target.value) : null); }} aria-label="Document">
              <option value="">{docs ? (docs.length ? "Choose a document…" : "No documents yet") : "Loading…"}</option>
              {docs?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <button className="btn btn-sm" onClick={() => nav("/documents")}>＋ Upload</button>
          </div>
          {doc ? (<>
            <div className="p-2 flex flex-wrap items-center gap-1.5 text-sm">
              <select className="input !py-1.5 !w-auto flex-1 min-w-[8rem]" value={topicId ?? ""} onChange={(e) => { setTopicId(e.target.value); const t = doc.roadmap.find((x) => x.id === e.target.value); if (t) setPageNo(t.page); }} aria-label="Chapter / topic">
                <option value="">Chapter / topic…</option>
                {doc.roadmap.map((t) => <option key={t.id} value={t.id}>{doc.progress[t.id]?.completed ? "✓ " : ""}{t.title}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" disabled={!topicId || status === "thinking"} onClick={() => startLesson()}>▶ Teach this</button>
            </div>
            <div className="px-2 pb-2 flex items-center gap-1 text-xs">
              <button className="btn btn-sm !px-2" disabled={pageNo <= 1} onClick={() => setPageNo((p) => p - 1)} aria-label="Previous page">‹</button>
              <span className="tabular-nums">Page {pageNo}/{doc.pages.length}</span>
              <button className="btn btn-sm !px-2" disabled={pageNo >= doc.pages.length} onClick={() => setPageNo((p) => p + 1)} aria-label="Next page">›</button>
              <button className="btn btn-sm !px-2" onClick={() => setZoom((z) => Math.max(.8, +(z - .1).toFixed(1)))} aria-label="Zoom out">A−</button>
              <button className="btn btn-sm !px-2" onClick={() => setZoom((z) => Math.min(1.8, +(z + .1).toFixed(1)))} aria-label="Zoom in">A+</button>
              <button className={`btn btn-sm !px-2 ${bookmarks.includes(pageNo) ? "sel" : ""}`} onClick={toggleBm} title="Bookmark page">🔖</button>
              {bookmarks.length > 0 && <select className="input !py-1 !w-auto text-xs" value="" onChange={(e) => e.target.value && setPageNo(Number(e.target.value))} aria-label="Bookmarks"><option value="">Bookmarks</option>{bookmarks.map((b) => <option key={b} value={b}>Page {b}</option>)}</select>}
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 relative" onMouseUp={onSelect} onTouchEnd={() => setTimeout(onSelect, 300)}>
              <div className="whitespace-pre-wrap leading-relaxed" style={{ fontSize: `${zoom}em` }}>
                {pageText.trim() ? <Highlighted text={pageText} marks={pageMarks} onBefore={interrupt} difficult={doc?.analysis?.difficult} /> : <span className="text-muted">No text was found on this page.</span>}
              </div>
              <p className="text-[11px] text-muted mt-6">Showing extracted text. Select any sentence to ask about it.</p>
            </div>
            {sel && (
              <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="glass m-2 p-2 flex flex-wrap items-center gap-1.5 shadow-xl">
                <span className="text-xs text-muted flex-1 min-w-full truncate">“{sel.slice(0, 80)}”</span>
                <button className="btn btn-sm btn-primary" onClick={() => { setTab("teacher"); ask("Explain this line", sel); }}>💡 Explain this line</button>
                <button className="btn btn-sm" onClick={() => { setTab("board"); ask("Explain this on the board with an example", sel); }}>🧾 On the board</button>
                <button className="btn btn-sm" onClick={addMark}>🖍 Highlight</button>
              </motion.div>
            )}
          </>) : docId ? <Spinner label="Opening document…" /> : (
            <div className="p-6 text-center text-muted m-auto">
              <div className="text-4xl mb-2">📚</div>Select a document to see it here, or just ask {teacherName} anything.
              <div className="mt-3"><button className="btn btn-primary" onClick={() => nav("/documents")}>Upload study material</button></div>
            </div>
          )}
        </section>

        {/* split handle (desktop) */}
        {!full && <div className="hidden lg:block absolute top-3 bottom-3 w-3 -ml-1.5 cursor-col-resize z-10 group" style={{ left: `calc(${split}% + 12px)` }} role="separator" aria-orientation="vertical" aria-label="Resize panels"
          onPointerDown={(e) => { const el = e.currentTarget; el.setPointerCapture(e.pointerId); const parent = el.parentElement!.getBoundingClientRect(); const mv = (ev: PointerEvent) => setSplit(Math.min(65, Math.max(22, ((ev.clientX - parent.left) / parent.width) * 100))); const upf = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", upf); }; el.addEventListener("pointermove", mv); el.addEventListener("pointerup", upf); }}>
          <div className="mx-auto h-full w-0.5 rounded group-hover:w-1" style={{ background: "var(--accent)", opacity: .5 }} />
        </div>}

        {/* ---------- RIGHT: teacher + board ---------- */}
        <div className={`${tab === "material" ? "hidden" : "flex"} lg:flex flex-col gap-3 min-h-0 min-w-0`}>
          {/* teacher */}
          <section ref={teacherRef} className={`glass shrink-0 ${teacherH && !mobile && boardMode === "normal" ? "overflow-y-auto" : "overflow-hidden"}`} style={teacherH && !mobile && boardMode === "normal" ? { height: teacherH } : undefined} aria-label="AI teacher">
            <div className={`flex ${compact ? "flex-row items-center" : "flex-col sm:flex-row"}`}>
              <div className={`relative shrink-0 grid place-items-center ${compact ? "w-24 h-24" : "w-full sm:w-56 h-52"}`} style={{ background: AVATAR_BG[prefs.avatar_look.bg] ?? AVATAR_BG.classroom }}>
                <Avatar prefs={prefs} speaking={status === "speaking"} emotion={emotion} gesture={boardMode !== "hidden" && gesture === "none" && status === "speaking" ? "point" : gesture} pulse={pulse} size={compact ? 84 : 200} />
                {!compact && <span className="absolute top-2 left-2 chip" style={{ background: "#0008" }}>{teacherName}</span>}
                <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 chip" style={{ background: "#000a" }} aria-live="polite">{statusLabel}</span>
              </div>
              <div className="flex-1 min-w-0 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="flex items-end gap-[3px] h-5 w-24" aria-hidden>
                    {Array.from({ length: 14 }).map((_, i) => <motion.span key={i} className="w-1 rounded" style={{ background: "linear-gradient(var(--accent2),var(--accent))" }}
                      animate={{ height: status === "speaking" && !prefs.low_power ? [4, 8 + ((i * 7) % 12), 5 + ((i * 5) % 10), 4] : 4 }} transition={{ duration: .6 + (i % 4) * .12, repeat: Infinity }} />)}
                  </div>
                  {source === "read" ? <span className="chip">📖 Reading aloud (exact text)</span> : beatMeta.kind && status !== "idle" || beatMeta.kind === "check" ? (<>
                    {KIND_LABEL[beatMeta.kind ?? ""] && <span className="chip">{KIND_LABEL[beatMeta.kind ?? ""]}</span>}
                    <span className="chip">{originLabel(beatMeta.kind, beatMeta.src)}</span></>)
                    : source && <span className="chip">{source === "document" ? "📘 From your document" : source === "mixed" ? "📘+💡 Document + extra" : "💡 Extra explanation (not from your material)"}</span>}
                  <span className="ml-auto flex gap-1">
                    <button className="btn btn-sm !px-2" onClick={() => setTeacherMin((m) => !m)} aria-label={teacherMin ? "Expand teacher" : "Minimize teacher"} title={teacherMin ? "Expand" : "Minimize"}>{teacherMin ? "⤢" : "–"}</button>
                  </span>
                </div>
                <div className={`text-sm leading-relaxed overflow-auto ${compact ? "max-h-10" : "max-h-24"}`} aria-live="polite" style={{ minHeight: compact ? 0 : "3rem" }}>
                  {caption ? <Speakable text={caption} onBefore={interrupt} difficult={doc?.analysis?.difficult} /> : (welcome ?? `Hello! I am ${teacherName}, your personal AI teacher. Choose a topic and press “Teach this”, or ask me anything — say “${teacherName} ${honor}, …”`)}
                </div>
                {welcome && !caption && <button className="btn btn-sm btn-primary self-start" onClick={() => startLesson()}>▶ Yes, continue</button>}
                {waiting && (
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Did you understand?">
                    <button className="btn btn-sm btn-primary" onClick={() => run.current.release?.("ok")}>👍 Samajh aaya — continue</button>
                    <button className="btn btn-sm" onClick={() => run.current.release?.("stuck")}>🤔 Samajh nahi aaya</button>
                    <span className="text-xs text-muted">…or answer in your own words (voice or typing)</span>
                  </div>)}
                {canResume && status === "idle" && !waiting && <button className="btn btn-sm btn-primary self-start" onClick={resumeLesson}>▶ Resume the lesson</button>}
                {beatTotal > 0 && <div className="h-1 rounded bg-white/10 overflow-hidden"><div className="h-full" style={{ width: `${((beatIdx + 1) / beatTotal) * 100}%`, background: "var(--accent)", transition: "width .3s" }} /></div>}
              </div>
            </div>
            {/* controls */}
            <div className="p-2 border-t flex flex-wrap items-center gap-1.5" style={{ borderColor: "var(--panel-border)" }}>
              <button className="btn btn-sm !px-2" title="Previous step (≈ go back)" onClick={() => handleControl("previous")}>⏮</button>
              {status === "speaking" ? <button className="btn btn-sm !px-2" onClick={() => handleControl("pause")} title="Pause">⏸</button> : <button className="btn btn-sm !px-2" onClick={() => handleControl("continue")} title="Continue">▶</button>}
              <button className="btn btn-sm !px-2" title="Next step" onClick={() => handleControl("next")}>⏭</button>
              <button className="btn btn-sm !px-2" title="Repeat" onClick={() => handleControl("repeat")}>🔁</button>
              <button className="btn btn-sm !px-2 btn-danger" title="Stop speaking" onClick={() => handleControl("stop")}>⏹</button>
              <button className="btn btn-sm !px-2" title="Slower" onClick={() => savePrefs({ voice_rate: Math.max(.6, +(prefs.voice_rate - .1).toFixed(2)) })}>🐢</button>
              <button className="btn btn-sm !px-2" title="Faster" onClick={() => savePrefs({ voice_rate: Math.min(1.3, +(prefs.voice_rate + .1).toFixed(2)) })}>🐇</button>
              {/* settings toggle (right side): shows / hides the language, level, personality, mode and memes options */}
              <button type="button" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-controls="class-settings"
                aria-label={settingsOpen ? "Hide teaching options" : "Show teaching options"} title={settingsOpen ? "Hide options" : "Language, level, personality…"}
                className="btn btn-sm btn-primary ml-auto !h-8 !w-8 !p-0 grid place-items-center shadow-lg">
                <motion.span aria-hidden className="inline-block leading-none" animate={{ rotate: settingsOpen ? 90 : 0 }} transition={{ duration: prefs.low_power ? 0 : 0.25 }}>{settingsOpen ? "✕" : "⚙️"}</motion.span>
              </button>
              <AnimatePresence initial={false}>
              {settingsOpen && (
              <motion.div key="class-settings" id="class-settings" className="basis-full overflow-hidden"
                initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                transition={{ duration: prefs.low_power ? 0 : 0.25, ease: "easeInOut" }}>
              <div className="flex flex-wrap items-center justify-end gap-1.5 pt-1">
                <select className="input !py-1 !w-auto text-xs" value={prefs.language} onChange={(e) => changeStyle({ language: e.target.value })} aria-label="Teaching language">{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select className="input !py-1 !w-auto text-xs" value={prefs.level} onChange={(e) => changeStyle({ level: e.target.value })} aria-label="Explanation level">{Object.entries(LEVELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select className="input !py-1 !w-auto text-xs" value={prefs.personality} onChange={(e) => changeStyle({ personality: e.target.value })} aria-label="Personality">{Object.entries(PERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select className="input !py-1 !w-auto text-xs" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Learning mode" title={MODES[mode].desc}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select>
                <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={prefs.memes} onChange={(e) => savePrefs({ memes: e.target.checked })} />Memes</label>
              </div>
              </motion.div>
              )}
              </AnimatePresence>
            </div>
            {/* ask */}
            <form className="p-2 pt-0 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
              <button type="button" onClick={onPTT} className={`btn !px-3 ${listen === "listening" && !prefs.listen_wake ? "btn-primary" : ""}`} aria-pressed={listen === "listening"} title="Push to talk">🎙</button>
              <input className="input" value={interim || text} onChange={(e) => setText(e.target.value)} placeholder={`Ask ${teacherName}${new RegExp(`\\b${honor}$`, "i").test(teacherName.trim()) ? "" : ` ${honor}`}…`} aria-label="Ask a doubt" maxLength={1500} />
              <button className="btn btn-primary" disabled={!text.trim() || status === "thinking"}>Ask</button>
            </form>
            <div className="px-3 pb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
              <button onClick={toggleWake} className={`chip cursor-pointer ${prefs.listen_wake && listen !== "off" ? "sel" : ""}`} aria-pressed={prefs.listen_wake}>👂 Wake word “{prefs.wake_word || teacherName}”: {prefs.listen_wake && listen !== "off" ? "ON" : "OFF"}</button>
              <span aria-live="polite">{listen === "listening" ? "🔴 Microphone is ON — listening" : listen === "starting" ? "Starting microphone…" : "Microphone is off"}{micMsg && ` · ${micMsg}`}</span>
              {!sttSupported && <span>· Voice input needs Chrome/Edge — typing works everywhere.</span>}
            </div>
          </section>

          {/* height handle (desktop): drag up for a bigger board, down for a bigger teacher panel; double-click to reset */}
          {!mobile && boardMode === "normal" && <div className="-my-2 h-3 shrink-0 cursor-row-resize group flex items-center" role="separator" aria-orientation="horizontal" aria-label="Resize teacher and board" title="Drag to resize · double-click to reset"
            onDoubleClick={() => setTeacherH(null)}
            onPointerDown={(e) => {
              const el = e.currentTarget, sec = teacherRef.current, col = el.parentElement; if (!sec || !col) return;
              el.setPointerCapture(e.pointerId);
              const top = sec.getBoundingClientRect().top, max = col.getBoundingClientRect().bottom - top - 220;   // always leave room for the board
              const mv = (ev: PointerEvent) => setTeacherH(Math.round(Math.min(Math.max(140, max), Math.max(110, ev.clientY - top))));
              const upf = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", upf); };
              el.addEventListener("pointermove", mv); el.addEventListener("pointerup", upf);
            }}>
            <div className="mx-auto h-0.5 w-full rounded group-hover:h-1 transition-all" style={{ background: "var(--accent)", opacity: .5 }} />
          </div>}

          {/* board */}
          {boardMode !== "hidden" ? (
            <section className={`glass flex-1 min-h-[300px] lg:min-h-0 overflow-hidden ${tab === "teacher" && mobile ? "hidden" : "flex"} flex-col`} aria-label="Blackboard">
              <Board ref={board} theme={prefs.theme.board} lowPower={prefs.low_power} onSave={saveBoard}
                toolbarExtra={<><button className="btn btn-sm !px-2" onClick={() => setBoardMode(full ? "normal" : "max")} title="Maximize board" aria-label="Maximize board">{full ? "⤡" : "⤢"}</button><button className="btn btn-sm !px-2" onClick={() => setBoardMode("hidden")} title="Hide board" aria-label="Hide board">✕</button></>} />
            </section>
          ) : (
            <button className="btn self-start" onClick={() => setBoardMode("normal")}>🧾 Show board</button>
          )}
          {mobile && tab === "teacher" && boardMode !== "hidden" && <button className="btn" onClick={() => setTab("board")}>🧾 Open board</button>}
        </div>
      </div>

      {consent && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Microphone consent">
          <div className="glass p-6 max-w-md" style={{ background: "var(--bg2)" }}>
            <h3 className="font-bold text-lg mb-2">🎙 Allow microphone?</h3>
            <p className="text-sm text-muted">Your browser's speech recognition converts your voice to text so {teacherName} can understand you. In Chrome and Edge this audio is processed by the browser vendor's speech service. LUMETRA CLASSORA does not record or store your audio; only the recognized text is sent to your teacher. A red “Microphone is ON” indicator is always visible, and you can turn it off at any time.</p>
            <div className="flex gap-2 mt-4 justify-end"><button className="btn" onClick={() => setConsent(null)}>Not now</button><button className="btn btn-primary" onClick={giveConsent}>I agree, enable mic</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
