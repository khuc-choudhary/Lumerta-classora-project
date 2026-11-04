import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Avatar, AVATAR_BG } from "../components/Avatar";
import { Page, Spinner } from "../components/ui";
import { useApp } from "../store";

interface Dash {
  streak: number; documents: { id: number; title: string; topics: number }[]; completed_topics: number;
  continue: null | { document_id: number; doc: string; topic_id: string; topic: string; completed: boolean };
  quiz_scores: { title: string; score: number }[]; weak_topics: { topic: string; score: number }[]; notes: number; boards: number; doubts: number;
}

export default function Dashboard() {
  const { user, prefs, toast } = useApp(); const nav = useNavigate();
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { api<Dash>("/dashboard").then(setD).catch((e) => toast(e.message, "err")); }, [toast]);
  const name = prefs.teacher_name || (prefs.teacher === "aira" ? "AIRA" : "NEX");
  const hour = new Date().getHours(); const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  if (!d) return <Spinner label="Loading your dashboard…" />;
  const stat = (v: number | string, l: string, i: string) => <div className="glass p-4"><div className="text-2xl">{i}</div><div className="text-3xl font-extrabold mt-1">{v}</div><div className="text-xs text-muted">{l}</div></div>;
  const avg = d.quiz_scores.length ? Math.round(d.quiz_scores.reduce((s, q) => s + q.score, 0) / d.quiz_scores.length) : null;
  return (
    <Page title={`${greet}, ${user?.name.split(" ")[0]} 👋`} sub="Ready to learn something new today?">
      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <div className="glass p-5 lg:col-span-2 flex items-center gap-5 flex-wrap">
          <div className="rounded-2xl shrink-0" style={{ background: AVATAR_BG[prefs.avatar_look.bg] ?? AVATAR_BG.classroom }}><Avatar prefs={prefs} speaking={false} emotion="friendly" gesture="open" pulse={0} size={130} /></div>
          <div className="flex-1 min-w-[14rem]">
            <div className="text-xs text-muted">Your teacher</div><div className="text-2xl font-extrabold tracking-widest">{name}</div>
            {d.continue ? (<>
              <p className="text-sm text-muted mt-1">{d.continue.completed ? "Last completed" : "Continue where you left off"}: <b className="text-[var(--text)]">{d.continue.topic}</b> <span className="opacity-70">({d.continue.doc})</span></p>
              <button className="btn btn-primary mt-3" onClick={() => nav(`/app/classroom?doc=${d.continue!.document_id}&topic=${d.continue!.topic_id}`)}>▶ Continue learning</button>
            </>) : <p className="text-sm text-muted mt-1">Upload your first document or just ask {name} a question.</p>}
            <div className="flex flex-wrap gap-2 mt-3"><Link to="/app/classroom" className="btn btn-sm">Start learning</Link><Link to="/app/documents" className="btn btn-sm">Upload document</Link></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">{stat(`🔥 ${user?.streak ?? 0}`, "Day streak", "")}{stat(d.completed_topics, "Topics completed", "✅")}{stat(avg === null ? "—" : `${avg}%`, "Avg quiz score", "🎯")}{stat(d.doubts, "Doubts asked", "🙋")}</div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <section className="glass p-5"><h2 className="font-bold mb-3">Recent documents</h2>
          {d.documents.length ? d.documents.map((x) => <Link key={x.id} to={`/app/classroom?doc=${x.id}`} className="flex justify-between py-2 border-b last:border-0 hover:opacity-80" style={{ borderColor: "var(--panel-border)" }}><span className="truncate">📄 {x.title}</span><span className="text-xs text-muted">{x.topics} topics</span></Link>) : <p className="text-sm text-muted">No documents yet.</p>}
        </section>
        <section className="glass p-5"><h2 className="font-bold mb-3">Quiz scores</h2>
          {d.quiz_scores.length ? d.quiz_scores.map((q, i) => <div key={i} className="mb-2"><div className="flex justify-between text-sm"><span className="truncate">{q.title}</span><b>{q.score}%</b></div><div className="h-1.5 rounded bg-white/10"><div className="h-full rounded" style={{ width: `${q.score}%`, background: q.score >= 60 ? "var(--accent)" : "#f87171" }} /></div></div>) : <p className="text-sm text-muted">Take a quiz after a topic to see scores here.</p>}
        </section>
        <section className="glass p-5"><h2 className="font-bold mb-3">Weak topics</h2>
          {d.weak_topics.length ? d.weak_topics.map((w) => <div key={w.topic} className="flex justify-between text-sm py-1.5"><span>⚠️ {w.topic}</span><span className="text-red-400">{w.score}%</span></div>) : <p className="text-sm text-muted">Nothing flagged. Topics scoring under 60% will appear here for revision.</p>}
          {d.weak_topics.length > 0 && <Link to="/app/study" className="btn btn-sm mt-3">Practice weak topics</Link>}
        </section>
        <section className="glass p-5"><h2 className="font-bold mb-3">Your library</h2>
          <div className="grid grid-cols-2 gap-3 text-center"><Link to="/app/library" className="glass p-3"><div className="text-2xl font-extrabold">{d.notes}</div><div className="text-xs text-muted">Saved notes</div></Link><Link to="/app/library" className="glass p-3"><div className="text-2xl font-extrabold">{d.boards}</div><div className="text-xs text-muted">Saved boards</div></Link></div>
        </section>
      </div>
    </Page>
  );
}
