import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, AVATAR_BG } from "../components/Avatar";
import { Logo } from "../components/ui";
import { useApp } from "../store";
import type { Prefs } from "../types";

export const LANG_OPTS: [string, string, string][] = [
  ["english", "English", ""], ["hindi", "Hindi", "हिंदी में पढ़ाई"], ["hinglish", "Hinglish", "Hindi + English mix"],
  ["gujarati", "Gujarati", "ગુજરાતીમાં શીખો"], ["mix3", "English + Hindi + Gujarati", "Three-language mix"], ["auto", "Auto-match me", "Follows how I speak"],
];

export default function Onboarding() {
  const { prefs, savePrefs, user } = useApp(); const nav = useNavigate();
  const [step, setStep] = useState(0);
  const [teacher, setTeacher] = useState<"aira" | "nex">(prefs.teacher);
  const [lang, setLang] = useState(prefs.language);
  const [name, setName] = useState(""); const [busy, setBusy] = useState(false);

  const preview = (t: "aira" | "nex"): Prefs => ({ ...prefs, teacher: t, avatar: "animated", avatar_look: { ...prefs.avatar_look, hairstyle: t === "aira" ? "long" : "short", hair: t === "aira" ? "#2b1b17" : "#1f1a17", outfit: t === "aira" ? "#a855f7" : "#0ea5e9" } });
  const finish = async () => {
    setBusy(true);
    await savePrefs({ onboarded: true, teacher, language: lang, teacher_name: name.trim(), wake_word: "", avatar_look: { ...prefs.avatar_look, hairstyle: teacher === "aira" ? "long" : "short", outfit: teacher === "aira" ? "#a855f7" : "#0ea5e9" }, personality: teacher === "aira" ? "friendly" : "professor" });
    nav("/app");
  };
  return (
    <div className="min-h-screen flex flex-col items-center p-5">
      <div className="py-4"><Logo /></div>
      <div className="flex gap-2 mb-6" aria-label={`Step ${step + 1} of 3`}>{[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-12 rounded" style={{ background: i <= step ? "var(--accent)" : "var(--panel-border)" }} />)}</div>
      <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} className="w-full max-w-3xl">
        {step === 0 && (<>
          <h1 className="text-3xl font-extrabold text-center">Hi {user?.name.split(" ")[0]}! Who will teach you?</h1>
          <p className="text-center text-muted mb-6">You can change your teacher any time.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {(["aira", "nex"] as const).map((t) => (
              <button key={t} onClick={() => setTeacher(t)} aria-pressed={teacher === t} className={`glass p-4 text-center transition ${teacher === t ? "sel" : "hover:-translate-y-1"}`}>
                <div className="rounded-2xl grid place-items-center py-2" style={{ background: AVATAR_BG.classroom }}><Avatar prefs={preview(t)} speaking={false} emotion="friendly" gesture="open" pulse={0} size={190} /></div>
                <div className="mt-3 text-xl font-extrabold tracking-widest">{t === "aira" ? "AIRA" : "NEX"}</div>
                <div className="text-sm text-muted">{t === "aira" ? "Female AI teacher · call her “AIRA Ma'am”" : "Male AI teacher · call him “NEX Sir”"}</div>
              </button>))}
          </div>
        </>)}
        {step === 1 && (<>
          <h1 className="text-3xl font-extrabold text-center">How should {teacher === "aira" ? "AIRA" : "NEX"} teach you?</h1>
          <p className="text-center text-muted mb-6">Pick your language. You can also just tell the teacher: “thoda simple language mein explain karo”.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {LANG_OPTS.map(([k, t, d]) => <button key={k} onClick={() => setLang(k)} aria-pressed={lang === k} className={`glass p-4 text-left ${lang === k ? "sel" : ""}`}><b>{t}</b>{d && <div className="text-sm text-muted">{d}</div>}</button>)}
          </div>
        </>)}
        {step === 2 && (<>
          <h1 className="text-3xl font-extrabold text-center">Make it yours</h1>
          <p className="text-center text-muted mb-6">Optional: give your teacher a custom name (this also becomes the wake word).</p>
          <div className="glass p-6 max-w-md mx-auto">
            <label className="text-xs font-semibold text-muted uppercase">Teacher display name</label>
            <input className="input mt-1.5" maxLength={20} placeholder={teacher === "aira" ? "AIRA" : "NEX"} value={name} onChange={(e) => setName(e.target.value)} />
            <p className="text-xs text-muted mt-3">Voice, avatar look, themes and personality can be customised later in Teacher Studio.</p>
          </div>
        </>)}
      </motion.div>
      <div className="flex gap-3 mt-8">
        {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
        {step < 2 ? <button className="btn btn-primary !px-8" onClick={() => setStep(step + 1)}>Continue</button> : <button className="btn btn-primary !px-8" disabled={busy} onClick={finish}>{busy ? "Setting up…" : "Enter my classroom"}</button>}
      </div>
    </div>
  );
}
