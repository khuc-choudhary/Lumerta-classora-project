import { useState } from "react";

const SB_KEY = "lumetra.sidebarWidth", SB_MIN = 72, SB_MAX = 360, SB_DEFAULT = 256;
const loadSb = () => { try { const n = Number(localStorage.getItem(SB_KEY)); return n >= SB_MIN && n <= SB_MAX ? n : SB_DEFAULT; } catch { return SB_DEFAULT; } };
const saveSb = (n: number) => { try { localStorage.setItem(SB_KEY, String(n)); } catch { /* storage unavailable */ } };
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useApp } from "../store";
import { Logo } from "./ui";

const NAV = [
  ["/app", "🏠", "Dashboard", true], ["/app/classroom", "🏫", "Classroom"], ["/app/documents", "📚", "Documents"], ["/app/study", "📝", "Quiz & Notes"],
  ["/app/history", "🕘", "Learning History"], ["/app/library", "🗂️", "Saved Library"], ["/app/studio", "🎛️", "Teacher Studio"], ["/app/pronunciation", "🔊", "Pronunciation"], ["/app/themes", "🎨", "Themes"], ["/app/profile", "👤", "Profile & Privacy"],
] as const;

export default function Shell() {
  const { user, logout, prefs } = useApp(); const nav = useNavigate(); const [open, setOpen] = useState(false);
  const [sbw, setSbw] = useState(loadSb);            // desktop sidebar width (drag its right edge; narrow = icons only)
  const mini = sbw < 150;
  const name = prefs.teacher_name || (prefs.teacher === "aira" ? "AIRA" : "NEX");
  const links = (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(([to, icon, label, end]) => (
        <NavLink key={to} to={to} end={!!end} onClick={() => setOpen(false)} title={label}
          className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition ${isActive ? "text-white" : "text-muted hover:bg-white/10"}`}
          style={({ isActive }) => (isActive ? { background: "linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 55%,var(--accent2)))" } : undefined)}>
          <span aria-hidden>{icon}</span><span className={mini ? "lg:hidden" : ""}>{label}</span>
        </NavLink>))}
    </nav>
  );
  return (
    <div className="lg:flex min-h-screen">
      <header className="lg:hidden h-14 flex items-center justify-between px-3 glass !rounded-none sticky top-0 z-40">
        <button className="btn btn-sm" onClick={() => setOpen(true)} aria-label="Open menu">☰</button><Logo size={28} />
        <button className="btn btn-sm" onClick={() => nav("/app/classroom")}>🏫</button>
      </header>
      {open && <div className="lg:hidden fixed inset-0 z-50 bg-black/60" onClick={() => setOpen(false)} />}
      <aside className={`fixed lg:sticky top-0 z-50 h-screen w-64 lg:w-[var(--sbw)] shrink-0 ${mini ? "p-4 lg:px-2" : "p-4"} flex flex-col gap-5 glass !rounded-none transition-transform ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`} style={{ background: "var(--panel)", ["--sbw" as any]: `${sbw}px` }}>
        <div className={`px-1 pt-1 ${mini ? "lg:hidden" : ""}`}><Logo /></div>
        {links}
        <div className={`mt-auto glass p-3 text-sm ${mini ? "lg:hidden" : ""}`}>
          <div className="text-muted text-xs">Your teacher</div>
          <div className="font-extrabold tracking-widest">{name}</div>
          <div className="text-xs text-muted truncate mt-2">{user?.is_guest ? "Guest (not saved)" : user?.name} · 🔥 {user?.streak ?? 0}-day streak</div>
          {user?.is_guest ? (
            <div className="flex gap-1.5 mt-2"><button className="btn btn-sm btn-primary flex-1" onClick={() => nav("/signup")}>Sign up</button><button className="btn btn-sm flex-1" onClick={() => nav("/login")}>Log in</button></div>
          ) : <button className="btn btn-sm w-full mt-2" onClick={() => { logout(); nav("/"); }}>Log out</button>}
        </div>
        {/* resize handle (desktop): drag to make the menu wider / narrower; double-click to collapse or expand */}
        <div className="hidden lg:block absolute top-0 bottom-0 -right-1.5 w-3 cursor-col-resize group z-10" role="separator" aria-orientation="vertical" aria-label="Resize menu" title="Drag to resize · double-click to collapse"
          onDoubleClick={() => { const n = mini ? SB_DEFAULT : SB_MIN; setSbw(n); saveSb(n); }}
          onPointerDown={(e) => {
            const el = e.currentTarget; el.setPointerCapture(e.pointerId);
            const left = el.parentElement!.getBoundingClientRect().left; let last = sbw;
            const mv = (ev: PointerEvent) => { const w = ev.clientX - left; last = w < 120 ? SB_MIN : Math.min(SB_MAX, Math.max(150, w)); setSbw(last); };
            const upf = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", upf); saveSb(last); };
            el.addEventListener("pointermove", mv); el.addEventListener("pointerup", upf);
          }}>
          <div className="mx-auto h-full w-0.5 rounded opacity-0 group-hover:opacity-60 transition" style={{ background: "var(--accent)" }} />
        </div>
      </aside>
      <main className="flex-1 min-w-0"><Outlet /></main>
    </div>
  );
}
