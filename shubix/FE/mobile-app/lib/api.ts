import { api, API_URL } from "./session";
import { fetchWithToken, tokenStore } from "./device";
import type { StudioTemplate } from "@mobile/core/lib/studio-templates";
import type { Features } from "@mobile/core/lib/features-list";
import type { Content } from "@mobile/core/lib/collections";
import type { CloudReel, CloudUsage, Credits, MyMarketing, Pricing } from "@mobile/types";
import type { PlanLocks } from "@mobile/core/lib/plan-locks";

/** Every call goes to BE/api through the shared client (lib/session.ts, @mobile/api-client): the Bearer token from
 * secure storage, the app's error messages, the same logic as the website. */
const USER_ONLY = ["/api/credits", "/api/notifications", "/api/studio/reels", "/api/ads", "/api/templates", "/api/marketing", "/api/brands", "/api/voices"];
const json = async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
  if ((init?.method ?? "GET").toUpperCase() === "GET" && USER_ONLY.includes(path.split("?")[0]) && !(await tokenStore.get().catch(() => null)))
    throw Object.assign(new Error("Please sign in."), { status: 401, code: "AUTH_REQUIRED" });
  return api.request<T>(path, init);
};

/** the spots with an ad (the same as the website's) */
export type AdPlace = "home" | "homeEnd" | "reels" | "rewards" | "account";
export type AdsConfig = { enabled: boolean; places: Record<AdPlace, boolean>; admob: { android: string; ios: string; interstitial?: string; rewarded?: string; rewardCredits?: number; rewardDaily?: number } };

/** One of the administrator's messages (Admin → Messages: the bell) */
export interface Notice { id: string; title: string; body: string; link: string; button: string; at: string; unread: boolean }

export const mobileApi = {
  me: () => api.auth.me(),
  signIn: (email: string, password: string) => api.auth.login(email, password),
  signUp: (email: string, password: string) => api.auth.register(email, password),
  forgotPassword: (email: string) => api.auth.forgot(email),
  resetPassword: (email: string, code: string, password: string) => api.auth.reset(email, code, password),
  signOut: () => api.auth.logout(),
  reels: () => json<{ reels: CloudReel[]; usage: CloudUsage }>("/api/studio/reels"),
  shareReel: (id: string, on: boolean) => json<CloudReel>(`/api/studio/reels/${encodeURIComponent(id)}/share`, { method: "POST", body: JSON.stringify({ on }) }),
  deleteReel: (id: string) => json(`/api/studio/reels/${encodeURIComponent(id)}`, { method: "DELETE" }),
  notifications: () => json<{ items: Notice[]; unread: number }>("/api/notifications"),
  readNotifications: () => json<{ ok: boolean }>("/api/notifications", { method: "POST" }),
  templates: () => json<{ templates: StudioTemplate[] }>("/api/templates"),
  features: () => json<Features>("/api/features"),
  /** the Help chat (Admin → Support turns it on): whether it is on, and an answer to the conversation so far */
  helpOn: () => json<{ on: boolean }>("/api/help"),
  help: (messages: { role: "user" | "assistant"; content: string }[], page = "") => json<{ answer: string; needsHuman: boolean; suggestions: string[] }>("/api/help", { method: "POST", body: JSON.stringify({ messages, page }) }),
  /** the business details (Admin → Settings → Business details) */
  site: () => json<{ businessName: string; supportEmail: string; supportPhone: string; businessAddress: string; playStoreUrl: string; appStoreUrl: string }>("/api/site"),
  pricing: () => json<Pricing>("/api/plans"),
  ads: () => json<AdsConfig>("/api/ads"),
  /** an administrator's account (admin: its code entered today; otp: the code is still to come) */
  adminSession: () => json<{ admin: boolean; otp?: boolean }>("/api/admin/session"),
  credits: () => json<Credits>("/api/credits"),
  planLocks: () => json<PlanLocks>("/api/plan-locks"),
  brands: () => json<Record<string, unknown>[]>("/api/brands"),
  createBrand: (body: Record<string, unknown>) => json<Record<string, unknown>>("/api/brands", { method: "POST", body: JSON.stringify(body) }),
  deleteBrand: (id: string) => json<void>(`/api/brands/${encodeURIComponent(id)}`, { method: "DELETE" }),
  voices: () => json<{ id: string; name: string; voice: string | null; language: string; speed: number; pitch: number; energy: string; emotion: string; pauseStyle: string }[]>("/api/voices"),
  createVoice: (body: Record<string, unknown>) => json<Record<string, unknown>>("/api/voices", { method: "POST", body: JSON.stringify(body) }),
  deleteVoice: (id: string) => json<void>(`/api/voices/${encodeURIComponent(id)}`, { method: "DELETE" }),
  references: () => json<{ id: string; name: string; notes: string; videos: unknown[]; profile?: Record<string, unknown>; createdAt?: string }[]>("/api/references"),
  createReference: async (name: string, notes: string, asset: { uri: string; fileName?: string | null; mimeType?: string | null }) => {
    const data = new FormData(); data.append("name", name); data.append("notes", notes);
    data.append("files", { uri: asset.uri, name: asset.fileName || "reference.mp4", type: asset.mimeType || "video/mp4" } as unknown as Blob);
    return json<Record<string, unknown>>("/api/references", { method: "POST", body: data });
  },
  deleteReference: (id: string) => json<void>(`/api/references/${encodeURIComponent(id)}`, { method: "DELETE" }),
  marketing: () => json<MyMarketing>("/api/marketing"),
  setUsername: (username: string) => json("/api/marketing/username", { method: "POST", body: JSON.stringify({ username }) }),
  sendCredits: (to: string, amount: number, note?: string) => json<{ ok: boolean; sent: number; to: string; balance: number }>("/api/marketing/send", { method: "POST", body: JSON.stringify({ to, amount, note }) }),
  changePassword: (currentPassword: string, newPassword: string) => api.auth.changePassword(currentPassword, newPassword),
  logoutEverywhere: () => api.auth.logoutEverywhere(),
  deleteAccount: (password: string, confirm: string) => json("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password, confirm }) }),
  contact: (body: { email: string; name?: string; topic: string; message: string; website?: string }) => json<{ ok: boolean; ticket: string }>("/api/contact", { method: "POST", body: JSON.stringify(body) }),
  content: () => json<Content>("/api/content"),
  absoluteAsset: (path: string) => path.startsWith("http") ? path : `${API_URL}${path}`,
  /** A saved Reel needs the sign-in token, which a video player cannot send: a copy to play (device.ts). */
  downloadReel: (id: string) => fetchWithToken(`${API_URL}/api/studio/reels/${encodeURIComponent(id)}/file`, `reel-${id}.mp4`),
};
