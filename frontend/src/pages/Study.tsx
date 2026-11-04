import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Empty, Field, Page, Spinner } from "../components/ui";
import { useApp } from "../store";
import type { DocDetail } from "../types";

interface Q { q: string; type: string; options?: string[] | null }
interface Result { score: number; correct: number; total: number; results: { q: string; your: string; answer: string; correct: boolean; explain: string }[] }
interface Notes { title: string; source: string; summary: string; key_points: string[]; definitions: string[]; formulas: string[]; flashcards: { q: string; a: string }[] }

export default function Study() {
  const { toast } = useApp(); const [sp] = useSearchParams();
  const [docs, setDocs] = useState<{ id: number; title: string }[] | null>(null);
  const [docId, setDocId] = useState(sp.get("doc") ?? ""); const [doc, setDoc] = useState<DocDetail | null>(null);
  const [topic, setTopic] = useState(""); const [tab, setTab] = useState<"quiz" | "notes">("quiz");
  useEffect(() => { api("/documents").then(setDocs).catch((e) => toast(e.message, "err")); }, [toast]);
  useEffect(() => { setDoc(null); setTopic(""); if (docId) api<DocDetail>(`/documents/${docId}`).then(setDoc).catch((e) => toast(e.message, "err")); }, [docId, toast]);

  if (!docs) return <Spinner />;
  if (!docs.length) return <Page title="Quiz & Notes" sub=""><Empty icon="📚" title="Upload a document first" body="Quizzes and notes are generated from your own study material." /></Page>;
  return (
    <Page title="Quiz & Notes" sub="Practice, exam preparation, flashcards and revision sheets — built from your material.">
      <div className="glass p-4 grid sm:grid-cols-3 gap-3 mb-5">
        <Field label="Document"><select className="input" value={docId} onChange={(e) => setDocId(e.target.value)}><option value="">Choose…</option>{docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</select></Field>
        <Field label="Chapter / topic"><select className="input" value={topic} disabled={!doc} onChange={(e) => setTopic(e.target.value)}><option value="">Whole document</option>{doc?.roadmap.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select></Field>
        <div className="flex items-end gap-2"><button className={`btn flex-1 ${tab === "quiz" ? "btn-primary" : ""}`} onClick={() => setTab("quiz")}>🎯 Quiz</button><button className={`btn flex-1 ${tab === "notes" ? "btn-primary" : ""}`} onClick={() => setTab("notes")}>🗒️ Notes</button></div>
      </div>
      {!docId ? <Empty icon="👆" title="Choose a document" body="Then pick a topic and generate a quiz or notes." /> : tab === "quiz" ? <Quiz docId={Number(docId)} topic={topic} /> : <NotesView docId={Number(docId)} topic={topic} />}
    </Page>
  );
}

function Quiz({ docId, topic }: { docId: number; topic: string }) {
  const { toast } = useApp();
  const [diff, setDiff] = useState("medium"); const [count, setCount] = useState(5);
  const [quiz, setQuiz] = useState<{ quiz_id: number; title: string; questions: Q[] } | null>(null);
  const [ans, setAns] = useState<string[]>([]); const [res, setRes] = useState<Result | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setQuiz(null); setRes(null); }, [docId, topic]);
  const gen = async () => {
    setBusy(true); setRes(null);
    try { const r = await api<any>("/quiz/generate", { method: "POST", body: { document_id: docId, topic_id: topic || null, difficulty: diff, count } }); setQuiz(r); setAns(Array(r.questions.length).fill("")); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true);
    try { setRes(await api<Result>("/quiz/submit", { method: "POST", body: { quiz_id: quiz!.quiz_id, answers: ans } })); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="glass p-4 flex flex-wrap items-end gap-3">
        <Field label="Difficulty"><select className="input" value={diff} onChange={(e) => setDiff(e.target.value)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></Field>
        <Field label="Questions"><input className="input !w-24" type="number" min={1} max={10} value={count} onChange={(e) => setCount(Math.min(10, Math.max(1, +e.target.value || 1)))} /></Field>
        <button className="btn btn-primary" onClick={gen} disabled={busy}>{busy && !quiz ? "Generating…" : quiz ? "New quiz" : "Generate quiz"}</button>
      </div>
      {quiz && !res && (
        <div className="space-y-3">
          <h2 className="font-bold text-lg">{quiz.title}</h2>
          {quiz.questions.map((q, i) => (
            <div key={i} className="glass p-4"><div className="font-semibold mb-2">{i + 1}. {q.q}</div>
              {q.options?.length ? <div className="grid sm:grid-cols-2 gap-2">{q.options.map((o) => <button key={o} aria-pressed={ans[i] === o} onClick={() => setAns(ans.map((a, k) => (k === i ? o : a)))} className={`btn justify-start text-left ${ans[i] === o ? "sel" : ""}`}>{o}</button>)}</div>
                : q.type === "tf" ? <div className="flex gap-2">{["True", "False"].map((o) => <button key={o} aria-pressed={ans[i] === o} onClick={() => setAns(ans.map((a, k) => (k === i ? o : a)))} className={`btn ${ans[i] === o ? "sel" : ""}`}>{o}</button>)}</div>
                : <textarea className="input" rows={2} value={ans[i]} onChange={(e) => setAns(ans.map((a, k) => (k === i ? e.target.value : a)))} placeholder="Your answer" />}
            </div>))}
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? "Checking…" : "Submit answers"}</button>
        </div>)}
      {res && (
        <div className="space-y-3">
          <div className="glass p-5 text-center"><div className="text-5xl font-extrabold grad-text">{res.score}%</div><div className="text-muted">{res.correct} of {res.total} correct · {res.score >= 60 ? "Great work! Topic marked complete 🎉" : "Let's revise this topic and try again."}</div></div>
          {res.results.map((r, i) => <div key={i} className="glass p-4" style={{ borderColor: r.correct ? "#4ade80" : "#f87171" }}><div className="font-semibold">{r.correct ? "✅" : "❌"} {r.q}</div><div className="text-sm mt-1">Your answer: {r.your || "—"}</div>{!r.correct && <div className="text-sm">Correct answer: <b>{r.answer}</b></div>}{r.explain && <div className="text-xs text-muted mt-1">{r.explain}</div>}</div>)}
          <button className="btn" onClick={() => { setQuiz(null); setRes(null); }}>Try another quiz</button>
        </div>)}
    </div>
  );
}

function NotesView({ docId, topic }: { docId: number; topic: string }) {
  const { toast } = useApp(); const [n, setN] = useState<Notes | null>(null); const [busy, setBusy] = useState(false); const [flip, setFlip] = useState<number | null>(null);
  useEffect(() => setN(null), [docId, topic]);
  const gen = async () => { setBusy(true); try { setN(await api<Notes>("/notes/generate", { method: "POST", body: { document_id: docId, topic_id: topic || null } })); } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); } };
  const save = async () => { try { await api("/items/note", { method: "POST", body: { title: n!.title, data: n } }); toast("Saved to your library ✔"); } catch (e: any) { toast(e.message, "err"); } };
  return (
    <div className="space-y-4">
      <div className="flex gap-2"><button className="btn btn-primary" onClick={gen} disabled={busy}>{busy ? "Generating…" : "Generate notes"}</button>{n && <><button className="btn" onClick={save}>💾 Save</button><button className="btn" onClick={() => window.print()}>🖨 Print / PDF</button></>}</div>
      {n && (<div className="glass p-5 space-y-4" id="notes">
        {n.source === "extractive" && <p className="chip">Basic mode: key sentences extracted from your document. Connect an AI provider for fuller notes.</p>}
        <h2 className="text-xl font-extrabold">{n.title}</h2>
        {n.summary && <section><h3 className="font-bold">Summary</h3><p className="text-sm text-muted">{n.summary}</p></section>}
        {n.key_points?.length > 0 && <section><h3 className="font-bold">Key points</h3><ul className="list-disc ml-5 text-sm space-y-1">{n.key_points.map((k, i) => <li key={i}>{k}</li>)}</ul></section>}
        {n.definitions?.length > 0 && <section><h3 className="font-bold">Definitions</h3><ul className="list-disc ml-5 text-sm space-y-1">{n.definitions.map((k, i) => <li key={i}>{k}</li>)}</ul></section>}
        {n.formulas?.length > 0 && <section><h3 className="font-bold">Formula sheet</h3><div className="flex flex-wrap gap-2">{n.formulas.map((f, i) => <code key={i} className="chip !text-sm">{f}</code>)}</div></section>}
        {n.flashcards?.length > 0 && <section><h3 className="font-bold mb-2">Flashcards <span className="text-xs text-muted">(click to flip)</span></h3><div className="grid sm:grid-cols-2 gap-2">{n.flashcards.map((c, i) => <button key={i} className="glass p-4 text-left min-h-[5rem]" onClick={() => setFlip(flip === i ? null : i)}>{flip === i ? <span><b>A:</b> {c.a}</span> : <span><b>Q:</b> {c.q}</span>}</button>)}</div></section>}
      </div>)}
    </div>
  );
}
