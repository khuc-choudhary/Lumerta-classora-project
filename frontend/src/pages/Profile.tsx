import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { Field, Page, PasswordInput } from "../components/ui";
import { useApp } from "../store";

export default function Profile() {
  const { user, setUser, toast, logout } = useApp(); const nav = useNavigate();
  const [name, setName] = useState(user?.name ?? ""); const [pw, setPw] = useState({ current: "", new: "" });
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok); } catch (e: any) { toast(e.message, "err"); } };
  if (user?.is_guest) return (
    <Page title="Profile & Privacy" sub="You're using LUMETRA CLASSORA as a guest.">
      <div className="glass p-6 space-y-3 max-w-xl">
        <p className="text-sm text-muted">Guest sessions work fully, but are tied to this browser. Create a free account to keep your documents, progress and learning history on any device — everything you've done so far is kept.</p>
        <div className="flex gap-2"><button className="btn btn-primary" onClick={() => nav("/signup")}>Sign up & keep my progress</button><button className="btn" onClick={() => nav("/login")}>Log in</button></div>
        <p className="text-xs text-muted">Logging in to an existing account switches to that account; this guest session's data stays behind.</p>
      </div>
    </Page>
  );
  return (
    <Page title="Profile & Privacy" sub={user?.email}>
      <div className="grid md:grid-cols-2 gap-4">
        <form className="glass p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => setUser(await api("/me", { method: "PATCH", body: { name } })), "Profile updated."); }}>
          <h3 className="font-bold">Account</h3>
          <Field label="Name"><input className="input" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <p className="text-xs text-muted">Email: {user?.email} · {user?.verified ? "✅ verified" : "⚠️ not verified yet"}</p>
          <button className="btn btn-primary">Save</button>
        </form>
        <form className="glass p-5 space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await api("/me/password", { method: "POST", body: pw }); setPw({ current: "", new: "" }); }, "Password changed."); }}>
          <h3 className="font-bold">Change password</h3>
          <Field label="Current password"><PasswordInput required autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password"><PasswordInput required minLength={8} autoComplete="new-password" value={pw.new} onChange={(e) => setPw({ ...pw, new: e.target.value })} /></Field>
          <button className="btn btn-primary">Update</button>
          <p className="text-xs text-muted">Google-only accounts have no password to change.</p>
        </form>
        <div className="glass p-5 md:col-span-2 space-y-3">
          <h3 className="font-bold">Privacy & data</h3>
          <ul className="text-sm text-muted list-disc ml-5 space-y-1">
            <li>Your documents, progress, notes and boards are private to your account.</li>
            <li>Voice: the browser converts speech to text (Chrome/Edge use their vendor's speech service). We never record or store audio. The mic indicator is always visible while on.</li>
            <li>Teach Me Like This: reference clips stay on your device; only derived style numbers are stored.</li>
            <li>Lesson text you ask about is sent to the configured AI provider to produce answers.</li>
          </ul>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => confirm("Delete your learning history (progress, doubts, quiz scores)? Documents, notes and boards are kept.") && run(() => api("/me/history", { method: "DELETE" }), "Learning history deleted.")}>🧹 Delete learning history</button>
            <button className="btn btn-danger" onClick={async () => { if (!confirm("Permanently delete your account and ALL your data? This cannot be undone.")) return; try { await api("/me", { method: "DELETE" }); logout(); nav("/"); } catch (e: any) { toast(e.message, "err"); } }}>Delete account</button>
          </div>
        </div>
      </div>
    </Page>
  );
}
