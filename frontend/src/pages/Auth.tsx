import { motion } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { Field, Logo, PasswordInput } from "../components/ui";
import { useApp } from "../store";
import type { User } from "../types";

const GOOGLE_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

function Shell({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex flex-col justify-between p-12 relative overflow-hidden">
        <Link to="/"><Logo size={42} /></Link>
        <div>
          <h2 className="text-5xl font-extrabold leading-tight">Your classroom.<br /><span className="grad-text">Your AI.</span><br />Your way.</h2>
          <p className="text-muted mt-5 max-w-md">A personal AI teacher that speaks your language — Hindi, English, Hinglish — draws on a real blackboard, and teaches from your own study material.</p>
        </div>
        <p className="text-xs text-muted">Meet AIRA & NEX, the AI teachers inside LUMETRA CLASSORA.</p>
      </div>
      <div className="flex items-center justify-center p-5">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass w-full max-w-md p-7">
          <div className="lg:hidden mb-5"><Logo /></div>
          <h1 className="text-2xl font-extrabold">{title}</h1><p className="text-muted text-sm mb-5">{sub}</p>
          {children}
        </motion.div>
      </div>
    </div>
  );
}

function GoogleButton({ onDone }: { onDone: (t: string, u: User) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { toast } = useApp();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!GOOGLE_ID) return;
    const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => {
      const g = (window as any).google; if (!g || !ref.current) return;
      g.accounts.id.initialize({ client_id: GOOGLE_ID, callback: async (r: any) => { try { const d = await api<{ token: string; user: User }>("/auth/google", { method: "POST", body: { credential: r.credential } }); onDone(d.token, d.user); } catch (e: any) { toast(e.message, "err"); } } });
      g.accounts.id.renderButton(ref.current, { theme: "filled_black", size: "large", width: 340, text: "continue_with" }); setReady(true);
    };
    document.body.appendChild(s); return () => { s.remove(); };
    // eslint-disable-next-line
  }, []);
  if (!GOOGLE_ID) return <button type="button" className="btn w-full" onClick={() => toast("Google sign-in isn't configured yet. Set VITE_GOOGLE_CLIENT_ID (frontend) and GOOGLE_CLIENT_ID (backend).", "err")}>Continue with Google</button>;
  return <div ref={ref} className="flex justify-center min-h-[44px]" aria-busy={!ready} />;
}

function useAuthForm(kind: "login" | "signup") {
  const { login, toast } = useApp(); const nav = useNavigate();
  const [f, setF] = useState({ name: "", email: "", password: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const d = await api<{ token: string; user: User }>(`/auth/${kind}`, { method: "POST", body: kind === "signup" ? f : { email: f.email, password: f.password } });
      login(d.token, d.user);
      if (kind === "signup") toast("Account created! Check your email to verify it (link is printed in the server log if SMTP isn't set).");
      nav(d.user.prefs.onboarded ? "/app" : "/welcome");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return { f, setF, busy, err, submit, login, nav };
}

export function Login() {
  const { user } = useApp(); const a = useAuthForm("login");
  if (user && !user.is_guest) return <Navigate to="/app" replace />;
  return (
    <Shell title="Welcome back" sub="Log in to continue learning.">
      <form onSubmit={a.submit} className="space-y-4">
        <Field label="Email"><input className="input" type="email" required autoComplete="email" value={a.f.email} onChange={(e) => a.setF({ ...a.f, email: e.target.value })} /></Field>
        <Field label="Password"><PasswordInput required autoComplete="current-password" value={a.f.password} onChange={(e) => a.setF({ ...a.f, password: e.target.value })} /></Field>
        {a.err && <p role="alert" className="text-sm text-red-400">{a.err}</p>}
        <button className="btn btn-primary w-full" disabled={a.busy}>{a.busy ? "Logging in…" : "Log in"}</button>
        <div className="text-center text-xs text-muted">or</div>
        <GoogleButton onDone={(t, u) => { a.login(t, u); a.nav(u.prefs.onboarded ? "/app" : "/welcome"); }} />
        <div className="flex justify-between text-sm"><Link to="/forgot" className="text-muted hover:underline">Forgot password?</Link><Link to="/signup" className="grad-text font-semibold">Create account</Link></div>
      </form>
    </Shell>
  );
}

export function Signup() {
  const { user } = useApp(); const a = useAuthForm("signup");
  if (user && !user.is_guest) return <Navigate to="/app" replace />;
  return (
    <Shell title="Create your classroom" sub="Free to start. Your documents and learning history stay private to you.">
      <form onSubmit={a.submit} className="space-y-4">
        <Field label="Your name"><input className="input" required maxLength={80} autoComplete="name" value={a.f.name} onChange={(e) => a.setF({ ...a.f, name: e.target.value })} /></Field>
        <Field label="Email"><input className="input" type="email" required autoComplete="email" value={a.f.email} onChange={(e) => a.setF({ ...a.f, email: e.target.value })} /></Field>
        <Field label="Password" hint="At least 8 characters."><PasswordInput required minLength={8} autoComplete="new-password" value={a.f.password} onChange={(e) => a.setF({ ...a.f, password: e.target.value })} /></Field>
        {a.err && <p role="alert" className="text-sm text-red-400">{a.err}</p>}
        <button className="btn btn-primary w-full" disabled={a.busy}>{a.busy ? "Creating…" : "Sign up"}</button>
        <div className="text-center text-xs text-muted">or</div>
        <GoogleButton onDone={(t, u) => { a.login(t, u); a.nav(u.prefs.onboarded ? "/app" : "/welcome"); }} />
        <p className="text-sm text-center text-muted">Already have an account? <Link to="/login" className="grad-text font-semibold">Log in</Link></p>
      </form>
    </Shell>
  );
}

export function Forgot() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  return (
    <Shell title="Forgot password" sub="We'll email you a reset link.">
      {done ? <p className="text-sm">{done}</p> : (
        <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { const r = await api<{ message: string }>("/auth/forgot", { method: "POST", body: { email } }); setDone(r.message); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
          <Field label="Email"><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
          <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>)}
      <p className="text-sm mt-4"><Link to="/login" className="text-muted hover:underline">← Back to login</Link></p>
    </Shell>
  );
}

export function Reset() {
  const [sp] = useSearchParams(); const nav = useNavigate(); const { toast } = useApp();
  const [pw, setPw] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  return (
    <Shell title="Reset password" sub="Choose a new password.">
      <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(""); try { await api("/auth/reset", { method: "POST", body: { token: sp.get("token") ?? "", password: pw } }); toast("Password updated. Please log in."); nav("/login"); } catch (x: any) { setErr(x.message); } finally { setBusy(false); } }}>
        <Field label="New password" hint="At least 8 characters."><PasswordInput minLength={8} required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
        {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Update password"}</button>
      </form>
    </Shell>
  );
}

export function Verify() {
  const [sp] = useSearchParams(); const [state, setState] = useState<"busy" | "ok" | string>("busy");
  useEffect(() => { api("/auth/verify", { method: "POST", body: { token: sp.get("token") ?? "" } }).then(() => setState("ok")).catch((e) => setState(e.message)); }, [sp]);
  return (
    <Shell title="Email verification" sub="">
      <p>{state === "busy" ? "Verifying…" : state === "ok" ? "✅ Your email is verified." : state}</p>
      <Link to="/app" className="btn btn-primary mt-4">Go to LUMETRA CLASSORA</Link>
    </Shell>
  );
}

