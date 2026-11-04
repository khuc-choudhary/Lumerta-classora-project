import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Emotion, Gesture, Prefs } from "../types";

/** Real-time 3D teacher built procedurally with three.js (no downloaded model).
 *  Jaw/lip movement follows TTS word timing (approximate, not phoneme-exact). */

const SMILE: Record<Emotion, number> = { neutral: 0.3, excited: 0.95, calm: 0.4, serious: 0.06, encouraging: 0.8, friendly: 0.7, curious: 0.2 };
// tilt > 0 = inner brow ends lowered (serious), < 0 = inner ends raised (soft / curious)
const BROWS: Record<Emotion, { y: number; t: number }> = {
  neutral: { y: 0, t: 0 }, excited: { y: 0.04, t: -0.15 }, calm: { y: -0.005, t: -0.08 }, serious: { y: -0.03, t: 0.3 },
  encouraging: { y: 0.02, t: -0.1 }, friendly: { y: 0.012, t: -0.06 }, curious: { y: 0.06, t: -0.1 },
};
interface Arm { ux: number; uz: number; ex: number }
const POSE: Record<Gesture, { r: Arm; l: Arm }> = {
  none: { r: { ux: -0.05, uz: 0.12, ex: -0.25 }, l: { ux: -0.05, uz: -0.12, ex: -0.25 } },
  nod: { r: { ux: -0.05, uz: 0.12, ex: -0.25 }, l: { ux: -0.05, uz: -0.12, ex: -0.25 } },
  open: { r: { ux: -0.25, uz: 0.8, ex: -0.7 }, l: { ux: -0.25, uz: -0.8, ex: -0.7 } },
  point: { r: { ux: -0.2, uz: 1.05, ex: -0.15 }, l: { ux: -0.05, uz: -0.12, ex: -0.25 } },
  think: { r: { ux: -1.1, uz: 0.25, ex: -2.3 }, l: { ux: -0.05, uz: -0.12, ex: -0.25 } },
  emphasis: { r: { ux: -0.4, uz: 0.6, ex: -1.4 }, l: { ux: -0.05, uz: -0.12, ex: -0.25 } },
};

const AX = 0.46, AY = 0.55, AZ = 0.475;                       // head ellipsoid radii
const surfZ = (x: number, y: number) => AZ * Math.sqrt(Math.max(0.02, 1 - (x / AX) ** 2 - (y / AY) ** 2));
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);

function build(prefs: Prefs, lowPower: boolean) {
  const look = prefs.avatar_look, female = prefs.teacher === "aira";
  const skinC = new THREE.Color(look.skin), hairC = new THREE.Color(look.hair), outfitC = new THREE.Color(look.outfit);
  const lipC = skinC.clone().lerp(new THREE.Color("#b03a48"), 0.55);
  const seg = lowPower ? 16 : 36;

  const skin = new THREE.MeshPhysicalMaterial({ color: skinC, roughness: 0.58, sheen: 0.5, sheenColor: new THREE.Color("#ffb3a7"), sheenRoughness: 0.6 });
  const hairM = new THREE.MeshStandardMaterial({ color: hairC, roughness: 0.75 });
  const outfitM = new THREE.MeshStandardMaterial({ color: outfitC, roughness: 0.7 });
  const lipM = new THREE.MeshStandardMaterial({ color: lipC, roughness: 0.4 });
  const dark = new THREE.MeshBasicMaterial({ color: "#2a0a10" });
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number] = [0, 0, 0], s: [number, number, number] = [1, 1, 1]) => {
    const o = new THREE.Mesh(g, m); o.position.set(...p); o.scale.set(...s); return o;
  };
  const sph = (r: number) => new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));

  const root = new THREE.Group();

  // ----- body -----
  const torso = mesh(new THREE.CapsuleGeometry(0.45, 0.5, 8, seg), outfitM, [0, -0.72, 0], [1.25, 1, 0.72]);
  root.add(torso);
  root.add(mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.3, 20), skin, [0, 0.0, 0]));
  const collar = mesh(new THREE.TorusGeometry(0.19, 0.035, 10, 32), new THREE.MeshStandardMaterial({ color: outfitC.clone().lerp(new THREE.Color("#ffffff"), 0.7), roughness: 0.6 }), [0, -0.1, 0.01]);
  collar.rotation.x = Math.PI / 2; root.add(collar);

  // ----- arms (shoulder -> elbow hierarchy) -----
  const makeArm = (side: 1 | -1) => {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.58, -0.22, 0);
    shoulder.add(mesh(sph(0.11), outfitM));
    shoulder.add(mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.5, 20), outfitM, [0, -0.25, 0]));
    const elbow = new THREE.Group(); elbow.position.y = -0.5;
    elbow.add(mesh(sph(0.078), outfitM));
    elbow.add(mesh(new THREE.CylinderGeometry(0.07, 0.058, 0.4, 20), outfitM, [0, -0.2, 0]));
    elbow.add(mesh(new THREE.CylinderGeometry(0.052, 0.05, 0.1, 16), skin, [0, -0.43, 0]));
    elbow.add(mesh(sph(0.075), skin, [0, -0.52, 0], [0.9, 1.15, 0.6]));
    shoulder.add(elbow); root.add(shoulder);
    return { shoulder, elbow };
  };
  const armR = makeArm(1), armL = makeArm(-1);

  // ----- head -----
  const pivot = new THREE.Group(); pivot.position.set(0, 0.12, 0); root.add(pivot);
  const head = new THREE.Group(); head.position.set(0, 0.5, 0); pivot.add(head);
  head.add(mesh(sph(1), skin, [0, 0, 0], [AX, AY, AZ]));
  for (const s of [-1, 1]) {
    head.add(mesh(sph(0.07), skin, [s * 0.455, 0, -0.02], [0.45, 1, 0.7]));                   // ears
    head.add(mesh(sph(0.075), new THREE.MeshBasicMaterial({ color: "#ff7a90", transparent: true, opacity: 0.22 }), [s * 0.27, -0.1, surfZ(0.27, -0.1) - 0.015], [1, 0.8, 0.3])); // cheeks
    if (female) head.add(mesh(sph(0.022), new THREE.MeshStandardMaterial({ color: "#f5c542", metalness: 0.8, roughness: 0.25 }), [s * 0.46, -0.11, 0.0]));
  }
  head.add(mesh(sph(0.046), skin, [0, -0.04, surfZ(0, -0.04) + 0.03], [1, 1.35, 1]));          // nose

  // eyes
  const eyes: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Group(); e.position.set(s * 0.17, 0.07, surfZ(0.17, 0.07) - 0.025);
    e.add(mesh(sph(0.062), new THREE.MeshStandardMaterial({ color: "#f8f6f2", roughness: 0.25 })));
    e.add(mesh(sph(0.034), new THREE.MeshStandardMaterial({ color: "#3a2518", roughness: 0.1 }), [0, 0, 0.044], [1, 1, 0.5]));
    e.add(mesh(sph(0.015), new THREE.MeshBasicMaterial({ color: "#000" }), [0, 0, 0.062], [1, 1, 0.4]));
    e.add(mesh(sph(0.009), new THREE.MeshBasicMaterial({ color: "#fff" }), [0.013, 0.014, 0.066]));
    if (female) { const lash = mesh(new THREE.TorusGeometry(0.058, 0.007, 6, 16, Math.PI), new THREE.MeshBasicMaterial({ color: "#150d0a" }), [0, 0.012, 0.03]); e.add(lash); }
    head.add(e); eyes.push(e);
  }
  // brows
  const browGeo = new THREE.CapsuleGeometry(0.012, 0.11, 4, 8);
  const browMat = new THREE.MeshStandardMaterial({ color: hairC.clone().multiplyScalar(0.8), roughness: 0.9 });
  const browR = mesh(browGeo, browMat), browL = mesh(browGeo, browMat);
  browR.rotation.z = Math.PI / 2; browL.rotation.z = Math.PI / 2;
  const browPivR = new THREE.Group(), browPivL = new THREE.Group();
  browPivR.add(browR); browPivL.add(browL); head.add(browPivR, browPivL);

  // mouth
  const MY = -0.2, MR = 0.1, MZ = surfZ(0, -0.22) + 0.012;
  const lipGeo = new THREE.TorusGeometry(MR, female ? 0.019 : 0.016, 8, 24, Math.PI);
  const upper = mesh(lipGeo, lipM), lower = mesh(lipGeo, lipM);
  upper.rotation.z = Math.PI; lower.rotation.z = Math.PI;         // bowl shape (corners up when scaled)
  upper.position.set(0, MY, MZ); lower.position.set(0, MY, MZ + 0.004);
  const cavity = mesh(sph(1), dark, [0, MY - 0.03, MZ - 0.012], [0.09, 0.02, 0.03]);
  const teeth = mesh(new THREE.BoxGeometry(0.11, 0.016, 0.01), new THREE.MeshStandardMaterial({ color: "#f4f1ea", roughness: 0.3 }), [0, MY - 0.02, MZ - 0.004]);
  head.add(cavity, teeth, lower, upper);

  // hair
  const style = look.hairstyle || (female ? "long" : "short");
  const capLen = style === "short" ? 1.12 : 1.02;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg, 0, Math.PI * 2, 0, capLen), hairM);
  cap.scale.set(AX * 1.07, AY * 1.06, AZ * 1.1); cap.position.set(0, 0.03, -0.03); head.add(cap);
  if (style === "long") head.add(mesh(sph(0.5), hairM, [0, -0.2, -0.13], [0.98, 1.4, 0.8]));
  if (style === "bun") head.add(mesh(sph(0.17), hairM, [0, 0.56, -0.08]));
  if (style === "curly") for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; head.add(mesh(sph(0.12), hairM, [Math.sin(a) * 0.4, 0.2 + Math.cos(a * 2) * 0.05 - Math.abs(Math.cos(a)) * 0.12, -0.08 - Math.cos(a) * 0.18])); }
  if (style === "short") head.add(mesh(sph(0.5), hairM, [0, 0.0, -0.17], [0.94, 1.0, 0.75]));

  return { root, pivot, head, torso, armR, armL, eyes, browPivR, browPivL, browR, browL, upper, lower, cavity, teeth, MY, MR, lipM };
}

export default function Avatar3D({ prefs, speaking, emotion, gesture, pulse, size, onFail }: {
  prefs: Prefs; speaking: boolean; emotion: Emotion; gesture: Gesture; pulse: number; size: number; onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ speaking, emotion, gesture, lastPulse: 0 });
  live.current.speaking = speaking; live.current.emotion = emotion; live.current.gesture = gesture;
  useEffect(() => { live.current.lastPulse = performance.now(); }, [pulse]);

  const key = JSON.stringify([prefs.avatar_look, prefs.teacher, prefs.low_power, size]);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const W = size, H = Math.round(size * 1.05);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: !prefs.low_power, alpha: true, powerPreference: "low-power" }); }
    catch { onFail(); return; }
    renderer.setSize(W, H); renderer.setPixelRatio(prefs.low_power ? 1 : Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute("aria-label", `${prefs.teacher_name || (prefs.teacher === "aira" ? "AIRA" : "NEX")} the 3D AI teacher`);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 50); cam.position.set(0, -0.12, 4.8); cam.lookAt(0, -0.12, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x35405a, 1.05));
    const keyLight = new THREE.DirectionalLight(0xfff1e0, 2.1); keyLight.position.set(2.2, 3, 4); scene.add(keyLight);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 1.1); rim.position.set(-3, 2, -2.5); scene.add(rim);

    const a = build(prefs, !!prefs.low_power); scene.add(a.root);
    const s = { open: 0, smile: 0.3, by: 0, bt: 0, nextBlink: 1.5, blinkAt: -1, ux: [0, 0], uz: [0.12, -0.12], ex: [-0.25, -0.25] };
    let raf = 0, last = 0; const t0 = performance.now();

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now(), t = (now - t0) / 1000, dt = Math.min(0.1, t - last);
      if (prefs.low_power && dt < 1 / 24) return;
      last = t;
      const L = live.current;
      // mouth
      const target = L.speaking ? (0.15 + 0.85 * Math.abs(Math.sin(t * 10.5) * Math.cos(t * 4.3))) * (now - L.lastPulse < 320 ? 1 : 0.5) : 0;
      s.open = lerp(s.open, target, dt * 20);
      s.smile = lerp(s.smile, SMILE[L.emotion], dt * 5);
      const su = 0.08 + s.smile * 0.85, sl = su * 1.25;
      const w = 1 + s.smile * 0.12 - s.open * 0.14;
      a.upper.scale.set(w, su, 1); a.lower.scale.set(w, sl, 1);
      a.lower.position.y = a.MY - s.open * 0.07;
      const du = a.MR * su, dl = a.MR * sl + s.open * 0.07;
      a.cavity.position.y = a.MY - (du + dl) / 2; a.cavity.scale.set(0.095 * w, Math.max(0.004, (dl - du) / 2 + 0.006), 0.03);
      a.teeth.visible = s.open > 0.28; a.teeth.position.y = a.MY - du - 0.008;
      // brows
      const bt = BROWS[L.emotion]; s.by = lerp(s.by, bt.y + (L.speaking ? 0.006 * Math.sin(t * 3) : 0), dt * 6); s.bt = lerp(s.bt, bt.t, dt * 6);
      a.browPivR.position.set(0.17, 0.2 + s.by, surfZ(0.17, 0.2) + 0.005); a.browPivR.rotation.z = s.bt;
      a.browPivL.position.set(-0.17, 0.2 + s.by, surfZ(0.17, 0.2) + 0.005); a.browPivL.rotation.z = -s.bt;
      // blink
      if (t > s.nextBlink) { s.blinkAt = t; s.nextBlink = t + 2 + Math.random() * 3.5; }
      const ph = (t - s.blinkAt) / 0.16; const eyeY = ph >= 0 && ph < 1 ? 1 - Math.sin(ph * Math.PI) * 0.92 : 1;
      a.eyes.forEach((e) => (e.scale.y = eyeY));
      // head & body
      const nod = L.gesture === "nod" ? Math.sin(t * 4.5) * 0.1 : L.speaking ? Math.sin(t * 2.3) * 0.03 : 0;
      a.pivot.rotation.set(nod + (L.emotion === "curious" ? -0.04 : 0), Math.sin(t * 0.6) * 0.09 + (L.speaking ? Math.sin(t * 1.7) * 0.05 : 0), L.emotion === "curious" ? 0.06 : Math.sin(t * 0.8) * 0.015);
      a.torso.scale.y = 1 + Math.sin(t * 1.6) * 0.008;
      // arms
      const P = POSE[L.gesture]; const sway = L.speaking ? 1 : 0.3;
      const emph = L.gesture === "emphasis" ? Math.sin(t * 5) * 0.12 : 0;
      const idle = (i: number) => Math.sin(t * 1.3 + i * 2) * 0.03 * sway;
      ([["r", a.armR, P.r, 0], ["l", a.armL, P.l, 1]] as const).forEach(([, arm, tg, i]) => {
        s.ux[i] = lerp(s.ux[i], tg.ux + emph, dt * 7); s.uz[i] = lerp(s.uz[i], tg.uz, dt * 7); s.ex[i] = lerp(s.ex[i], tg.ex + emph, dt * 7);
        arm.shoulder.rotation.set(s.ux[i] + idle(i), 0, s.uz[i] + idle(i + 3)); arm.elbow.rotation.x = s.ex[i];
      });
      renderer.render(scene, cam);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      scene.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) mat.dispose(); });
      renderer.dispose(); renderer.domElement.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={host} style={{ width: size, height: Math.round(size * 1.05), lineHeight: 0 }} />;
}

