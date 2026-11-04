import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Avatar } from "../components/Avatar";
import { Logo } from "../components/ui";
import { useApp } from "../store";
import type { Prefs } from "../types";

const base = (teacher: "aira" | "nex", outfit: string, hair: string, skin: string): Prefs => ({
  onboarded: true, teacher, teacher_name: "", wake_word: "", voice: "", voice_rate: 1, voice_pitch: 1, voice_energy: 1, avatar: "animated",
  avatar_look: { skin, hair, outfit, bg: "classroom", hairstyle: teacher === "aira" ? "long" : "short" }, language: "hinglish", level: "normal", personality: "friendly", memes: false,
  theme: { preset: "violet", mode: "dark", radius: "round", font: 16, board: "green" }, low_power: false, listen_wake: false, style_profile: null,
});
const FEATURES = [
  ["🗣️", "Speaks like your teacher", "Simple Indian English, Hindi, Hinglish or Gujarati — switch mid-sentence: “Ma'am, Hindi aur English mix karke samjhao.”"],
  ["🧾", "Teaches on a real blackboard", "Draws diagrams, solves steps, shows code and tables progressively while explaining — not a static image."],
  ["📚", "Learns from YOUR material", "Upload PDF, DOCX, PPTX or notes. Select any line and say “Explain this line.” Never invents what your book says."],
  ["🎙️", "Hands-free & interruptible", "Say “AIRA, board pe samjhao.” Interrupt any time — the teacher stops and listens."],
  ["🧠", "Remembers & adapts", "Continues where you stopped, detects weak topics, and explains differently when you're stuck."],
  ["📝", "Quizzes, notes, exam prep", "Auto quizzes, flashcards, revision sheets and downloadable board notes."],
];

export default function Landing() {
  const { user } = useApp();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-5 md:px-10 py-5 max-w-7xl mx-auto">
        <Logo />
        <nav className="flex items-center gap-2">
          {user && !user.is_guest ? <Link to="/app" className="btn btn-primary">Open classroom</Link> : (<><Link to="/login" className="btn">Log in</Link><Link to="/app" className="btn btn-primary">Start free — no login</Link></>)}
        </nav>
      </header>

      <section className="max-w-7xl mx-auto px-5 md:px-10 pt-8 md:pt-16 pb-16 grid lg:grid-cols-2 gap-10 items-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <span className="chip mb-5">✨ AI personal teacher · available 24/7</span>
          <h1 className="text-5xl md:text-7xl font-extrabold leading-[1.05]">Your classroom.<br /><span className="grad-text">Your AI.</span><br />Your way.</h1>
          <p className="text-muted text-lg mt-6 max-w-xl">LUMETRA CLASSORA is a human-like AI teaching platform. Choose <b className="text-[var(--text)]">AIRA</b> or <b className="text-[var(--text)]">NEX</b>, upload your study material, and learn through natural conversation, voice and a live interactive blackboard.</p>
          <div className="flex flex-wrap gap-3 mt-8">
            <Link to="/app" className="btn btn-primary !px-6 !py-3 text-base">Start learning →</Link>
            <a href="#features" className="btn !px-6 !py-3 text-base">See how it works</a>
          </div>
          <p className="text-xs text-muted mt-4">Voice features work best in Chrome or Edge. No login needed — sign up later to save your learning history.</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .15 }} className="glass p-5 relative">
          <div className="grid grid-cols-2 gap-4">
            {([["AIRA", "Female AI teacher", base("aira", "#a855f7", "#2b1b17", "#f2c9a5")], ["NEX", "Male AI teacher", base("nex", "#0ea5e9", "#1f1a17", "#d9a77d")]] as const).map(([n, d, p]) => (
              <div key={n} className="rounded-2xl p-3 text-center" style={{ background: "linear-gradient(180deg,#2a3a5e,#1a2440)" }}>
                <Avatar prefs={p} speaking={false} emotion="friendly" gesture={n === "AIRA" ? "open" : "point"} pulse={0} size={170} />
                <div className="font-extrabold tracking-widest text-white">{n}</div><div className="text-xs text-white/70">{d}</div>
              </div>))}
          </div>
        </motion.div>
      </section>

      <section id="features" className="max-w-7xl mx-auto px-5 md:px-10 pb-20">
        <h2 className="text-3xl font-extrabold mb-8">Everything a real classroom has — and more</h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(([i, t, d], k) => (
            <motion.div key={t} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: k * .05 }} className="glass p-6">
              <div className="text-3xl mb-3">{i}</div><h3 className="font-bold text-lg">{t}</h3><p className="text-muted text-sm mt-1.5">{d}</p>
            </motion.div>))}
        </div>
      </section>
      <footer className="text-center text-xs text-muted pb-10">© LUMETRA CLASSORA · Your classroom. Your AI. Your way.</footer>
    </div>
  );
}
