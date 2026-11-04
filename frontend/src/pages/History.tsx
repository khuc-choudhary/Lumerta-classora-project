import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Empty, Page, Spinner } from "../components/ui";
import { useApp } from "../store";

interface Ev { type: "lesson" | "doubt" | "quiz"; title: string; detail: string; status: string; at: string }
const ICON = { lesson: "📖", doubt: "🙋", quiz: "🎯" } as const;
const LABEL = { lesson: "Lesson", doubt: "Doubt asked", quiz: "Quiz" } as const;

export default function History() {
  const { user, toast } = useApp(); const nav = useNavigate();
  const [data, setData] = useState<{ events: Ev[]; totals: { lessons: number; doubts: number; quizzes: number } } | null>(null);
  const [filter, setFilter] = useState<"all" | Ev["type"]>("all");
  useEffect(() => { if (user && !user.is_guest) api<any>("/history").then(setData).catch((e) => toast(e.message, "err")); }, [user, toast]);

  if (user?.is_guest) return (
    <Page title="Learning History" sub="What you've learned, day by day.">
      <Empty icon="🔒" title="Log in to keep your history" body="You're learning as a guest. Sign up (free) and everything you've done so far is saved here — lessons, doubts and quiz results."
        action={<div className="flex gap-2 justify-center"><button className="btn btn-primary" onClick={() => nav("/signup")}>Sign up</button><button className="btn" onClick={() => nav("/login")}>Log in</button></div>} />
    </Page>
  );
  if (!data) return <Spinner label="Loading your history…" />;

  const shown = data.events.filter((e) => filter === "all" || e.type === filter);
  const groups: Record<string, Ev[]> = {};
  shown.forEach((e) => { const k = new Date(e.at + (e.at.endsWith("Z") || e.at.includes("+") ? "" : "Z")).toDateString(); (groups[k] ||= []).push(e); });
  const time = (s: string) => new Date(s + (s.endsWith("Z") || s.includes("+") ? "" : "Z")).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <Page title="Learning History" sub="Everything you've learned and asked — most recent first.">
      <div className="grid grid-cols-3 gap-3 mb-5 text-center">
        {([["lessons", "Topics completed", "📖"], ["doubts", "Doubts asked", "🙋"], ["quizzes", "Quizzes taken", "🎯"]] as const).map(([k, l, i]) => <div key={k} className="glass p-4"><div className="text-xl">{i}</div><div className="text-3xl font-extrabold">{data.totals[k]}</div><div className="text-xs text-muted">{l}</div></div>)}
      </div>
      <div className="flex gap-2 flex-wrap mb-4">{(["all", "lesson", "doubt", "quiz"] as const).map((f) => <button key={f} aria-pressed={filter === f} className={`btn btn-sm ${filter === f ? "btn-primary" : ""}`} onClick={() => setFilter(f)}>{f === "all" ? "All" : LABEL[f] + "s"}</button>)}</div>
      {!shown.length ? <Empty icon="🕘" title="Nothing here yet" body="Start a lesson, ask a doubt or take a quiz and it will appear here." action={<button className="btn btn-primary" onClick={() => nav("/app/classroom")}>Go to classroom</button>} /> : (
        <div className="space-y-6">
          {Object.entries(groups).map(([day, evs]) => (
            <section key={day}><h2 className="text-sm font-bold text-muted mb-2 uppercase tracking-wider">{day === new Date().toDateString() ? "Today" : day}</h2>
              <div className="space-y-2">{evs.map((e, i) => (
                <div key={i} className="glass p-3 flex items-start gap-3">
                  <div className="text-xl" aria-hidden>{ICON[e.type]}</div>
                  <div className="flex-1 min-w-0"><div className="text-xs text-muted">{LABEL[e.type]}{e.status && ` · ${e.status}`}</div><div className="font-semibold break-words">{e.title}</div>{e.detail && <div className="text-xs text-muted truncate">{e.detail}</div>}</div>
                  <div className="text-xs text-muted shrink-0">{time(e.at)}</div>
                </div>))}</div></section>))}
        </div>)}
    </Page>
  );
}
