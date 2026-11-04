import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { getVoices, speakWord } from "../speech";
import { useApp } from "../store";

let cache: Set<string> | null = null;
let loading: Promise<void> | null = null;
function loadTerms(): Promise<void> {
  loading ??= api<{ terms: string[] }>("/pron/terms").then((r) => { cache = new Set(r.terms); }).catch(() => { cache = new Set(); });
  return loading;
}

/** Plays ONE word with correct pronunciation. Stops the running lesson first so the lesson loop cannot talk over it. */
export function SpeakButton({ word, onBefore }: { word: string; onBefore?: () => void }) {
  const { prefs } = useApp();
  return (
    <button type="button" aria-label={`Pronounce ${word}`} title={`Hear “${word}”  (shift-click: slow)`}
      className="inline-flex align-baseline mx-0.5 px-1 rounded text-[.8em] opacity-80 hover:opacity-100 hover:bg-white/10"
      onClick={async (e) => { e.stopPropagation(); onBefore?.(); speakWord(word, prefs, await getVoices(), e.shiftKey); }}>🔊</button>
  );
}

/** Text with a speaker icon after genuinely difficult words only: the curated technical dictionary plus the words the document
 *  analysis found to be rare/technical in THIS document (by real word frequency). Ordinary words and long-but-common words get no icon. */
export function Speakable({ text, onBefore, difficult }: { text: string; onBefore?: () => void; difficult?: string[] }) {
  const [, setReady] = useState(!!cache);
  useEffect(() => { if (!cache) loadTerms().then(() => setReady(true)); }, []);
  const extra = useMemo(() => new Set(difficult ?? []), [difficult]);
  const seen = new Set<string>();
  const parts = text.split(/([A-Za-z][A-Za-z'-]{2,})/);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const k = p.toLowerCase();
        if (seen.has(k) || !(cache?.has(k) || extra.has(k))) return p;
        seen.add(k);
        return <span key={i}>{p}<SpeakButton word={p} onBefore={onBefore} /></span>;
      })}
    </>
  );
}
