import type { ApiErrorBody, AuthResponse, MeResponse, OkResponse } from "@shubix/types";

/** One API client for the website and the phone app. The website sends the httpOnly cookie (credentials: include);
 * the phone app passes getToken/setToken (secure storage) and sends the token as Bearer. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public details: unknown = null) { super(message); }
}
export type ClientOptions = {
  baseUrl: string;
  getToken?: () => Promise<string | null> | string | null;
  setToken?: (token: string | null) => Promise<void> | void;
  mobile?: boolean;
};
export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function createApiClient(o: ClientOptions) {
  const base = o.baseUrl.replace(/\/$/, "");
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (typeof init.body === "string" && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (o.mobile) headers.set("X-Client", "mobile");
    const token = await o.getToken?.();
    if (token) headers.set("Authorization", `Bearer ${token}`);
    let r: Response;
    try { r = await fetch(base + path, { ...init, headers, credentials: "include" }); }
    catch { throw new ApiError("Cannot reach the server. Check your connection.", 0, "NETWORK"); }
    const data = r.status === 204 ? null : await r.json().catch(() => null);
    if (!r.ok) { const e = (data as ApiErrorBody | null)?.error; throw new ApiError(e?.message ?? `Request failed (${r.status})`, r.status, e?.code ?? "HTTP_" + r.status, e?.details); }
    return data as T;
  }
  const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
  /** a sign-in answer: keep the phone app's token */
  const keep = async (r: AuthResponse) => { if (r.token) await o.setToken?.(r.token); return r; };

  return {
    request,
    auth: {
      me: () => request<MeResponse>("/api/auth/me"),
      login: (email: string, password: string) => post<AuthResponse & { adminCode?: boolean }>("/api/auth/login", { email, password }).then(keep),
      register: (email: string, password: string, ref?: string) => post<AuthResponse>("/api/auth/register", { email, password, ...(ref ? { ref } : {}) }).then(keep),
      verify: (code: string) => post<OkResponse>("/api/auth/verify", { code }),
      resendVerify: () => post<OkResponse>("/api/auth/verify/resend"),
      forgot: (email: string) => post<OkResponse>("/api/auth/forgot", { email }),
      reset: (email: string, code: string, password: string) => post<AuthResponse>("/api/auth/reset", { email, code, password }).then(keep),
      changePassword: (currentPassword: string, newPassword: string) => post<OkResponse & { token?: string }>("/api/auth/password", { currentPassword, newPassword }).then(async (r) => { if (r.token) await o.setToken?.(r.token); return r; }),
      logoutEverywhere: () => post<OkResponse & { token?: string }>("/api/auth/logout-everywhere").then(async (r) => { if (r.token) await o.setToken?.(r.token); return r; }),
      deleteAccount: (password: string, confirm: string) => post<OkResponse>("/api/auth/delete-account", { password, confirm }).then(async (r) => { await o.setToken?.(null); return r; }),
      logout: async () => { try { await post<OkResponse>("/api/auth/logout"); } finally { await o.setToken?.(null); } },
    },
    texts: () => request<Record<string, string>>("/api/texts"),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
