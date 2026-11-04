import { motion } from "framer-motion";
import { useState, type ReactNode } from "react";

export function Logo({ size = 34, text = true }: { size?: number; text?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
        <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent2)" /></linearGradient></defs>
        <rect width="64" height="64" rx="16" fill="url(#lg)" />
        <path d="M20 14v30h22" fill="none" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="44" cy="22" r="5" fill="#fff" />
      </svg>
      {text && <span className="leading-none"><b className="tracking-[.18em] text-[.95rem] block">LUMETRA</b><span className="grad-text tracking-[.32em] text-[.62rem] font-bold">CLASSORA</span></span>}
    </span>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <div className="flex items-center justify-center gap-3 p-8 text-muted" role="status"><span className="h-5 w-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--accent)", borderTopColor: "transparent" }} />{label}</div>;
}

export function LoadingScreen() {
  return (
    <div className="min-h-screen grid place-items-center">
      <motion.div initial={{ opacity: 0, scale: .9 }} animate={{ opacity: 1, scale: 1 }} className="text-center">
        <div className="float inline-block"><Logo size={64} text={false} /></div>
        <div className="mt-4"><b className="tracking-[.3em]">LUMETRA</b> <span className="grad-text tracking-[.3em] font-bold">CLASSORA</span></div>
        <p className="text-muted text-sm mt-2">Preparing your classroom…</p>
      </motion.div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block"><span className="text-xs font-semibold text-muted uppercase tracking-wider">{label}</span><div className="mt-1.5">{children}</div>{hint && <p className="text-xs text-muted mt-1">{hint}</p>}</label>;
}

export function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className="input !pr-12" />
      <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 text-lg text-muted hover:opacity-80" title={show ? "Hide password" : "Show password"}>
        {show ? "🙈" : "👁️"}
      </button>
    </div>
  );
}

export function Empty({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  return <div className="glass p-10 text-center"><div className="text-4xl mb-3">{icon}</div><h3 className="font-bold text-lg">{title}</h3><p className="text-muted text-sm mt-1 mb-4">{body}</p>{action}</div>;
}

export function Page({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }} className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div><h1 className="text-2xl md:text-3xl font-extrabold">{title}</h1>{sub && <p className="text-muted mt-1">{sub}</p>}</div>{actions}
      </div>
      {children}
    </motion.div>
  );
}
