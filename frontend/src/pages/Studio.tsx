import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Avatar, AVATAR_BG } from "../components/Avatar";
import { Field, Page } from "../components/ui";
import { ACCENTS, STYLE_PRESETS, getVoices, guessGender, speak, ttsLang, stopSpeaking, ttsSupported } from "../speech";
import { useApp } from "../store";
import type { Emotion, Gesture, Prefs } from "../types";
import { LANG_OPTS } from "./Onboarding";

const TABS = ["Teacher", "Voice", "Avatar", "Personality", "Teach Me Like This"] as const;
const PERS: [string, string, string][] = [
  ["friendly", "Friendly", "Warm and patient"], ["strict", "Strict but supportive", "Firm, always respectful"], ["funny", "Funny", "Light humour"], ["motivational", "Motivational", "Builds confidence"],
  ["professor", "Professional professor", "Precise and structured"], ["beginner", "Beginner-friendly", "Tiny steps"], ["interactive", "Interactive classroom", "Asks you often"], ["storyteller", "Storytelling", "Teaches via stories"],
];
const SKINS = ["#f8d9c0", "#f2c9a5", "#e0ac86", "#c68a62", "#9a6a47", "#6f4a32"];
const HAIRS = ["#1b1210", "#2b1b17", "#5a3825", "#8a5a2b", "#c9a15a", "#7c3aed", "#9ca3af"];
const OUTFITS: [string, string][] = [["#1e293b", "Formal navy"], ["#7c3aed", "Purple blazer"], ["#0ea5e9", "Sky shirt"], ["#be185d", "Rose kurta"], ["#16a34a", "Green casual"], ["#f59e0b", "Amber casual"]];
const SAMPLE = (n: string, female: boolean) => `Hello! I am ${n}, your personal AI teacher. Today we are going to learn Machine Learning in a very easy way.${female ? "" : ""}`;

export default function Studio() {
  const { prefs, savePrefs, toast } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Teacher");
  const name = prefs.teacher_name || (prefs.teacher === "aira" ? "AIRA" : "NEX");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false); const [pulse, setPulse] = useState(0); const [emo, setEmo] = useState<Emotion>("friendly"); const [ges, setGes] = useState<Gesture>("none");
  useEffect(() => { getVoices().then(setVoices); return () => stopSpeaking(); }, []);

  const say = async (text: string, p: Prefs = prefs, e: Emotion = "friendly", voice?: SpeechSynthesisVoice) => {
    if (!ttsSupported) return toast("This browser can't speak text. Try Chrome or Edge.", "err");
    setSpeaking(true); setEmo(e); setGes("open");
    await speak(text, voice ? { ...p, voice: voice.voiceURI } : p, e, voices, { onWord: () => setPulse((x) => x + 1) });
    setSpeaking(false); setGes("none");
  };

  // ----- voice list -----
  const [accent, setAccent] = useState("all");
  const want = prefs.teacher === "aira" ? "f" : "m";
  const list = voices.filter((v) => (accent === "all" || v.lang.replace("_", "-").toLowerCase() === accent.toLowerCase()) && (guessGender(v) === want || guessGender(v) === "?"));
  const accents = [...new Set(voices.map((v) => v.lang.replace("_", "-")))];

  return (
    <Page title="Teacher Studio" sub="Customise your teacher's identity, voice, look, personality and teaching style.">
      <div className="flex flex-wrap gap-2 mb-5" role="tablist">{TABS.map((t) => <button key={t} role="tab" aria-selected={tab === t} className={`btn ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
      <div className="grid lg:grid-cols-[1fr_300px] gap-5">
        <div className="space-y-4 min-w-0 order-2 lg:order-1">
          {tab === "Teacher" && (<>
            <div className="glass p-5"><h3 className="font-bold mb-3">Choose your teacher</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                {(["aira", "nex"] as const).map((t) => <button key={t} aria-pressed={prefs.teacher === t} onClick={() => savePrefs({ teacher: t, voice: "", avatar_look: { ...prefs.avatar_look, hairstyle: t === "aira" ? "long" : "short" } })} className={`glass p-4 text-left ${prefs.teacher === t ? "sel" : ""}`}><b className="tracking-widest">{t.toUpperCase()}</b><div className="text-sm text-muted">{t === "aira" ? "Female · address as AIRA / AIRA Ma'am / Ma'am" : "Male · address as NEX / NEX Sir / Sir"}</div></button>)}
              </div></div>
            <TextSettings key={prefs.teacher_name + prefs.wake_word} />
          </>)}

          {tab === "Voice" && (<>
            <div className="glass p-5 space-y-4">
              <h3 className="font-bold">Voice style</h3>
              <div className="flex flex-wrap gap-2">{Object.entries(STYLE_PRESETS).map(([k, v]) => <button key={k} aria-pressed={prefs.voice_style === k} className={`btn btn-sm ${prefs.voice_style === k ? "sel" : ""}`} onClick={() => savePrefs({ voice_style: k, voice_rate: v.rate, voice_pitch: v.pitch, voice_energy: v.energy })}>{v.label}</button>)}</div>
              <div className="grid sm:grid-cols-3 gap-4">
                <Slider label="Speaking speed" v={prefs.voice_rate} min={0.6} max={1.4} onC={(x) => savePrefs({ voice_rate: x })} />
                <Slider label="Pitch" v={prefs.voice_pitch} min={0.6} max={1.5} onC={(x) => savePrefs({ voice_pitch: x })} />
                <Slider label="Energy / expressiveness" v={prefs.voice_energy} min={0.3} max={1.6} onC={(x) => savePrefs({ voice_energy: x })} />
              </div>
              <p className="text-xs text-muted">The teacher automatically adapts rate and pitch to the situation (excited intro, calm explanation, serious exam point, encouraging praise). Energy controls how strong that effect is.</p>
              <div className="flex gap-2 flex-wrap">{(["excited", "calm", "serious", "encouraging", "curious"] as Emotion[]).map((e) => <button key={e} className="btn btn-sm" onClick={() => say(`This is how I sound when I'm ${e}. Is this part clear?`, prefs, e)}>▶ {e}</button>)}</div>
            </div>
            <div className="glass p-5">
              <div className="flex flex-wrap items-center gap-3 mb-3"><h3 className="font-bold flex-1">Available voices ({prefs.teacher === "aira" ? "female" : "male"} first)</h3>
                <select className="input !w-auto" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Accent / language"><option value="all">All accents & languages</option>{accents.map((a) => <option key={a} value={a}>{ACCENTS[a] ?? a} ({a})</option>)}</select></div>
              {!voices.some((v) => v.lang.toLowerCase().startsWith("hi")) && voices.length > 0 && prefs.language !== "english" && <p className="text-sm mb-2" style={{ color: "#fbbf24" }}>⚠️ No Hindi voice is installed on this device, so Hindi words may be pronounced like English letters. Install one: Windows Settings → Time & Language → Speech → Add voices → Hindi.</p>}
              {!voices.length && <p className="text-sm text-muted">No voices were found in this browser. Chrome/Edge on Windows include Indian English & Hindi voices (Settings → Time & Language → Speech → Add voices).</p>}
              <div className="grid sm:grid-cols-2 gap-2 max-h-[420px] overflow-auto">
                {list.map((v) => (
                  <div key={v.voiceURI} className={`glass p-3 flex items-center gap-2 ${prefs.voice === v.voiceURI ? "sel" : ""}`}>
                    <div className="flex-1 min-w-0"><div className="text-sm font-semibold truncate">{v.name.replace(/Microsoft |Google /, "")}</div><div className="text-xs text-muted">{ACCENTS[v.lang.replace("_", "-")] ?? v.lang}{v.localService ? "" : " · online"}</div></div>
                    <button className="btn btn-sm" onClick={() => say(SAMPLE(name, prefs.teacher === "aira"), prefs, "friendly", v)} aria-label={`Preview ${v.name}`}>▶</button>
                    <button className={`btn btn-sm ${prefs.voice === v.voiceURI ? "btn-primary" : ""}`} onClick={() => { savePrefs({ voice: v.voiceURI }); toast(`Voice saved: ${v.name}`); }}>{prefs.voice === v.voiceURI ? "Selected" : "Select"}</button>
                  </div>))}
              </div>
              <p className="text-xs text-muted mt-3">Voices come from your browser/OS. For even more natural neural voices, a cloud TTS provider (ElevenLabs, Azure, Google) can be plugged in on the roadmap — it is a paid service.</p>
            </div>
          </>)}

          {tab === "Avatar" && (<>
            <div className="glass p-5"><h3 className="font-bold mb-3">Appearance</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {([["realistic3d", "Realistic 3D teacher"], ["animated", "Animated human"], ["cartoon", "Cartoon teacher"], ["robot", "Futuristic AI robot"], ["minimal", "Minimal assistant"]] as const).map(([k, l]) => <button key={k} aria-pressed={prefs.avatar === k} className={`btn ${prefs.avatar === k ? "sel" : ""}`} onClick={() => savePrefs({ avatar: k })}>{l}</button>)}
              </div>
              <p className="text-xs text-muted mt-2">The 3D teacher is a real-time three.js model (head, hair, eyes, lips, torso and jointed arms) that blinks, shows emotions, moves its jaw while speaking and gestures. It is stylised-realistic, not a photographic scan; a photoreal scanned character would need an external avatar service. Needs WebGL — it falls back to the animated human if your device can't run it.</p></div>
            <div className="glass p-5 space-y-4"><h3 className="font-bold">Customise</h3>
              <Swatches label="Skin tone" cols={SKINS} v={prefs.avatar_look.skin} on={(c) => savePrefs({ avatar_look: { ...prefs.avatar_look, skin: c } })} />
              <Swatches label="Hair colour" cols={HAIRS} v={prefs.avatar_look.hair} on={(c) => savePrefs({ avatar_look: { ...prefs.avatar_look, hair: c } })} />
              <Field label="Hairstyle"><div className="flex gap-2 flex-wrap">{["long", "short", "bun", "curly"].map((h) => <button key={h} className={`btn btn-sm ${(prefs.avatar_look.hairstyle || (prefs.teacher === "aira" ? "long" : "short")) === h ? "sel" : ""}`} onClick={() => savePrefs({ avatar_look: { ...prefs.avatar_look, hairstyle: h } })}>{h}</button>)}</div></Field>
              <Field label="Clothing (professional ↔ casual)"><div className="flex gap-2 flex-wrap">{OUTFITS.map(([c, l]) => <button key={c} className={`btn btn-sm ${prefs.avatar_look.outfit === c ? "sel" : ""}`} onClick={() => savePrefs({ avatar_look: { ...prefs.avatar_look, outfit: c } })}><span className="h-3 w-3 rounded-full" style={{ background: c }} />{l}</button>)}</div></Field>
              <Field label="Background"><div className="flex gap-2 flex-wrap">{Object.keys(AVATAR_BG).map((b) => <button key={b} className={`btn btn-sm capitalize ${prefs.avatar_look.bg === b ? "sel" : ""}`} onClick={() => savePrefs({ avatar_look: { ...prefs.avatar_look, bg: b } })}>{b}</button>)}</div></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={prefs.low_power} onChange={(e) => savePrefs({ low_power: e.target.checked })} /> Low-power mode (simpler animation for older devices)</label>
              <p className="text-xs text-muted">Lip movement follows the browser's speech word-timing — it is approximate, not phoneme-exact.</p>
            </div>
          </>)}

          {tab === "Personality" && (<>
            <div className="glass p-5"><h3 className="font-bold mb-3">Teaching personality</h3>
              <div className="grid sm:grid-cols-2 gap-2">{PERS.map(([k, t, d]) => <button key={k} aria-pressed={prefs.personality === k} className={`glass p-3 text-left ${prefs.personality === k ? "sel" : ""}`} onClick={() => savePrefs({ personality: k })}><b>{t}</b><div className="text-xs text-muted">{d}</div></button>)}</div></div>
            <div className="glass p-5"><h3 className="font-bold mb-3">Teaching language</h3>
              <div className="grid sm:grid-cols-2 gap-2">{LANG_OPTS.map(([k, t, d]) => <button key={k} aria-pressed={prefs.language === k} className={`glass p-3 text-left ${prefs.language === k ? "sel" : ""}`} onClick={() => savePrefs({ language: k })}><b>{t}</b><div className="text-xs text-muted">{d}</div></button>)}</div>
              <Field label="Explanation level"><select className="input mt-2" value={prefs.level} onChange={(e) => savePrefs({ level: e.target.value })}>{[["very_simple", "Very simple"], ["beginner", "Beginner"], ["normal", "Normal"], ["technical", "Technical"], ["exam", "Exam level"]].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <label className="flex items-center gap-2 text-sm mt-3"><input type="checkbox" checked={prefs.memes} onChange={(e) => savePrefs({ memes: e.target.checked })} /> “Explain with Trends” — allow relatable memes & pop-culture analogies when they genuinely help</label>
            </div>
          </>)}

          {tab === "Teach Me Like This" && <StyleLab />}
        </div>

        {/* live preview */}
        <aside className="order-1 lg:order-2"><div className="glass p-4 lg:sticky lg:top-6 text-center">
          <div className="rounded-2xl grid place-items-center py-2" style={{ background: AVATAR_BG[prefs.avatar_look.bg] ?? AVATAR_BG.classroom }}><Avatar prefs={prefs} speaking={speaking} emotion={emo} gesture={ges} pulse={pulse} size={220} /></div>
          <div className="font-extrabold tracking-widest mt-3">{name}</div><div className="text-xs text-muted mb-3">{LANG_OPTS.find((l) => l[0] === prefs.language)?.[1]}</div>
          <button className="btn btn-primary w-full" onClick={() => (speaking ? (stopSpeaking(), setSpeaking(false)) : say(SAMPLE(name, prefs.teacher === "aira")))}>{speaking ? "⏹ Stop" : "▶ Preview voice & avatar"}</button>
          <p className="text-xs text-muted mt-2">Speaks with a {ACCENTS[ttsLang(prefs.language)] ?? ttsLang(prefs.language)} voice</p>
        </div></aside>
      </div>
    </Page>
  );
}

function TextSettings() {
  const { prefs, savePrefs, toast } = useApp();
  const [n, setN] = useState(prefs.teacher_name); const [w, setW] = useState(prefs.wake_word);
  return (
    <div className="glass p-5 grid sm:grid-cols-2 gap-4">
      <Field label="Display name" hint="Leave empty for the default."><input className="input" maxLength={20} value={n} onChange={(e) => setN(e.target.value)} placeholder={prefs.teacher === "aira" ? "AIRA" : "NEX"} /></Field>
      <Field label="Custom wake word" hint="A short, distinctive word works best."><input className="input" maxLength={20} value={w} onChange={(e) => setW(e.target.value)} placeholder={prefs.teacher === "aira" ? "AIRA" : "NEX"} /></Field>
      <button className="btn btn-primary sm:col-span-2" onClick={() => { savePrefs({ teacher_name: n.trim(), wake_word: w.trim() }); toast("Saved."); }}>Save</button>
    </div>
  );
}

const Slider = ({ label, v, min, max, onC }: { label: string; v: number; min: number; max: number; onC: (x: number) => void }) => {
  const [x, setX] = useState(v);
  return <Field label={`${label}: ${x.toFixed(2)}`}><input type="range" className="w-full" min={min} max={max} step={0.05} value={x} onChange={(e) => setX(+e.target.value)} onPointerUp={() => onC(x)} onKeyUp={() => onC(x)} aria-label={label} /></Field>;
};
const Swatches = ({ label, cols, v, on }: { label: string; cols: string[]; v: string; on: (c: string) => void }) => (
  <Field label={label}><div className="flex gap-2 flex-wrap">{cols.map((c) => <button key={c} aria-label={c} aria-pressed={v === c} onClick={() => on(c)} className={`h-8 w-8 rounded-full border ${v === c ? "sel" : ""}`} style={{ background: c, borderColor: "#fff5" }} />)}</div></Field>
);

interface Style { id: number; title: string; data: { wpm: number; pace: string; sentences: string; interactive: boolean; example_rate: number; question_rate: number; prompt: string; voice_rate: number } }
function StyleLab() {
  const { prefs, savePrefs, toast } = useApp();
  const [list, setList] = useState<Style[]>([]); const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", transcript: "", duration: "", consent: false }); const file = useRef<HTMLInputElement>(null);
  const load = () => api<Style[]>("/items/style").then(setList).catch(() => {});
  useEffect(() => { load(); }, []);
  const onFile = (fl?: File) => {
    if (!fl) return;
    const el = document.createElement(fl.type.startsWith("video") ? "video" : "audio"); const url = URL.createObjectURL(fl);
    el.preload = "metadata"; el.src = url;
    el.onloadedmetadata = () => { setF((p) => ({ ...p, duration: String(Math.round(el.duration)) })); URL.revokeObjectURL(url); };
    el.onerror = () => { URL.revokeObjectURL(url); toast("Couldn't read that media file — enter the length manually.", "err"); };
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await api("/style/analyze", { method: "POST", body: { name: f.name, transcript: f.transcript, duration_sec: Number(f.duration), consent: f.consent } }); toast("Teaching style profile saved."); setF({ name: "", transcript: "", duration: "", consent: false }); load(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div className="glass p-5">
        <h3 className="font-bold">Teach Me Like This</h3>
        <p className="text-sm text-muted mt-1">Share what a teacher says (transcript) and how long the clip is. We learn <b>teaching style only</b> — pace, sentence length, how often they ask questions and give examples. <b>No voice is cloned or imitated</b>: your teacher keeps its own voice. Your clip never leaves your device; only the numbers derived from the transcript are saved.</p>
        <form className="space-y-3 mt-4" onSubmit={submit}>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Profile name"><input className="input" required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Physics sir's style" /></Field>
            <Field label="Clip length (seconds)" hint="Pick a file to read it automatically — it stays on your device."><div className="flex gap-2"><input className="input" required type="number" min={6} max={3600} value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /><input ref={file} hidden type="file" accept="audio/*,video/*" onChange={(e) => onFile(e.target.files?.[0])} /><button type="button" className="btn" onClick={() => file.current?.click()}>🎧</button></div></Field>
          </div>
          <Field label="Transcript of the clip" hint="Paste or type what is said (at least a few sentences)."><textarea className="input" required minLength={40} rows={5} value={f.transcript} onChange={(e) => setF({ ...f, transcript: e.target.value })} /></Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} /> I own this recording or have permission to use it, and I understand only teaching-style statistics are saved (no voice cloning).</label>
          <button className="btn btn-primary" disabled={busy || !f.consent}>{busy ? "Analysing…" : "Analyse teaching style"}</button>
        </form>
      </div>
      <div className="glass p-5"><h3 className="font-bold mb-3">Saved style profiles</h3>
        {!list.length ? <p className="text-sm text-muted">None yet.</p> : list.map((s) => {
          const active = prefs.style_profile?.name === s.title;
          return (<div key={s.id} className={`glass p-3 mb-2 ${active ? "sel" : ""}`}>
            <div className="flex items-center gap-2 flex-wrap"><b className="flex-1">{s.title}</b>
              <button className={`btn btn-sm ${active ? "" : "btn-primary"}`} onClick={() => { if (active) savePrefs({ style_profile: null }); else { savePrefs({ style_profile: { name: s.title, prompt: s.data.prompt, voice_rate: s.data.voice_rate }, voice_rate: s.data.voice_rate }); toast("Okay! I'll teach in this style now."); } }}>{active ? "Stop using" : "Use this style"}</button>
              <button className="btn btn-sm btn-danger" onClick={async () => { await api(`/items/${s.id}`, { method: "DELETE" }); if (active) savePrefs({ style_profile: null }); load(); }}>Delete</button></div>
            <p className="text-xs text-muted mt-1">{s.data.wpm} words/min · {s.data.pace} pace · {s.data.sentences} sentences · {s.data.interactive ? "interactive" : "lecture-style"} · examples {Math.round(s.data.example_rate * 100)}% of sentences</p>
          </div>);
        })}
      </div>
    </div>
  );
}
