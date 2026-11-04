import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";
import { setServerTts } from "./speech";
import { applyTheme } from "./theme";
import type { Prefs, User } from "./types";

interface Ctx {
  user: User | null; loading: boolean; prefs: Prefs;
  login: (token: string, user: User) => void; logout: () => void; startGuest: () => Promise<void>;
  savePrefs: (p: Partial<Prefs>) => Promise<void>;
  setUser: (u: User) => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
}
const C = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(C);

const FALLBACK = {
  onboarded: false, teacher: "aira", teacher_name: "", wake_word: "", voice: "", voice_rate: 0.95, voice_pitch: 1, voice_energy: 1,
  avatar: "animated", avatar_look: { skin: "#f2c9a5", hair: "#2b1b17", outfit: "#7c5cff", bg: "classroom" }, language: "hinglish", level: "normal",
  personality: "friendly", memes: false, theme: { preset: "violet", mode: "dark", radius: "round", font: 16, board: "green" },
  low_power: false, listen_wake: false, style_profile: null,
} as Prefs;

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const setUser = useCallback((u: User) => { setUserState(u); applyTheme(u.prefs.theme); }, []);
  const logout = useCallback(() => { setToken(null); setUserState(null); }, []);

  useEffect(() => {
    if (!getToken()) return;
    api<User>("/me").then(setUser).catch(() => logout()).finally(() => setLoading(false));
    const h = () => setUserState(null);
    window.addEventListener("lumetra:logout", h);
    return () => window.removeEventListener("lumetra:logout", h);
  }, [setUser, logout]);

  // Tell the speech layer whether a cloud TTS provider (Azure/Google/ElevenLabs) is configured on the server.
  useEffect(() => { if (user) api<{ provider: string }>("/tts/status").then((s) => setServerTts(s.provider)).catch(() => setServerTts("browser")); }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePrefs = useCallback(async (p: Partial<Prefs>) => {
    setUserState((u) => { if (!u) return u; const n = { ...u, prefs: { ...u.prefs, ...p } }; if (p.theme) applyTheme(n.prefs.theme); return n; });
    try { setUser(await api<User>("/me", { method: "PATCH", body: { prefs: p } })); }
    catch (e: any) { toast(e.message, "err"); }
  }, [setUser, toast]);

  const startGuest = useCallback(async () => {
    try {
      const d = await api<{ token: string; user: User }>("/auth/guest", { method: "POST", body: {} });
      setToken(d.token); setUser(d.user);
    } catch (e: any) { toast(e.message, "err"); }
  }, [setUser, toast]);

  const value = useMemo<Ctx>(() => ({
    user, loading, prefs: user?.prefs ?? FALLBACK, setUser, toast, logout, savePrefs, startGuest,
    login: (token, u) => { setToken(token); setUser(u); },
  }), [user, loading, setUser, toast, logout, savePrefs, startGuest]);

  return (
    <C.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="glass px-4 py-3 text-sm max-w-xs shadow-xl" style={{ borderColor: t.kind === "err" ? "#f87171" : undefined }}>{t.msg}</div>
        ))}
      </div>
    </C.Provider>
  );
}
