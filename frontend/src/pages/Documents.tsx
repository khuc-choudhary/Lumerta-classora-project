import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Empty, Page, Spinner } from "../components/ui";
import { useApp } from "../store";
import type { DocDetail } from "../types";

interface Row { id: number; title: string; pages: number; topics: number; completed: number; created_at: string }
const MAX_MB = 25;

export default function Documents() {
  const { toast } = useApp(); const nav = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null); const [busy, setBusy] = useState(false); const [drag, setDrag] = useState(false);
  const [open, setOpen] = useState<DocDetail | null>(null);
  const [manual, setManual] = useState({ title: "", text: "" });
  const input = useRef<HTMLInputElement>(null);
  const load = useCallback(() => api<Row[]>("/documents").then(setRows).catch((e) => toast(e.message, "err")), [toast]);
  useEffect(() => { load(); }, [load]);

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) return toast(`File is larger than ${MAX_MB} MB.`, "err");
    setBusy(true);
    try {
      const f = new FormData(); f.append("file", file);
      const r = await api<{ id: number; topics: number; pages: number; warnings: string[]; doc_type: string; ignored_lines: number }>("/documents", { form: f });
      toast(`Uploaded! ${r.doc_type === "exam_paper" ? `Exam paper: found ${r.topics} questions` : `Found ${r.topics} topics`} across ${r.pages} pages. ${r.ignored_lines ? `${r.ignored_lines} header/footer/exam-info lines were set aside.` : ""}`); r.warnings.forEach((w) => toast(w, "err")); await load();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); if (input.current) input.current.value = ""; }
  };
  const addManual = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { const r = await api<{ id: number }>("/documents/manual", { method: "POST", body: manual }); setManual({ title: "", text: "" }); toast("Topic added."); nav(`/app/classroom?doc=${r.id}&topic=t1`); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const del = async (id: number) => { if (!confirm("Delete this document and its progress?")) return; try { await api(`/documents/${id}`, { method: "DELETE" }); if (open?.id === id) setOpen(null); load(); } catch (e: any) { toast(e.message, "err"); } };
  const view = async (id: number) => { try { setOpen(await api<DocDetail>(`/documents/${id}`)); } catch (e: any) { toast(e.message, "err"); } };

  return (
    <Page title="Documents" sub="Upload your study material. AIRA/NEX build a chapter roadmap and teach only from what's in it.">
      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <div className={`glass p-8 text-center border-dashed ${drag ? "sel" : ""}`} style={{ borderStyle: "dashed", borderWidth: 2 }}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files[0]); }}>
          <div className="text-4xl mb-2">⬆️</div>
          <b>Drag & drop a file here</b>
          <p className="text-sm text-muted mt-1">PDF, DOCX, PPTX, TXT · up to {MAX_MB} MB · scanned PDFs need OCR (Tesseract) on the server</p>
          <input ref={input} type="file" hidden accept=".pdf,.docx,.pptx,.txt,.md" onChange={(e) => upload(e.target.files?.[0])} />
          <button className="btn btn-primary mt-4" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Processing…" : "Choose file"}</button>
        </div>
        <form className="glass p-5 space-y-3" onSubmit={addManual}>
          <b>Or type a topic</b>
          <input className="input" required minLength={2} maxLength={200} placeholder="e.g. Photosynthesis, Binary Search, Newton's Laws" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} />
          <textarea className="input" rows={3} maxLength={20000} placeholder="Optional: paste your notes for this topic" value={manual.text} onChange={(e) => setManual({ ...manual, text: e.target.value })} />
          <button className="btn btn-primary" disabled={busy}>Add & start learning</button>
        </form>
      </div>

      {!rows ? <Spinner /> : !rows.length ? <Empty icon="📭" title="No documents yet" body="Upload a PDF, DOCX, PPTX or text file to begin." /> : (
        <div className="grid md:grid-cols-2 gap-4">
          {rows.map((r) => (
            <div key={r.id} className="glass p-4">
              <div className="font-bold truncate">📄 {r.title}</div>
              <div className="text-xs text-muted mt-1">{r.pages} pages · {r.topics} topics · {r.completed} completed</div>
              <div className="h-1.5 rounded bg-white/10 mt-3"><div className="h-full rounded" style={{ width: `${r.topics ? (r.completed / r.topics) * 100 : 0}%`, background: "var(--accent)" }} /></div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button className="btn btn-sm btn-primary" onClick={() => nav(`/app/classroom?doc=${r.id}`)}>🏫 Open in classroom</button>
                <button className="btn btn-sm" onClick={() => view(r.id)}>🗺️ Roadmap</button>
                <button className="btn btn-sm" onClick={() => nav(`/app/study?doc=${r.id}`)}>📝 Quiz & notes</button>
                <button className="btn btn-sm btn-danger" onClick={() => del(r.id)}>Delete</button>
              </div>
            </div>))}
        </div>)}

      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setOpen(null)} role="dialog" aria-modal="true" aria-label="Chapter roadmap">
          <div className="glass p-5 w-full max-w-2xl max-h-[85vh] overflow-auto" style={{ background: "var(--bg2)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3"><h3 className="font-bold text-lg">🗺️ {open.title}</h3><button className="btn btn-sm" onClick={() => setOpen(null)}>✕</button></div>
            {open.analysis && (
              <div className="glass p-3 mb-3 text-xs space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">{open.analysis.doc_type === "exam_paper" ? "📝 Exam paper — questions become topics" : open.analysis.doc_type === "slides" ? "🖼 Slides" : "📘 Notes / textbook"}</span>
                  <button className="btn btn-sm ml-auto" onClick={async () => { try { await api(`/documents/${open.id}/reanalyze`, { method: "POST", body: {} }); setOpen(await api<DocDetail>(`/documents/${open.id}`)); load(); toast("Document re-analysed."); } catch (e: any) { toast(e.message, "err"); } }}>↻ Re-analyse</button>
                </div>
                {open.analysis.warnings.map((w, i) => <p key={i} style={{ color: "#fbbf24" }}>⚠️ {w}</p>)}
                {open.analysis.ignored.length > 0 && (
                  <details><summary className="cursor-pointer text-muted">🚫 {open.analysis.ignored.length} lines set aside as non-teaching (headers, footers, page numbers, exam/cover info) — never spoken</summary>
                    <ul className="mt-1 list-disc ml-5 text-muted">{open.analysis.ignored.map((l, i) => <li key={i}>{l}</li>)}</ul></details>)}
              </div>)}
            {open.roadmap.map((t, i) => (
              <div key={t.id} className="py-3 border-b last:border-0" style={{ borderColor: "var(--panel-border)" }}>
                <div className="flex items-center gap-2"><span className="chip">{i + 1}</span><b className="flex-1">{open.progress[t.id]?.completed ? "✅ " : ""}{t.title}</b>
                  {t.marks ? <span className="chip">{t.marks} marks</span> : null}{t.kind !== "question" && <span className="text-xs text-muted">p.{t.page}</span>}
                  <button className="btn btn-sm btn-primary" onClick={() => nav(`/app/classroom?doc=${open.id}&topic=${t.id}`)}>Teach</button></div>
                {t.concepts && t.concepts.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5" aria-label="Key concepts">{t.concepts.map((c, k) => (
                    <span key={k} className="chip" title={c.evidence} style={{ opacity: c.importance === "high" ? 1 : 0.7 }}>{c.kind === "definition" ? "📖" : c.kind === "formula" ? "📐" : "🔑"} {c.term}</span>))}</div>)}
                {t.kind !== "question" && t.summary && <p className="text-xs text-muted mt-1.5 line-clamp-2">{t.summary}</p>}
              </div>))}
          </div>
        </div>)}
    </Page>
  );
}
