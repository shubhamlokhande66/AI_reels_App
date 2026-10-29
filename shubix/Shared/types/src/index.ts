/** Types shared by FE/web-app, FE/mobile-app and BE/api. */
export type SessionUser = { id: string; email: string; emailVerified: boolean; username: string | null };
export type MeResponse = { authEnabled: boolean; user: SessionUser | null };
/** `token` is only sent to the phone app (X-Client: mobile); the website gets an httpOnly cookie. */
export type AuthResponse = { user: SessionUser; token?: string };
export type OkResponse = { ok: true; wait?: number; email?: string; sent?: boolean; verified?: boolean };
/** Every API error, the same shape as the current server: { error: { code, message, details } } */
export type ApiErrorBody = { error: { code: string; message: string; details: unknown } };
export type PlanId = "free" | "creator" | "pro" | "business";
