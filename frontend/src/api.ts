const KEY = "lumetra.token";
export const getToken = () => localStorage.getItem(KEY);
export const setToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** POST JSON, get binary (audio) back. */
export async function apiBlob(path: string, body: unknown): Promise<Blob> {
  const t = getToken();
  const res = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(body) });
  if (!res.ok) throw new ApiError(res.status, `Speech request failed (${res.status})`);
  return res.blob();
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (opts.body) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (opts.body || opts.form ? "POST" : "GET"), headers, body: opts.form ?? (opts.body ? JSON.stringify(opts.body) : undefined) });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Is the backend running on port 8000?");
  }
  if (res.status === 401 && t) { setToken(null); window.dispatchEvent(new Event("lumetra:logout")); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data.detail;
    throw new ApiError(res.status, typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join("; ") : `Request failed (${res.status})`);
  }
  return data as T;
}
