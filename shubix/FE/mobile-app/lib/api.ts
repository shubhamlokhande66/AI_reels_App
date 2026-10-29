import * as FileSystem from "expo-file-system/legacy";
import { api, API_URL, TOKEN_KEY } from "./session";
import * as SecureStore from "expo-secure-store";

/** Every call goes to BE/api through the shared client (lib/session.ts, @shubix/api-client): the Bearer token from
 * secure storage, the app's error messages, the same logic as the website. */
const json = <T = unknown>(path: string, init?: RequestInit) => api.request<T>(path, init);

/** the spots with an ad (the same as the website's) */
export type AdPlace = "home" | "homeEnd" | "reels" | "rewards" | "account";
export type AdsConfig = { enabled: boolean; places: Record<AdPlace, boolean>; admob: { android: string; ios: string } };

export const mobileApi = {
  me: () => api.auth.me(),
  signIn: (email: string, password: string) => api.auth.login(email, password),
  signUp: (email: string, password: string) => api.auth.register(email, password),
  forgotPassword: (email: string) => api.auth.forgot(email),
  resetPassword: (email: string, code: string, password: string) => api.auth.reset(email, code, password),
  signOut: () => api.auth.logout(),
  reels: () => json<{ reels: { id: string; name: string; dur: number; thumb: string | null; createdAt: string }[]; usage?: unknown }>("/api/studio/reels"),
  deleteReel: (id: string) => json(`/api/studio/reels/${encodeURIComponent(id)}`, { method: "DELETE" }),
  templates: () => json<{ templates: { id: string; name: string; kind: string; group: string; text: string; cover?: string; plan?: string; on: boolean }[] }>("/api/templates"),
  pricing: () => json<{ currency: string; yearlyMonthsCharged: number; plans: { id: string; name: string; monthly: number; yearly: number; credits: number; tagline: string; highlight: boolean; features: string[]; hidden?: boolean; ads?: boolean }[]; topUps: { id: string; credits: number; price: number }[]; billingEnabled: boolean }>("/api/plans"),
  ads: () => json<AdsConfig>("/api/ads"),
  credits: () => json<{ enabled: boolean; balance?: number; planName?: string; plan?: string; extra?: number }>("/api/credits"),
  createOrder: (item: string, coupon?: string) => json<{ orderId: string; keyId: string; amount: number; currency: string; label: string; email: string }>("/api/billing/order", { method: "POST", body: JSON.stringify({ item, ...(coupon ? { coupon } : {}) }) }),
  verifyPayment: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) => json<{ enabled: boolean; balance?: number; plan?: string; planName?: string; monthly?: number; extra?: number }>("/api/billing/verify", { method: "POST", body: JSON.stringify(body) }),
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
  marketing: () => json<Record<string, any>>("/api/marketing"),
  setUsername: (username: string) => json("/api/marketing/username", { method: "POST", body: JSON.stringify({ username }) }),
  sendCredits: (to: string, amount: number, note?: string) => json("/api/marketing/send", { method: "POST", body: JSON.stringify({ to, amount, note }) }),
  changePassword: (currentPassword: string, newPassword: string) => api.auth.changePassword(currentPassword, newPassword),
  logoutEverywhere: () => api.auth.logoutEverywhere(),
  deleteAccount: (password: string, confirm: string) => json("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password, confirm }) }),
  contact: (body: { email: string; name?: string; topic: string; message: string }) => json<{ ok: boolean; ticket: string }>("/api/contact", { method: "POST", body: JSON.stringify(body) }),
  content: () => json<Record<string, any>>("/api/content"),
  absoluteAsset: (path: string) => path.startsWith("http") ? path : `${API_URL}${path}`,
  /** A saved Reel needs the sign-in token, which a video player cannot send: download it to the cache, play the copy. */
  downloadReel: async (id: string) => {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const r = await FileSystem.downloadAsync(`${API_URL}/api/studio/reels/${encodeURIComponent(id)}/file`, `${FileSystem.cacheDirectory}reel-${id}.mp4`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (r.status !== 200) throw new Error(`Could not open this Reel (${r.status}).`);
    return r.uri;
  },
};
