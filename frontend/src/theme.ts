import type { Prefs } from "./types";

export const PRESETS: Record<string, { label: string; a: string; b: string }> = {
  pink: { label: "Pink", a: "#ec4899", b: "#f9a8d4" },
  lavender: { label: "Lavender", a: "#a78bfa", b: "#f0abfc" },
  violet: { label: "Purple", a: "#8b5cf6", b: "#22d3ee" },
  blue: { label: "Blue", a: "#3b82f6", b: "#06b6d4" },
  sky: { label: "Sky Blue", a: "#38bdf8", b: "#a5f3fc" },
  mint: { label: "Mint Green", a: "#34d399", b: "#a7f3d0" },
  emerald: { label: "Emerald", a: "#10b981", b: "#22d3ee" },
  peach: { label: "Peach", a: "#fb923c", b: "#fda4af" },
  orange: { label: "Orange", a: "#f97316", b: "#facc15" },
  red: { label: "Red", a: "#ef4444", b: "#fb7185" },
  sunset: { label: "Gradient · Sunset", a: "#f43f5e", b: "#f59e0b" },
  aurora: { label: "Gradient · Aurora", a: "#22d3ee", b: "#a855f7" },
};

export function applyTheme(t: Prefs["theme"]) {
  const r = document.documentElement;
  const p = PRESETS[t.preset] ?? PRESETS.violet;
  r.style.setProperty("--accent", t.accent || p.a);
  r.style.setProperty("--accent2", t.accent2 || p.b);
  r.style.setProperty("--fs", `${t.font || 16}px`);
  r.classList.toggle("mode-light", t.mode === "light");
  r.classList.toggle("mode-amoled", t.mode === "amoled");
  r.classList.toggle("sharp", t.radius === "sharp");
  r.style.colorScheme = t.mode === "light" ? "light" : "dark";
}

export const BOARDS: Record<string, { bg: string; ink: string; label: string; frame: string }> = {
  green: { bg: "#17372c", ink: "#f4f1e8", label: "Classic green chalkboard", frame: "#8a5a2b" },
  black: { bg: "#0f1115", ink: "#f4f1e8", label: "Black board", frame: "#374151" },
  white: { bg: "#fbfbf7", ink: "#1f2937", label: "White board", frame: "#9ca3af" },
  navy: { bg: "#10213f", ink: "#e8efff", label: "Navy board", frame: "#334155" },
};
