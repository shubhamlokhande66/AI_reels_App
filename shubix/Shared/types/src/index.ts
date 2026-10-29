/** Types shared by FE/web-app, FE/mobile-app and BE/api. */
export type SessionUser = { id: string; email: string; emailVerified: boolean; username: string | null };
export type MeResponse = { authEnabled: boolean; user: SessionUser | null };
/** `token` is only sent to the phone app (X-Client: mobile); the website gets an httpOnly cookie. */
export type AuthResponse = { user: SessionUser; token?: string };
export type OkResponse = { ok: true; wait?: number; email?: string; sent?: boolean; verified?: boolean };
/** Every API error, the same shape as the current server: { error: { code, message, details } } */
export type ApiErrorBody = { error: { code: string; message: string; details: unknown } };
export type PlanId = "free" | "creator" | "pro" | "business";

/** A finished Reel kept in the account (My Reels → Saved), and the account's room for them. */
export type CloudReel = {
  id: string; name: string; size: number; type: string; dur: number; width: number; height: number; fps: number;
  thumb: string | null; createdAt: string; shared: boolean; shareUrl: string | null;
};
export type CloudUsage = { used: number; limit: number; plan: string; cloud: boolean; keepDays?: number };
