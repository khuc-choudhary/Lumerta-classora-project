import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { Field, Page } from "../components/ui";
import { createListener, getVoices, speakWord, stopSpeaking, sttSupported, serverTtsProvider, type ListenState } from "../speech";
import { useApp } from "../store";

interface Syl { ipa: string; stress: "primary" | "secondary" | "none" }
interface W { word: string; lang: "en" | "hi"; status: string; ipa: string | null; syllables: Syl[]; syllable_count: number; stressed: number | null;
  spelling_syllables?: string; note?: string; alternatives?: string[]; devanagari?: string; letters?: string }
interface Analysis { words: W[]; runs: { lang: string; text: string; speech: string }[]; provider: string; accent_note: string; ssml_preview: string | null }

const EXAMPLES = ["Artificial Intelligence", "Algorithm", "Kubernetes", "Normalization", "Okay, ab hum Machine Learning ka concept samajhte hain.", "Is SQL query ka output kya hoga?"];
const ACCENTS: [string, string][] = [["en-IN", "Indian English (recommended)"], ["en-GB", "British English"], ["en-US", "American English"]];
const LANGS: [string, string, string][] = [["english", "English", "en-IN"], ["hinglish", "Hinglish (mixed)", "en-IN"], ["hindi", "Hindi", "hi-IN"]];
const STATUS: Record<string, [string, string]> = {
  override: ["Your correction", "#60a5fa"], curated: ["Curated (not expert-reviewed)", "#a78bfa"], cmudict: ["Dictionary (US reference)", "#34d399"],
  composed: ["Composed — unverified", "#fbbf24"], unknown: ["No reliable pronunciation", "#f87171"], hindi: ["Hindi", "#fb923c"], acronym: ["Acronym (spelled on purpose)", "#22d3ee"],
};

function lev(a: string, b: string) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu, " ").split(/\s+/).filter(Boolean);

export default function Pronunciation() {
  const { prefs, savePrefs, toast } = useApp();
  const [text, setText] = useState("Artificial Intelligence"); const [lang, setLang] = useState("english");
  const [res, setRes] = useState<Analysis | null>(null); const [busy, setBusy] = useState(false); const [playing, setPlaying] = useState("");
  const [fix, setFix] = useState<{ word: string; ipa: string } | null>(null);
  const [mine, setMine] = useState<{ id: number; title: string; data: { ipa: string } }[]>([]);
  const voices = useRef<SpeechSynthesisVoice[]>([]);
  const accent = prefs.pron_accent || "en-IN";

  useEffect(() => { getVoices().then((v) => (voices.current = v)); return () => stopSpeaking(); }, []);
  const loadMine = useCallback(() => api<any[]>("/items/pron").then(setMine).catch(() => {}), []);
  useEffect(() => { loadMine(); }, [loadMine]);

  const analyse = useCallback(async (t = text) => {
    if (!t.trim()) return;
    setBusy(true);
    try { setRes(await api<Analysis>("/pron/analyze", { method: "POST", body: { text: t, language: lang, accent } })); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }, [text, lang, accent, toast]);
  useEffect(() => { analyse("Artificial Intelligence"); /* first load */ // eslint-disable-next-line
  }, []);

  const play = async (t: string, slow = false, tag = "") => {
    setPlaying(tag || (slow ? "slow" : "normal"));
    try { await speakWord(t, prefs, voices.current, slow); } finally { setPlaying(""); }
  };

  const saveFix = async () => {
    if (!fix) return;
    try { await api("/items/pron", { method: "POST", body: { title: fix.word.toLowerCase(), data: { ipa: fix.ipa.trim() } } }); setFix(null); loadMine(); analyse(); toast("Correction saved. It will be used whenever this word is spoken."); }
    catch (e: any) { toast(e.message, "err"); }
  };

  // ---- microphone practice ----
  const [mic, setMic] = useState<ListenState>("off"); const [heard, setHeard] = useState<string | null>(null);
  const listener = useRef<ReturnType<typeof createListener> | null>(null);
  const practise = () => {
    if (mic === "listening") return listener.current?.stop();
    if (!sttSupported) return toast("Microphone practice needs Chrome or Edge.", "err");
    stopSpeaking(); setHeard(null);
    listener.current = createListener({ lang: LANGS.find((l) => l[0] === lang)?.[2] ?? "en-IN", continuous: false, onFinal: (t) => setHeard(t), onState: (s, m) => { setMic(s); if (m) toast(m, "err"); } });
    listener.current.start();
  };
  const target = words(text), said = heard ? words(heard) : [];
  const score = heard ? target.map((t) => { const best = said.reduce((m, s) => Math.min(m, lev(t, s) / Math.max(t.length, s.length)), 1); return { t, ok: best <= 0.15, close: best <= 0.45 }; }) : [];
  const pct = score.length ? Math.round((score.filter((s) => s.ok).length / score.length) * 100) : 0;

  const [probe, setProbe] = useState<string>("");
  const prov = serverTtsProvider();

  return (
    <Page title="Pronunciation Studio" sub="Hear any word or sentence the right way, see its sounds and stress, and practise with your microphone.">
      <div className="glass p-5 space-y-4">
        <div className="grid sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <Field label="Word or sentence"><input className="input" value={text} maxLength={400} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && analyse()} placeholder="e.g. Artificial Intelligence" /></Field>
          <Field label="Language"><select className="input" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Accent"><select className="input" value={accent} onChange={(e) => savePrefs({ pron_accent: e.target.value })}>{ACCENTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((ex) => <button key={ex} className="chip cursor-pointer" onClick={() => { setText(ex); analyse(ex); }}>{ex.length > 34 ? ex.slice(0, 32) + "…" : ex}</button>)}</div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => { analyse(); play(text); }}>🔊 Listen — normal</button>
          <button className="btn" disabled={busy} onClick={() => { analyse(); play(text, true); }}>🐢 Listen — slow</button>
          <button className="btn" onClick={() => play(text, false, "replay")}>↻ Replay</button>
          <button className="btn" onClick={() => { stopSpeaking(); setPlaying(""); }}>⏹ Stop</button>
          <button className="btn" disabled={busy} onClick={() => analyse()}>{busy ? "Analysing…" : "Show phonetics"}</button>
        </div>
        {playing && <p className="text-xs text-muted" aria-live="polite">Playing…</p>}
        <p className="text-xs text-muted">Voice engine: <b>{prov === "browser" ? "your browser's voices (free). Words are spoken as normal words, never spelled out, but a browser cannot be given exact phonemes." : `${prov} (cloud) with language-aware voices and phoneme control for curated terms.`}</b></p>
      </div>

      {res && (
        <div className="space-y-4 mt-4">
          <div className="glass p-5">
            <h3 className="font-bold mb-3">Pronunciation</h3>
            <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Language segments">{res.runs.map((r, i) => <span key={i} className="chip" title={r.lang === "hi" ? `Spoken by a Hindi voice as: ${r.speech}` : "Spoken by an English voice"}>{r.lang === "hi" ? "🇮🇳 Hindi" : "EN"} · {r.text.trim()}</span>)}</div>
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-muted text-xs uppercase"><th className="py-2 pr-3">Word</th><th className="pr-3">Phonetic (IPA)</th><th className="pr-3">Sound syllables</th><th className="pr-3">Spelling</th><th className="pr-3">Stress</th><th className="pr-3">Source</th><th /></tr></thead>
              <tbody>{res.words.map((w, i) => {
                const [label, col] = STATUS[w.status] ?? [w.status, "#999"];
                return (
                  <tr key={i} className="border-t align-top" style={{ borderColor: "var(--panel-border)" }}>
                    <td className="py-2 pr-3 font-bold">{w.word}<button className="ml-1 opacity-80 hover:opacity-100" aria-label={`Pronounce ${w.word}`} onClick={() => play(w.word, false, w.word)}>🔊</button><button className="ml-0.5 opacity-70 hover:opacity-100" aria-label={`Pronounce ${w.word} slowly`} onClick={() => play(w.word, true, w.word)}>🐢</button></td>
                    <td className="pr-3 font-mono">{w.ipa ? `/${w.ipa}/` : w.devanagari ? <span title="Spoken from Devanagari by a Hindi voice">{w.devanagari}</span> : w.letters ? w.letters : "—"}</td>
                    <td className="pr-3">{w.syllables.length ? w.syllables.map((s, k) => <span key={k} className={`inline-block px-1.5 mr-1 rounded font-mono ${s.stress === "primary" ? "font-extrabold" : ""}`} style={{ background: s.stress === "primary" ? "color-mix(in srgb,var(--accent) 40%,transparent)" : s.stress === "secondary" ? "color-mix(in srgb,var(--accent) 18%,transparent)" : "transparent", border: "1px solid var(--panel-border)" }}>{s.ipa}</span>) : "—"}{w.syllable_count ? <span className="text-xs text-muted"> {w.syllable_count} syll.</span> : null}</td>
                    <td className="pr-3">{w.spelling_syllables ?? "—"}</td>
                    <td className="pr-3">{w.stressed !== null && w.syllables.length ? `${w.stressed + 1}${["st", "nd", "rd"][w.stressed] ?? "th"} syllable` : "—"}</td>
                    <td className="pr-3"><span className="chip" style={{ borderColor: col }} title={w.note}>{label}</span>{w.alternatives?.length ? <div className="text-xs text-muted mt-1">also: {w.alternatives.map((a) => `/${a}/`).join(", ")}</div> : null}</td>
                    <td>{w.lang === "en" && w.status !== "acronym" && <button className="btn btn-sm" onClick={() => setFix({ word: w.word, ipa: w.ipa ?? "" })}>Correct</button>}</td>
                  </tr>);
              })}</tbody></table></div>
            <p className="text-xs text-muted mt-3">ˈ = main stress, ˌ = secondary stress. {res.accent_note} Words marked “No reliable pronunciation” are not guessed — the voice uses its default rules; you can add your own correction.</p>
          </div>

          {fix && (
            <div className="glass p-4 flex flex-wrap items-end gap-3" role="dialog" aria-label="Correct pronunciation">
              <Field label={`Your IPA for “${fix.word}”`} hint="Use IPA with . between syllables and ˈ before the stressed one, e.g. ˈæl.ɡə.ˌrɪ.ðəm"><input className="input !w-80" value={fix.ipa} onChange={(e) => setFix({ ...fix, ipa: e.target.value })} /></Field>
              <button className="btn btn-primary" disabled={!fix.ipa.trim()} onClick={saveFix}>Save correction</button><button className="btn" onClick={() => setFix(null)}>Cancel</button>
            </div>)}
        </div>)}

      <div className="glass p-5 mt-4 space-y-3">
        <h3 className="font-bold">🎙 Practise speaking</h3>
        <p className="text-sm text-muted">Say the text above. We compare what the browser heard with the target and point out words that were not recognised.</p>
        <div className="flex gap-2"><button className={`btn ${mic === "listening" ? "btn-primary" : ""}`} onClick={practise}>{mic === "listening" ? "⏹ Stop (listening…)" : "🎙 Start speaking"}</button>{heard && <button className="btn" onClick={() => play(text)}>🔊 Hear the correct way</button>}</div>
        {heard !== null && (<div aria-live="polite">
          <p className="text-sm">We heard: <b>“{heard}”</b></p>
          <div className="flex flex-wrap gap-1.5 my-2">{score.map((s, i) => <span key={i} className="chip" style={{ borderColor: s.ok ? "#4ade80" : s.close ? "#fbbf24" : "#f87171" }}>{s.ok ? "✅" : s.close ? "⚠️" : "❌"} {s.t}</span>)}</div>
          <p className="text-sm">{pct >= 85 ? "Very good — nearly every word was recognised clearly. Try again at a faster pace or move to a harder sentence." : pct >= 50 ? "Good try. Listen to the ⚠️/❌ words with the 🐢 button, then say it again, slowly." : "Let's go step by step: listen to each word with 🐢, repeat it alone, then say the whole sentence."}</p>
          <p className="text-xs text-muted">Honest note: this checks what the speech recogniser understood, not a true pronunciation score. A word can be recognised and still sound off, and accented speech can be mis-recognised. A real pronunciation assessment needs a dedicated service (e.g. Azure Pronunciation Assessment), which is not connected yet.</p>
        </div>)}
      </div>

      <div className="glass p-5 mt-4">
        <h3 className="font-bold mb-2">My corrections</h3>
        {!mine.length ? <p className="text-sm text-muted">None yet. Click “Correct” beside a word above.</p> : mine.map((m) => (
          <div key={m.id} className="flex items-center gap-3 py-1.5 border-t first:border-0" style={{ borderColor: "var(--panel-border)" }}><b>{m.title}</b><span className="font-mono text-sm flex-1">/{m.data.ipa}/</span>
            <button className="btn btn-sm btn-danger" onClick={async () => { await api(`/items/${m.id}`, { method: "DELETE" }); loadMine(); }}>Delete</button></div>))}
      </div>

      <div className="glass p-5 mt-4 space-y-2">
        <h3 className="font-bold">Speech engine status</h3>
        <p className="text-sm text-muted">Provider: <b>{prov}</b>. {prov === "browser" ? "To use Azure, Google or ElevenLabs set TTS_PROVIDER and the provider key in backend/.env (see docs/PRONUNCIATION.md)." : "Phoneme tags are silently ignored by some voices, so test yours:"}</p>
        {prov !== "browser" && <div className="flex items-center gap-3"><button className="btn btn-sm" onClick={async () => { setProbe("Testing…"); try { const r = await api<any>("/pron/probe", { method: "POST", body: {} }); setProbe(r.detail); } catch (e: any) { setProbe(e.message); } }}>Test phoneme support</button><span className="text-sm">{probe}</span></div>}
      </div>
    </Page>
  );
}
