import { apiBlob } from "./api";
import type { Emotion, Prefs } from "./types";

// ---------------- Text to speech (browser Web Speech API) ----------------
export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;
export const sttSupported = typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

export function getVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported) return Promise.resolve([]);
  const v = speechSynthesis.getVoices();
  if (v.length) return Promise.resolve(v);
  return new Promise((res) => {
    const done = () => res(speechSynthesis.getVoices());
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

export const STYLE_PRESETS: Record<string, { label: string; rate: number; pitch: number; energy: number }> = {
  soft: { label: "Soft & friendly", rate: 0.9, pitch: 1.05, energy: 0.8 },
  professional: { label: "Professional teacher", rate: 0.97, pitch: 1.0, energy: 1.0 },
  energetic: { label: "Energetic", rate: 1.08, pitch: 1.1, energy: 1.3 },
  calm: { label: "Calm", rate: 0.88, pitch: 0.95, energy: 0.7 },
  mature: { label: "Mature professor", rate: 0.9, pitch: 0.85, energy: 0.9 },
  youthful: { label: "Youthful conversational", rate: 1.05, pitch: 1.15, energy: 1.1 },
};

export const ACCENTS: Record<string, string> = { "en-IN": "Indian English", "hi-IN": "Hindi", "gu-IN": "Gujarati", "en-GB": "British English", "en-US": "American English" };

/** Language for speech RECOGNITION (kept en-IN for Hinglish so the command parser sees Roman text). */
export function speechLang(language: string): string {
  return language === "hindi" ? "hi-IN" : language === "gujarati" ? "gu-IN" : "en-IN";
}
/** Language for the TEACHER'S VOICE. Hinglish/mixed use a Hindi voice so words like "ab" are not spelled "A B". */
export function ttsLang(language: string): string {
  return language === "gujarati" ? "gu-IN" : language === "english" ? "en-IN" : "hi-IN";
}

const FEMALE = /(female|woman|heera|hemlata|zira|swara|neerja|kalpana|dhwani|aria|jenny|samantha|susan|veena|lekha|priya|aditi|raveena|google (हिन्दी|hindi))/i;
const MALE = /(\bmale\b|\bman\b|ravi|hemant|prabhat|madhur|niranjan|david|mark|george|james|rishi|daniel|alex|guy|rocko)/i;
export const guessGender = (v: SpeechSynthesisVoice): "f" | "m" | "?" => (FEMALE.test(v.name) ? "f" : MALE.test(v.name) ? "m" : "?");

/** Gujarati -> Devanagari letter by letter (Unicode keeps the two scripts at a fixed offset of 0x180). */
const guToDeva = (s: string) => s.replace(/[\u0A81-\u0AEF]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x180));

/** Devanagari -> simple Roman Hindi ("समझते हैं" -> "samajhte hain") so an English voice of the right gender can read Hindi. */
const D_CONS: Record<string, string> = { "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n", "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
  "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n", "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "ळ": "l", "व": "v", "श": "sh", "ष": "sh", "स": "s", "ह": "h",
  "क़": "q", "ख़": "kh", "ग़": "gh", "ज़": "z", "ड़": "r", "ढ़": "rh", "फ़": "f", "य़": "y" };
const D_NUKTA: Record<string, string> = { "क": "q", "ख": "kh", "ग": "gh", "ज": "z", "ड": "r", "ढ": "rh", "फ": "f", "य": "y" };
const D_VOW: Record<string, string> = { "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au", "ऑ": "o", "ऍ": "e" };
const D_MATRA: Record<string, string> = { "ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॉ": "o", "ॅ": "e" };
const D_SIGN: Record<string, string> = { "ं": "n", "ँ": "n", "ः": "h", "।": ".", "॥": ".", "ॐ": "om" };
function devaToRoman(s: string): string {
  const ch = [...s.normalize("NFC")]; let out = "";
  const isLetter = (c?: string) => !!c && /[\u0900-\u0963\u0971-\u097F]/.test(c);
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (D_CONS[c] !== undefined) {
      let r = D_CONS[c];
      if (ch[i + 1] === "\u093C") { r = D_NUKTA[c] ?? r; i++; }              // nukta: ज़ -> z, फ़ -> f
      out += r;
      const n = ch[i + 1];
      if (n === "\u094D") { i++; continue; }                                   // virama: no vowel
      if (n && D_MATRA[n] !== undefined) { out += D_MATRA[n]; i++; continue; }
      const wordStart = !isLetter(ch[i - (ch[i] === "\u093C" ? 2 : 1)]);
      if (isLetter(n) || wordStart) out += "a";                                // inherent 'a', dropped at the end of a word ("hain", not "haina")
    } else if (D_VOW[c] !== undefined) out += D_VOW[c];
    else if (D_SIGN[c] !== undefined) out += D_SIGN[c];
    else if (c >= "\u0966" && c <= "\u096F") out += String(c.charCodeAt(0) - 0x966);
    else if (c !== "\u093C") out += c;
  }
  return out;
}

const norm = (l: string) => l.replace("_", "-").toLowerCase();

/** Best installed voice for ONE language (e.g. "en-IN", "hi-IN"). The student's saved voice is used when it speaks that language. */
export function voiceForLang(prefs: Prefs, voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | undefined {
  const l2 = lang.slice(0, 2).toLowerCase();
  const saved = voices.find((v) => v.voiceURI === prefs.voice);
  if (saved && norm(saved.lang).startsWith(l2)) return saved;
  const g = prefs.teacher === "aira" ? "f" : "m";
  const inLang = voices.filter((v) => norm(v.lang).startsWith(l2));
  if (!inLang.length) return undefined;
  const exact = inLang.filter((v) => norm(v.lang) === lang.toLowerCase());
  const pool = exact.length ? exact : inLang;
  return pool.find((v) => guessGender(v) === g) ?? pool.find((v) => guessGender(v) === "?") ?? pool[0];
}

/** THE teacher's voice, used for everything the teacher says: the voice selected in Teacher Studio; otherwise the best
 *  installed voice of the teacher's gender (AIRA female, NEX male), preferring the teaching language, then Indian English, then Hindi. */
export function teacherVoice(prefs: Prefs, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const saved = voices.find((v) => v.voiceURI === prefs.voice);
  if (saved) return saved;
  const g = prefs.teacher === "aira" ? "f" : "m";
  const order = [ttsLang(prefs.language), "en-IN", "hi-IN", "en"];
  for (const l of order) { const v = voiceForLang(prefs, voices, l); if (v && guessGender(v) === g) return v; }
  const anyOfGender = voices.find((v) => guessGender(v) === g);
  if (anyOfGender) return anyOfGender;
  for (const l of order) { const v = voiceForLang(prefs, voices, l); if (v) return v; }   // no voice of that gender installed at all
  return voices[0];
}

/** Main voice for the teaching language, falling back to any installed voice. */
export function pickVoice(prefs: Prefs, voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  return voiceForLang(prefs, voices, ttsLang(prefs.language)) ?? voices.find((v) => v.voiceURI === prefs.voice) ?? voices[0];
}

const EMO: Record<Emotion, { r: number; p: number }> = {
  neutral: { r: 0, p: 0 }, excited: { r: 0.06, p: 0.1 }, calm: { r: -0.08, p: -0.05 }, serious: { r: -0.04, p: -0.08 },
  encouraging: { r: 0.02, p: 0.07 }, friendly: { r: 0, p: 0.04 }, curious: { r: 0.03, p: 0.12 },
};

export interface SpeakHandlers { onStart?: () => void; onWord?: () => void; onEnd?: () => void }
let epoch = 0;
let serverProvider = "browser";
let audioEl: HTMLAudioElement | null = null;
/** Set from /api/tts/status. Anything other than "browser" means a cloud provider (Azure/Google/ElevenLabs) renders the speech. */
export const setServerTts = (p: string) => { serverProvider = p; };
export const serverTtsProvider = () => serverProvider;

export function stopSpeaking() {
  epoch++;
  if (ttsSupported) speechSynthesis.cancel();
  if (audioEl) { audioEl.pause(); audioEl = null; }
}
export const isSpeaking = () => (ttsSupported && speechSynthesis.speaking) || !!audioEl;
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const hasGujarati = (s: string) => /[\u0A80-\u0AFF]/.test(s);

/** Cloud speech. The SERVER does language segmentation, SSML and phoneme control (see backend/app/tts.py).
 *  Resolves false when it cannot play, so the caller falls back to the browser voice. */
async function speakServer(text: string, prefs: Prefs, emotion: Emotion, h: SpeakHandlers, slow: boolean, my: number): Promise<boolean> {
  if (hasGujarati(text)) return false;                                   // cloud path covers English + Hindi; Gujarati uses the browser voice
  const k = prefs.voice_energy || 1;
  let blob: Blob;
  try {
    blob = await apiBlob("/tts", { text, accent: prefs.pron_accent || "en-IN", slow, rate: clamp((prefs.voice_rate || 1) + EMO[emotion].r * k, 0.5, 1.5), pitch: clamp((prefs.voice_pitch || 1) + EMO[emotion].p * k, 0.5, 1.5) });
  } catch { return false; }
  if (my !== epoch) return true;                                         // interrupted while loading
  const url = URL.createObjectURL(blob); const a = new Audio(url); audioEl = a;
  return new Promise<boolean>((res) => {
    let t = 0;
    const done = (ok: boolean) => { clearInterval(t); URL.revokeObjectURL(url); if (audioEl === a) audioEl = null; res(ok); };
    a.onplay = () => { h.onStart?.(); t = window.setInterval(() => h.onWord?.(), 170); };   // lip-sync pulses (no word events from audio files)
    a.onended = () => done(true); a.onerror = () => done(false);
    a.play().catch(() => done(false));
  });
}

/** `text` is what the voice says (Hindi words in Devanagari for Hinglish). `roman` is used when no Hindi voice is installed.
 *  Browser path = language-aware: every run of Devanagari / Gujarati / Latin text is spoken by a voice FOR THAT LANGUAGE,
 *  so English terms are never read by a Hindi voice (or spelled out) and Hindi words are never read as English letters. */
export function speak(text: string, prefs: Prefs, emotion: Emotion, voices: SpeechSynthesisVoice[], h: SpeakHandlers = {}, roman?: string, opts: { slow?: boolean; word?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    stopSpeaking();
    const my = epoch;
    const browser = () => {
      if (!ttsSupported) { setTimeout(() => { h.onEnd?.(); resolve(); }, Math.min(8000, text.length * 55)); return; }
      const en = prefs.pron_accent || "en-IN";
      const hi = voiceForLang(prefs, voices, "hi-IN"), gu = voiceForLang(prefs, voices, "gu-IN");
      // ONE voice for the whole lesson: the teacher's selected voice (or, if none was selected, the best voice of the
      // teacher's gender). Before, each language picked its own voice, so when e.g. no male Hindi voice was installed,
      // NEX's Hindi sentences came out in a female voice and the voice kept changing mid-lesson.
      // Single words in Pronunciation Studio still use the chosen English accent.
      let main = opts.word ? (voiceForLang(prefs, voices, en) ?? teacherVoice(prefs, voices)) : teacherVoice(prefs, voices);
      // EVERY sentence is spoken by ONE voice of the teacher's gender - never split word by word between two voices.
      // - Gujarati text: a Gujarati voice of that gender (Edge: Dhwani / Niranjan); else the Gujarati letters are turned into
      //   the parallel Devanagari letters for a Hindi voice of that gender; else into Roman letters for the teacher's voice.
      // - Hindi (Devanagari) text: a Hindi voice of that gender (Edge: Swara / Madhur); else Roman letters for the teacher's
      //   voice. (Before, the Hindi words went to a Hindi voice of the OTHER gender and the English words to the teacher's
      //   voice, so NEX and a female voice took turns word by word.)
      const g = prefs.teacher === "aira" ? "f" : "m";
      const same = (lang: string) => voices.find((v) => norm(v.lang).startsWith(lang) && guessGender(v) === g) ?? voices.find((v) => norm(v.lang).startsWith(lang) && guessGender(v) === "?");
      const ml = () => (main ? norm(main.lang).slice(0, 2) : "en");
      const DEVA = /[\u0900-\u097F]/, GUJ = /[\u0A80-\u0AFF]/;
      let src = text;
      if (!opts.word && main) {
        if (GUJ.test(text) && ml() !== "gu") {
          const gu = same("gu"), hiV = ml() === "hi" ? main : same("hi");
          if (gu) main = gu;
          else if (hiV) { main = hiV; src = guToDeva(text); }
          else src = devaToRoman(guToDeva(text));
        } else if (DEVA.test(text) && ml() !== "hi") {
          const hiV = same("hi");
          if (hiV) main = hiV;
          else src = roman && !DEVA.test(roman) && !GUJ.test(roman) ? roman : devaToRoman(text);
        }
      }
      const mainLang = ml();
      const canRead = (t: string) => (/[\u0900-\u097F]/.test(t) ? mainLang === "hi" : /[\u0A80-\u0AFF]/.test(t) ? mainLang === "gu" : true);
      const k = prefs.voice_energy || 1;
      const units: { t: string; v?: SpeechSynthesisVoice; lang: string }[] = [];
      for (const s of src.match(/[^.!?।]+[.!?।]*/g) ?? [src]) {
        const whole = s.trim();
        if (!/[\p{L}\p{N}]/u.test(whole)) continue;
        if (canRead(whole)) { units.push({ t: whole, v: main, lang: main?.lang ?? en }); continue; }   // the normal case: whole sentence, teacher's voice
        // Rare: a script the teacher's voice cannot read at all (e.g. Gujarati letters with a Hindi voice). Only that part
        // goes to a voice for its script (same gender preferred); everything else stays in the teacher's voice.
        for (const run of s.match(/[\u0900-\u097F][\u0900-\u097F\s,]*|[\u0A80-\u0AFF][\u0A80-\u0AFF\s,]*|[^\u0900-\u097F\u0A80-\u0AFF]+/g) ?? [s]) {
          const t = run.trim();
          if (!/[\p{L}\p{N}]/u.test(t)) continue;
          if (canRead(t)) units.push({ t, v: main, lang: main?.lang ?? en });
          else if (/[\u0900-\u097F]/.test(t)) units.push({ t, v: hi, lang: "hi-IN" });
          else units.push({ t, v: gu, lang: "gu-IN" });
        }
      }
      let i = 0;
      const next = () => {
        if (my !== epoch) return resolve();
        if (i >= units.length) { h.onEnd?.(); return resolve(); }
        const un = units[i++];
        const u = new SpeechSynthesisUtterance(un.t);
        if (un.v) u.voice = un.v;
        u.lang = un.v?.lang ?? un.lang;
        u.rate = clamp(((prefs.voice_rate || 1) + EMO[emotion].r * k) * (opts.slow ? 0.7 : 1), 0.4, 1.6);
        u.pitch = clamp((prefs.voice_pitch || 1) + EMO[emotion].p * k, 0.5, 1.8);
        u.onstart = () => { if (i === 1) h.onStart?.(); };
        u.onboundary = () => h.onWord?.();
        u.onend = next;
        u.onerror = (e) => { if (e.error === "interrupted" || e.error === "canceled") return resolve(); next(); };
        speechSynthesis.speak(u);
      };
      next();
    };
    if (serverProvider !== "browser") {
      speakServer(text, prefs, emotion, h, !!opts.slow, my).then((ok) => { if (ok) { if (my === epoch) h.onEnd?.(); resolve(); } else if (my === epoch) browser(); else resolve(); });
    } else browser();
  });
}

/** Speaks ONE word or phrase exactly as written, at normal or slow speed (used by the speaker icons and Pronunciation Studio). */
export const speakWord = (word: string, prefs: Prefs, voices: SpeechSynthesisVoice[], slow = false, h: SpeakHandlers = {}) => speak(word, prefs, "neutral", voices, h, undefined, { slow, word: true });

// ---------------- Speech to text, wake word, push-to-talk ----------------
const ALIASES: Record<string, string[]> = {
  aira: ["aira", "ira", "eira", "era", "ayra", "aera", "aaira", "hey aira"],
  nex: ["nex", "next", "necks", "neks"],
};
const NOT_WAKE_AFTER_NEXT = /^(topic|step|slide|question|page|one|part|chapter|line|example|concept|point)\b/i;

/** Returns the command after the wake word, or null when the speech was not addressed to the teacher. */
export function matchWake(text: string, prefs: Prefs): { command: string } | null {
  const t = text.trim();
  const base = prefs.teacher === "aira" ? "aira" : "nex";
  const words = [base, ...(prefs.wake_word ? [prefs.wake_word.toLowerCase()] : []), ...(ALIASES[base] ?? [])];
  if (prefs.teacher_name) words.push(prefs.teacher_name.toLowerCase());
  const honor = prefs.teacher === "aira" ? "ma'?am|madam" : "sir";
  for (const w of [...new Set(words)].sort((a, b) => b.length - a.length)) {
    const m = new RegExp(`(^|[\\s,.!?])(?:hey|hi|ok|okay)?\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s+(?:${honor}))?\\b[\\s,.:!?-]*`, "i").exec(t);
    if (!m) continue;
    const rest = t.slice(m.index + m[0].length).trim();
    if (w === "next" && NOT_WAKE_AFTER_NEXT.test(rest) && !/sir/i.test(m[0])) continue;
    return { command: rest };
  }
  const h = new RegExp(`^(${honor})\\b[\\s,.:!?-]*`, "i").exec(t);  // "Ma'am, ..." / "Sir, ..."
  return h ? { command: t.slice(h[0].length).trim() } : null;
}

export type ListenState = "off" | "starting" | "listening" | "error";
export interface ListenerOpts {
  lang: string; continuous: boolean;
  onFinal: (text: string, confidence: number) => void;
  onInterim?: (text: string) => void;
  onState: (s: ListenState, msg?: string) => void;
}

export function createListener(o: ListenerOpts) {
  const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  let rec: any = null;
  let wanted = false;
  const build = () => {
    rec = new Ctor();
    rec.lang = o.lang; rec.continuous = o.continuous; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onstart = () => o.onState("listening");
    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) o.onFinal(r[0].transcript, r[0].confidence ?? 1);
        else o.onInterim?.(r[0].transcript);
      }
    };
    rec.onerror = (e: any) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted = false;
      const msg = e.error === "not-allowed" ? "Microphone permission was denied. Allow it in your browser's address bar." :
        e.error === "network" ? "Speech recognition needs an internet connection in this browser." :
        e.error === "audio-capture" ? "No microphone was found." : `Speech recognition error: ${e.error}`;
      o.onState("error", msg);
    };
    rec.onend = () => {
      if (wanted && o.continuous) { try { rec.start(); } catch { /* already started */ } }
      else if (wanted || !o.continuous) { wanted = false; o.onState("off"); }
    };
  };
  return {
    start() { if (!Ctor) return o.onState("error", "Voice input is not supported in this browser. Use Chrome or Edge, or type your question."); wanted = true; o.onState("starting"); build(); try { rec.start(); } catch { /* ignore */ } },
    stop() { wanted = false; try { rec?.stop(); } catch { /* ignore */ } o.onState("off"); },
  };
}
