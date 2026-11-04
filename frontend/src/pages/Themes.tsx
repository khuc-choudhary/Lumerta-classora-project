import { Field, Page } from "../components/ui";
import { BOARDS, PRESETS } from "../theme";
import { useApp } from "../store";

export default function Themes() {
  const { prefs, savePrefs } = useApp(); const t = prefs.theme;
  const set = (p: Partial<typeof t>) => savePrefs({ theme: { ...t, ...p } });
  return (
    <Page title="Theme Studio" sub="Make LUMETRA CLASSORA yours. Saved to your account.">
      <div className="space-y-4">
        <div className="glass p-5"><h3 className="font-bold mb-3">Colour theme</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Object.entries(PRESETS).map(([k, p]) => (
              <button key={k} aria-pressed={t.preset === k && !t.accent} onClick={() => set({ preset: k, accent: undefined, accent2: undefined })} className={`glass p-3 flex items-center gap-2 text-left ${t.preset === k && !t.accent ? "sel" : ""}`}>
                <span className="h-8 w-8 rounded-full shrink-0" style={{ background: `linear-gradient(135deg,${p.a},${p.b})` }} /><span className="text-sm font-semibold">{p.label}</span></button>))}
          </div>
        </div>
        <div className="glass p-5 grid sm:grid-cols-2 gap-5">
          <Field label="Mode"><div className="flex gap-2 flex-wrap">{([["dark", "🌙 Dark"], ["light", "☀️ Light"], ["amoled", "⚫ AMOLED"]] as const).map(([k, l]) => <button key={k} aria-pressed={t.mode === k} className={`btn ${t.mode === k ? "sel" : ""}`} onClick={() => set({ mode: k })}>{l}</button>)}</div></Field>
          <Field label="Interface shape"><div className="flex gap-2">{([["round", "Rounded"], ["sharp", "Minimal"]] as const).map(([k, l]) => <button key={k} aria-pressed={t.radius === k} className={`btn ${t.radius === k ? "sel" : ""}`} onClick={() => set({ radius: k })}>{l}</button>)}</div></Field>
          <Field label="Custom accent colours" hint="Overrides the colour theme."><div className="flex gap-3 items-center"><input type="color" aria-label="Accent colour" value={t.accent || PRESETS[t.preset]?.a || "#8b5cf6"} onChange={(e) => set({ accent: e.target.value })} className="h-10 w-14 rounded bg-transparent" /><input type="color" aria-label="Secondary accent colour" value={t.accent2 || PRESETS[t.preset]?.b || "#22d3ee"} onChange={(e) => set({ accent2: e.target.value })} className="h-10 w-14 rounded bg-transparent" />{t.accent && <button className="btn btn-sm" onClick={() => set({ accent: undefined, accent2: undefined })}>Reset</button>}</div></Field>
          <Field label={`Font size: ${t.font}px`}><input type="range" className="w-full" min={13} max={20} value={t.font} onChange={(e) => set({ font: +e.target.value })} aria-label="Font size" /></Field>
        </div>
        <div className="glass p-5"><h3 className="font-bold mb-3">Blackboard theme</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(BOARDS).map(([k, b]) => <button key={k} aria-pressed={t.board === k} onClick={() => set({ board: k })} className={`rounded-xl p-3 text-left ${t.board === k ? "sel" : ""}`} style={{ background: b.bg, border: `4px solid ${b.frame}`, color: b.ink }}><span className="hand-font text-lg">Aa 2+2=4</span><div className="text-[11px] opacity-70">{b.label}</div></button>)}
          </div>
          <p className="text-xs text-muted mt-3">Avatar background and look are in Teacher Studio → Avatar.</p>
        </div>
      </div>
    </Page>
  );
}
