import { motion } from "framer-motion";
import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { Emotion, Gesture, Prefs } from "../types";

type P = [number, number];
const POSES: Record<Gesture, { r: [P, P, P]; l: [P, P, P] }> = {
  none: { r: [[150, 205], [162, 238], [156, 262]], l: [[50, 205], [38, 238], [44, 262]] },
  nod: { r: [[150, 205], [162, 238], [156, 262]], l: [[50, 205], [38, 238], [44, 262]] },
  point: { r: [[150, 205], [182, 222], [214, 196]], l: [[50, 205], [38, 238], [44, 262]] },
  open: { r: [[150, 205], [180, 232], [208, 218]], l: [[50, 205], [20, 232], [-8, 218]] },
  think: { r: [[150, 205], [168, 240], [116, 168]], l: [[50, 205], [38, 238], [44, 262]] },
  emphasis: { r: [[150, 205], [178, 215], [182, 168]], l: [[50, 205], [38, 238], [44, 262]] },
};
const arm = ([a, b, c]: [P, P, P]) => `M${a[0]} ${a[1]} L${b[0]} ${b[1]} L${c[0]} ${c[1]}`;

const BROWS: Record<Emotion, { y: number; tilt: number }> = {
  neutral: { y: 0, tilt: 0 }, excited: { y: -4, tilt: -4 }, calm: { y: 1, tilt: 3 }, serious: { y: 2, tilt: 8 },
  encouraging: { y: -2, tilt: -3 }, friendly: { y: -1, tilt: -2 }, curious: { y: -6, tilt: -6 },
};
const SMILE: Record<Emotion, number> = { neutral: 3, excited: 8, calm: 4, serious: -1, encouraging: 7, friendly: 6, curious: 1 };

/** Mouth openness 0..1. Driven by TTS word-boundary events + an oscillation; approximate lip movement, not phoneme-accurate. */
function useMouth(speaking: boolean, pulse: number, lowPower: boolean) {
  const [open, setOpen] = useState(0);
  const last = useRef(0);
  useEffect(() => { last.current = performance.now(); }, [pulse]);
  useEffect(() => {
    if (!speaking) { setOpen(0); return; }
    if (lowPower) { const id = setInterval(() => setOpen((o) => (o > 0.4 ? 0.15 : 0.8)), 170); return () => clearInterval(id); }
    let raf = 0;
    const loop = (t: number) => {
      const recent = t - last.current < 320 ? 1 : 0.55;
      setOpen((0.18 + 0.82 * Math.abs(Math.sin(t / 95) * Math.cos(t / 230))) * recent);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [speaking, lowPower]);
  return open;
}

const Avatar3D = lazy(() => import("./Avatar3D"));
type AvatarProps = { prefs: Prefs; speaking: boolean; emotion: Emotion; gesture: Gesture; pulse: number; size?: number };

/** Picks the 3D teacher (three.js, lazy-loaded) or the 2D SVG teacher; falls back to 2D if WebGL is unavailable. */
export function Avatar(p: AvatarProps) {
  const [no3d, setNo3d] = useState(false);
  if (p.prefs.avatar !== "realistic3d" || no3d) return <Avatar2D {...p} prefs={p.prefs.avatar === "realistic3d" ? { ...p.prefs, avatar: "animated" } : p.prefs} />;
  const size = p.size ?? 260;
  return (
    <Suspense fallback={<Avatar2D {...p} prefs={{ ...p.prefs, avatar: "minimal" }} />}>
      <Avatar3D prefs={p.prefs} speaking={p.speaking} emotion={p.emotion} gesture={p.gesture} pulse={p.pulse} size={size} onFail={() => setNo3d(true)} />
    </Suspense>
  );
}

function Avatar2D({ prefs, speaking, emotion, gesture, pulse, size = 260 }: AvatarProps) {
  const open = useMouth(speaking, pulse, prefs.low_power);
  const look = prefs.avatar_look;
  const female = prefs.teacher === "aira";
  const brow = BROWS[emotion];
  const smile = SMILE[emotion];
  const pose = POSES[gesture];
  const my = 128;
  const mouth = `M88 ${my} Q100 ${my + smile} 112 ${my} Q100 ${my + smile + open * 20} 88 ${my} Z`;
  const style = look.hairstyle || (female ? "long" : "short");
  const dur = prefs.low_power ? 0 : 0.5;
  const skin = prefs.avatar === "robot" ? "#cbd5e1" : prefs.avatar === "minimal" ? "transparent" : look.skin;
  const outfit = look.outfit;

  const arms = prefs.avatar !== "minimal" && (
    <>
      {(["r", "l"] as const).map((s) => (
        <g key={s}>
          <motion.path animate={{ d: arm(pose[s]) }} transition={{ duration: dur, ease: "easeInOut" }} stroke={outfit} strokeWidth={17} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <motion.circle animate={{ cx: pose[s][2][0], cy: pose[s][2][1] }} transition={{ duration: dur, ease: "easeInOut" }} r={9} fill={skin === "transparent" ? "#cbd5e1" : skin} />
        </g>
      ))}
    </>
  );

  return (
    <svg viewBox="-30 0 260 275" width={size} height={size * 275 / 260} role="img" aria-label={`${prefs.teacher_name || (female ? "AIRA" : "NEX")} the AI teacher is ${speaking ? "speaking" : "listening"}`} className={prefs.low_power ? "" : "float"}>
      {prefs.avatar !== "minimal" && <path d="M30 275 Q30 195 100 192 Q170 195 170 275Z" fill={outfit} />}
      {prefs.avatar !== "minimal" && <rect x="88" y="168" width="24" height="30" rx="8" fill={skin} />}
      {arms}
      <motion.g animate={gesture === "nod" ? { rotate: [0, 4, 0, 4, 0] } : { rotate: 0 }} transition={{ duration: 1.2 }} style={{ transformOrigin: "100px 170px" }}>
        {prefs.avatar === "animated" && (
          <>
            {style === "long" && <path d="M48 95 Q42 30 100 26 Q158 30 152 95 L158 190 Q100 205 42 190Z" fill={look.hair} />}
            {style === "bun" && <circle cx="100" cy="22" r="20" fill={look.hair} />}
            {style === "curly" && [0, 1, 2, 3, 4, 5].map((i) => <circle key={i} cx={52 + i * 19} cy={60 - Math.sin(i / 5 * Math.PI) * 18} r="17" fill={look.hair} />)}
            <ellipse cx="100" cy="98" rx="50" ry="62" fill={skin} />
            <path d={style === "short" ? "M50 90 Q46 30 100 30 Q154 30 150 90 Q140 55 100 55 Q60 55 50 90Z" : "M50 92 Q52 34 100 32 Q148 34 150 92 Q130 58 100 62 Q70 58 50 92Z"} fill={look.hair} />
            <circle cx="73" cy="115" r="7" fill="#ff8aa1" opacity=".25" /><circle cx="127" cy="115" r="7" fill="#ff8aa1" opacity=".25" />
          </>
        )}
        {prefs.avatar === "cartoon" && (
          <>
            <circle cx="100" cy="98" r="64" fill={skin} />
            <path d="M40 80 Q50 22 100 24 Q150 22 160 80 Q130 50 100 52 Q70 50 40 80Z" fill={look.hair} />
            <circle cx="40" cy="104" r="12" fill={skin} /><circle cx="160" cy="104" r="12" fill={skin} />
          </>
        )}
        {prefs.avatar === "robot" && (
          <>
            <line x1="100" y1="22" x2="100" y2="40" stroke="#94a3b8" strokeWidth="4" /><circle cx="100" cy="18" r="7" fill={speaking ? "var(--accent2)" : "#64748b"} />
            <rect x="46" y="40" width="108" height="100" rx="26" fill="#cbd5e1" /><rect x="56" y="54" width="88" height="62" rx="16" fill="#0f172a" />
            <rect x="36" y="80" width="10" height="26" rx="4" fill="#94a3b8" /><rect x="154" y="80" width="10" height="26" rx="4" fill="#94a3b8" />
          </>
        )}
        {prefs.avatar === "minimal" && (
          <>
            <defs><radialGradient id="orb"><stop offset="0" stopColor="var(--accent2)" /><stop offset="1" stopColor="var(--accent)" /></radialGradient></defs>
            <motion.circle cx="100" cy="120" r="70" fill="url(#orb)" animate={{ r: speaking ? 70 + open * 8 : 70 }} />
          </>
        )}

        {/* eyes + brows */}
        {prefs.avatar === "robot" ? (
          <>
            <motion.rect x="66" y="72" width="22" height="18" rx="6" fill="var(--accent2)" className="blink" animate={{ y: 72 + brow.y }} />
            <motion.rect x="112" y="72" width="22" height="18" rx="6" fill="var(--accent2)" className="blink" animate={{ y: 72 + brow.y }} />
            {[0, 1, 2, 3, 4, 5, 6].map((i) => <rect key={i} x={70 + i * 9.5} y={104 - (speaking ? open * (6 + (i % 3) * 3) : 0)} width="6" height={3 + (speaking ? open * (12 + (i % 3) * 5) : 0)} rx="2" fill="var(--accent2)" />)}
          </>
        ) : prefs.avatar === "minimal" ? (
          <>
            <circle cx="78" cy="110" r="6" fill="#fff" className="blink" /><circle cx="122" cy="110" r="6" fill="#fff" className="blink" />
            <path d={`M82 ${140} Q100 ${140 + smile + open * 22} 118 140`} stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <>
            <g className="blink"><ellipse cx="78" cy="98" rx={prefs.avatar === "cartoon" ? 11 : 7} ry={prefs.avatar === "cartoon" ? 14 : 8} fill="#fff" /><circle cx="79" cy="99" r={prefs.avatar === "cartoon" ? 7 : 4.5} fill="#2a2018" /></g>
            <g className="blink"><ellipse cx="122" cy="98" rx={prefs.avatar === "cartoon" ? 11 : 7} ry={prefs.avatar === "cartoon" ? 14 : 8} fill="#fff" /><circle cx="121" cy="99" r={prefs.avatar === "cartoon" ? 7 : 4.5} fill="#2a2018" /></g>
            <motion.line x1="66" x2="90" animate={{ y1: 84 + brow.y + brow.tilt / 2, y2: 84 + brow.y - brow.tilt / 2 }} stroke={look.hair} strokeWidth="3.5" strokeLinecap="round" />
            <motion.line x1="110" x2="134" animate={{ y1: 84 + brow.y - brow.tilt / 2, y2: 84 + brow.y + brow.tilt / 2 }} stroke={look.hair} strokeWidth="3.5" strokeLinecap="round" />
            <path d="M100 104 q-3 12 3 14" stroke="#0003" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d={mouth} fill={open > 0.12 ? "#7a1f2b" : "none"} stroke="#7a1f2b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
            {open > 0.45 && <ellipse cx="100" cy={my + 3 + smile / 2} rx="8" ry="2.5" fill="#fff" opacity=".85" />}
          </>
        )}
      </motion.g>
    </svg>
  );
}

export const AVATAR_BG: Record<string, string> = {
  classroom: "linear-gradient(180deg,#2a3a5e,#1a2440)", library: "linear-gradient(180deg,#4a3320,#2a1c12)", space: "linear-gradient(180deg,#14103a,#05030f)",
  sunrise: "linear-gradient(180deg,#f9a8d4,#fcd34d)", mint: "linear-gradient(180deg,#34d399,#0f766e)", plain: "linear-gradient(180deg,#1f2937,#111827)",
};
