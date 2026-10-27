import { viaBoot } from "@/lib/boot";
import type { Features } from "@/lib/features-list";
import { tracked } from "./activity";
import { adminHeaders } from "./admin";

/** Admin → Settings → Administrators: owner = set on the server (ADMIN_EMAILS), not removable here */
export interface AdminList { admins: { email: string; owner: boolean }[]; keySet: boolean }

/** Administration: how the Fast Studio AI director did in the last days (server/studio/brain.ts report) */
export interface AiDirectorReport {
  days: number; plans: number; paces: number; mixes: number; failed: number; cuts: number; creators: number; avgSeconds: number | null;
  choices: { transitions: number; effects: number; keys: number };
  changed: { transitions: number; effects: number; speeds: number };
  changeRate: { transitions: number | null; effects: number | null };
}
import type {
  AdminOverview,
  AdminUserDetail,
  AdminUserRow,
  ApiErrorBody,
  Health,
  Media,
  Brand,
  LearnedTrend,
  StyleSuggestion,
  AiModels,
  ModelTestResult,
  AiConfig,
  AiConfigInput,
  AiProviderId,
  AiProviderModels,
  AiTestResult,
  AiUsage,
  Song,
  BrandInput,
  SystemVoices,
  VoiceProfile,
  VoiceProfileInput,
  CheckoutOrder,
  Credits,
  Pricing,
  SiteInfo,
} from "@/types/api";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * The API address. It is configured as http://localhost:8000, which is right on the computer running the app but
 * wrong from a phone (there, "localhost" is the phone itself). When the page was opened through the computer's
 * network address, use that same address for the API.
 */
export function resolveApiUrl(configured: string, pageHostname?: string): string {
  const base = configured.replace(/\/$/, "");
  if (!pageHostname || LOCAL_HOSTS.has(pageHostname)) return base;
  try {
    const u = new URL(base);
    if (!LOCAL_HOSTS.has(u.hostname)) return base; // an explicitly configured remote API is respected
    u.hostname = pageHostname;
    return u.toString().replace(/\/$/, "");
  } catch {
    return base;
  }
}

// The API is this same Next.js server ("" = same origin; it passes paths not moved yet on to Python, next.config.ts).
// NEXT_PUBLIC_API_URL still points the app at another API when set.
export const API_URL = resolveApiUrl(
  process.env.NEXT_PUBLIC_API_URL ?? "",
  typeof window === "undefined" ? undefined : window.location.hostname,
);

/** Error thrown for every failed API call; carries the backend's structured error. */
export class ApiError extends Error {
  code: string;
  details?: unknown;
  status: number;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return path.startsWith("http") ? path : `${API_URL}${path}`;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    if (data?.error?.message) return new ApiError(res.status, data.error);
  } catch {
    /* fall through */
  }
  return new ApiError(res.status, { code: "HTTP_ERROR", message: `Request failed (${res.status}).` });
}

/** No request may hang forever: without an answer in time it fails with a clear message (the server may be down). */
const DEFAULT_TIMEOUT_MS = 45_000;

/** A read that timed out or lost the connection is asked again this many times (a busy server usually answers the next one). */
const GET_RETRIES = 3;
const RETRYABLE = new Set(["SERVER_TIMEOUT", "NETWORK_ERROR"]);

async function request<T>(path: string, init?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" ? readWithRetry<T>(path, init, timeoutMs) : tracked(send<T>(path, init, timeoutMs)); // actions light up the activity bar
}

/** Reads change nothing on the server, so they are safe to repeat: a slow or dropped one is retried before it is an error. */
async function readWithRetry<T>(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send<T>(path, init, timeoutMs);
    } catch (e) {
      const retryable = e instanceof ApiError && RETRYABLE.has(e.code) && !init?.signal?.aborted;
      if (!retryable || attempt >= GET_RETRIES) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt)); // 1 s, 2 s, 4 s
    }
  }
}

async function send<T>(path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: init?.signal ?? ctrl.signal,
      credentials: "include", // the session cookie (accounts on)
      headers: { ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}), ...adminHeaders(), ...init?.headers },
    });
  } catch {
    clearTimeout(timer);
    if (ctrl.signal.aborted) {
      throw new ApiError(0, {
        code: "SERVER_TIMEOUT",
        message: `The server did not answer within ${Math.round(timeoutMs / 1000)} seconds. It may be busy or restarting: wait a moment and try again.`,
      });
    }
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Cannot reach the server. Is the backend running?",
    });
  }
  clearTimeout(timer);
  if (!res.ok) {
    const err = await parseError(res);
    // out of credits: the app shows "Top up or choose a plan" wherever it happened
    if (err.code === "INSUFFICIENT_CREDITS" && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("credits:needed", { detail: err.message }));
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Multipart upload with progress (fetch has no upload progress events). */
function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return tracked(new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}${path}`);
    xhr.withCredentials = true; // the session cookie (accounts on)
    for (const [k, v] of Object.entries(adminHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () =>
      reject(new ApiError(0, { code: "NETWORK_ERROR", message: "Cannot reach the server. Is the backend running?" }));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as T);
      const err = (body as { error?: ApiErrorBody } | null)?.error;
      reject(new ApiError(xhr.status, err ?? { code: "HTTP_ERROR", message: `Upload failed (${xhr.status}).` }));
    };
    xhr.send(form);
  }));
}

export interface UploadResult {
  uploaded: Media[];
  failed: { name: string; error: ApiErrorBody }[];
}

/** Ads (Admin → Settings → Ads): on or off, the pages with an ad spot, and the Google AdSense ids. */
export type AdPlace = "home" | "homeEnd" | "reels" | "rewards" | "account";
export type AdsConfig = { enabled: boolean; client: string; slot: string; places: Record<AdPlace, boolean> };
export const api = {
  health: () => request<Health>("/api/health"),
  me: () => viaBoot("me", () => request<{ authEnabled: boolean; user: { id: string; email: string; emailVerified?: boolean; iosApp?: boolean } | null }>("/api/auth/me")),
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string, ref?: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password, ...(ref ? { ref } : {}) }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  verifyCode: (code: string) => request<{ ok: boolean; email: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ code }) }),
  resetWithCode: (email: string, code: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ email, code, password }) }),
  verifyEmail: (token: string) => request<{ ok: boolean; email: string }>("/api/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  resendVerify: () => request<{ ok: boolean; sent?: boolean; verified?: boolean; wait?: number }>("/api/auth/verify/resend", { method: "POST" }),
  forgotPassword: (email: string) => request<{ ok: boolean; wait?: number }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  logoutEverywhere: () => request<{ ok: boolean }>("/api/auth/logout-everywhere", { method: "POST" }),
  deleteAccount: (password: string, confirm: string) =>
    request<{ ok: boolean }>("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password, confirm }) }),
  site: () => viaBoot("site", () => request<SiteInfo>("/api/site")),
  /** Is this browser in admin mode? (required = the server has an admin key; without one everyone is admin) */
  adminSession: (key?: string) => {
    const ask = () => request<{ admin: boolean; required: boolean }>("/api/admin/session", key ? { headers: { "X-Admin-Key": key } } : undefined);
    return key ? ask() : viaBoot("admin", ask); // signing in with a key always asks the server
  },
  plans: () => request<Pricing>("/api/plans"),
  credits: () => viaBoot("credits", () => request<Credits>("/api/credits")),
  createOrder: (item: string, coupon?: string) => request<CheckoutOrder>("/api/billing/order", { method: "POST", body: JSON.stringify({ item, ...(coupon ? { coupon } : {}) }) }),
  quote: (item: string, coupon?: string) => request<import("@/lib/marketing").Quote>("/api/billing/quote", { method: "POST", body: JSON.stringify({ item, ...(coupon ? { coupon } : {}) }) }),
  offer: () => viaBoot("offer", () => request<{ offer: import("@/lib/marketing").Offer | null }>("/api/offer")),
  // Invite & earn
  myMarketing: () => request<import("@/lib/marketing").MyMarketing>("/api/marketing"),
  setUsername: (username: string) => request<{ username: string }>("/api/marketing/username", { method: "POST", body: JSON.stringify({ username }) }),
  sendCredits: (to: string, amount: number, note?: string) => request<{ ok: boolean; sent: number; to: string; balance: number }>("/api/marketing/send", { method: "POST", body: JSON.stringify({ to, amount, note }) }),
  payments: () => request<{ id: string; label: string; amount: number; status: string; createdAt: string; paidAt: string | null; receiptNo: string | null; paymentId: string | null }[]>("/api/billing/payments"),
  // support: the Contact page, the Help chat, Admin → Support
  contact: (d: { email: string; name?: string; topic: string; message: string; page?: string; website?: string }) =>
    request<{ ok: boolean; ticket: string }>("/api/contact", { method: "POST", body: JSON.stringify(d) }),
  helpOn: () => request<{ on: boolean }>("/api/help"),
  help: (messages: { role: "user" | "assistant"; content: string }[], page = "") =>
    // quiet (no "Working…" pill over the chat): the chat shows its own typing dots
    send<{ answer: string; needsHuman: boolean; suggestions: string[] }>("/api/help", { method: "POST", body: JSON.stringify({ messages, page }) }, 60_000),
  adminSupport: (status: "open" | "done" | "all") => request<{
    settings: { chat: boolean; autoReply: boolean }; open: number;
    messages: { id: string; email: string; name: string; topic: string; message: string; page: string; status: string; at: string; account: { email: string; username: string | null; plan: string } | null }[];
    questions: { q: string; needsHuman: boolean; at: string; signedIn: boolean }[];
  }>(`/api/admin/support?status=${status}`),
  setSupport: (d: { chat?: boolean; autoReply?: boolean }) => request<{ chat: boolean; autoReply: boolean }>("/api/admin/support", { method: "PUT", body: JSON.stringify(d) }),
  setSupportStatus: (id: string, status: "open" | "done") => request<{ ok: boolean }>("/api/admin/support", { method: "POST", body: JSON.stringify({ id, status }) }),
  myAffiliate: () => request<{ affiliate: import("@/lib/marketing").AffiliateDetail | null }>("/api/marketing/affiliate/dashboard"),
  affiliate: (id: string) => request<import("@/lib/marketing").AffiliateDetail>(`/api/admin/affiliates/${encodeURIComponent(id)}`),
  setPayout: (d: import("@/lib/marketing").PayoutInput) => request<{ ok: boolean }>("/api/marketing/affiliate/payout", { method: "PUT", body: JSON.stringify(d) }),
  applyAffiliate: () => request<{ ok: boolean }>("/api/marketing/affiliate", { method: "POST" }),
  // the partner dashboard (/affiliate): signed in to Shubix, or by an emailed code (a partner-only session)
  partnerMe: () => request<import("@/lib/marketing").PartnerMe>("/api/partner/me"),
  partnerCode: (email: string) => request<{ ok: boolean; wait: number }>("/api/partner/code", { method: "POST", body: JSON.stringify({ email }) }),
  partnerVerify: (email: string, code: string) => request<{ ok: boolean }>("/api/partner/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  partnerApply: (note: string) => request<{ ok: boolean }>("/api/partner/apply", { method: "POST", body: JSON.stringify({ note }) }),
  partnerPayout: (d: import("@/lib/marketing").PayoutInput) => request<{ ok: boolean }>("/api/partner/payout", { method: "PUT", body: JSON.stringify(d) }),
  partnerLogout: () => request<{ ok: boolean }>("/api/partner/logout", { method: "POST" }),
  // Admin → Marketing
  adminMarketing: () => request<{ settings: import("@/lib/marketing").MarketingSettings; report: import("@/lib/marketing").MarketingReport }>("/api/admin/marketing"),
  setMarketing: (s: import("@/lib/marketing").MarketingSettings) => request<{ settings: import("@/lib/marketing").MarketingSettings }>("/api/admin/marketing", { method: "PUT", body: JSON.stringify(s) }),
  coupons: () => request<{ coupons: import("@/lib/marketing").Coupon[] }>("/api/admin/coupons"),
  saveCoupon: (c: Omit<import("@/lib/marketing").Coupon, "uses" | "live">) => request<{ ok: boolean; code: string }>("/api/admin/coupons", { method: "PUT", body: JSON.stringify(c) }),
  deleteCoupon: (code: string) => request<{ ok: boolean }>(`/api/admin/coupons?code=${encodeURIComponent(code)}`, { method: "DELETE", headers: adminHeaders() }),
  offers: () => request<{ offers: import("@/lib/marketing").AdminOffer[] }>("/api/admin/offers"),
  saveOffer: (o: Partial<import("@/lib/marketing").AdminOffer>) => request<{ ok: boolean; id: string }>("/api/admin/offers", { method: "PUT", body: JSON.stringify(o) }),
  deleteOffer: (id: string) => request<{ ok: boolean }>(`/api/admin/offers?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: adminHeaders() }),
  admins: () => request<AdminList>("/api/admin/admins"),
  addAdmin: (email: string) => request<AdminList>("/api/admin/admins", { method: "POST", body: JSON.stringify({ email }) }),
  removeAdmin: (email: string) => request<AdminList>("/api/admin/admins", { method: "DELETE", body: JSON.stringify({ email }) }),
  affiliates: () => request<{ affiliates: import("@/lib/marketing").Affiliate[] }>("/api/admin/affiliates"),
  updateAffiliate: (d: { id: string; status?: string; percent?: number; months?: number; validUntil?: string | null }) => request<{ ok: boolean }>("/api/admin/affiliates", { method: "PUT", body: JSON.stringify(d) }),
  payAffiliate: (id: string, note: string) => request<{ ok: boolean; total: number }>("/api/admin/affiliates", { method: "POST", body: JSON.stringify({ id, note }) }),
  verifyPayment: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    request<Credits>("/api/billing/verify", { method: "POST", body: JSON.stringify(body) }),
  templates: () => request<{ templates: import("@/lib/studio-templates").StudioTemplate[] }>("/api/templates"),
  adminTemplates: () => request<{ templates: import("@/lib/studio-templates").StudioTemplate[]; saved: boolean; updatedAt?: string }>("/api/templates?all=1"),
  setTemplates: (templates: import("@/lib/studio-templates").StudioTemplate[]) => request<{ templates: import("@/lib/studio-templates").StudioTemplate[]; saved: boolean; updatedAt?: string }>("/api/templates", { method: "PUT", body: JSON.stringify({ templates }) }),
  resetTemplates: () => request<{ templates: import("@/lib/studio-templates").StudioTemplate[]; saved: boolean }>("/api/templates", { method: "DELETE" }),
  reelsKeep: () => request<{ days: Record<string, number>; limits: Record<string, number> }>("/api/admin/reels-keep"),
  setReelsKeep: (days: Record<string, number>) => request<{ days: Record<string, number>; limits: Record<string, number> }>("/api/admin/reels-keep", { method: "PUT", body: JSON.stringify(days) }),
  planLocks: () => viaBoot("planLocks", () => request<import("@/lib/plan-locks").PlanLocks>("/api/plan-locks")),
  setPlanLocks: (body: import("@/lib/plan-locks").LockOverrides) => request<import("@/lib/plan-locks").PlanLocks>("/api/plan-locks", { method: "PUT", body: JSON.stringify(body) }),
  adminErrors: () => request<{ errors: { id: string; kind: string; message: string; where: string; count: number; firstAt: string; lastAt: string; path: string; ua: string; stack: string }[] }>("/api/admin/errors"),
  clearAdminError: (id: string) => request<{ ok: boolean }>("/api/admin/errors", { method: "DELETE", body: JSON.stringify({ id }) }),
  setPricing: (body: { plans: { id: string; name?: string; monthly: number; credits: number; freeChats?: number; highlight?: boolean; ai?: boolean; ads?: boolean; hidden?: boolean; features?: string[] }[]; topUps: { id: string; credits: number; price: number }[]; costs: Record<string, number> }) =>
    request<Pricing>("/api/admin/pricing", { method: "PUT", body: JSON.stringify(body) }),
  /** The administrator's texts (Admin → CMS; lib/texts.ts has the defaults). */
  texts: () => viaBoot("texts", () => request<import("@/lib/texts").Texts>("/api/texts")),
  setTexts: (patch: Record<string, string | null>) => request<import("@/lib/texts").Texts>("/api/admin/texts", { method: "PUT", body: JSON.stringify(patch) }),
  /** Admin → Settings → Business details (empty fields: the server's environment). */
  setSite: (patch: Partial<SiteInfo>) => request<SiteInfo>("/api/admin/site", { method: "PUT", body: JSON.stringify(patch) }),
  /** The administrator's lists (Admin → CMS; lib/collections.ts has the first items). */
  content: () => request<import("@/lib/collections").Content>("/api/content"),
  setContent: (patch: Record<string, import("@/lib/collections").ListItem[] | null>) => request<import("@/lib/collections").Content>("/api/admin/content", { method: "PUT", body: JSON.stringify(patch) }),
  /** Which parts of the app are on (Administration → Features). */
  features: () => viaBoot("features", () => request<Features>("/api/features")),
  aiDirectorReport: () => request<AiDirectorReport>("/api/admin/ai-director"),
  setFeatures: (patch: Partial<Features>) => request<Features>("/api/admin/features", { method: "PUT", body: JSON.stringify(patch) }),
  adminOverview: () => request<AdminOverview>("/api/admin/overview"),
  adminUsers: () => request<AdminUserRow[]>("/api/admin/users"),
  adminUser: (id: string) => request<AdminUserDetail>(`/api/admin/users/${id}`),
  ads: () => request<AdsConfig>("/api/ads"),
  setAds: (b: Partial<AdsConfig>) => request<AdsConfig>("/api/admin/ads", { method: "PUT", body: JSON.stringify(b) }),
  /** Admin: a plan by hand (Free, or a paid plan for 1 or 12 months with its credits) */
  adminSetPlan: (id: string, plan: string, months: number) => request<unknown>(`/api/admin/users/${id}/plan`, { method: "POST", body: JSON.stringify({ plan, months }) }),
  adminGiveCredits: (id: string, credits: number, note: string) =>
    request<AdminUserDetail>(`/api/admin/users/${id}/credits`, { method: "POST", body: JSON.stringify({ credits, note }) }),
  /** This tab is still open (the admin dashboard's "online now"); quiet: no activity bar, no retries. */
  ping: (visitor: string, path: string, app = false) => send<{ ok: boolean }>("/api/public/ping", { method: "POST", body: JSON.stringify({ visitor, path, app }) }, 10_000),
  aiModels: () => request<AiModels>("/api/ai/models"),
  chooseModel: (model: string | null) => request<AiModels>("/api/ai/model", { method: "PUT", body: JSON.stringify({ model }) }),
  testModel: (model: string) => request<ModelTestResult>("/api/ai/models/test", { method: "POST", body: JSON.stringify({ model }) }),
  aiConfig: () => request<AiConfig>("/api/ai/config"),
  saveAiConfig: (body: AiConfigInput) => request<AiConfig>("/api/ai/config", { method: "PUT", body: JSON.stringify(body) }),
  aiProviderModels: (provider: AiProviderId) => request<AiProviderModels>(`/api/ai/providers/${provider}/models`),
  testAi: (provider?: AiProviderId, vision = false) =>
    request<AiTestResult>("/api/ai/test", { method: "POST", body: JSON.stringify({ provider, vision }) }),
  aiUsage: () => request<AiUsage>("/api/ai/usage"),
  /** The song's audio as a File, so every existing "song file" flow (waveform, upload) works unchanged. */
  songFile: async (song: Song): Promise<File> => {
    const res = await fetch(assetUrl(song.url) as string);
    if (!res.ok) throw await parseError(res);
    const blob = await res.blob();
    const ext = (blob.type.split("/")[1] ?? "mp3").replace("mpeg", "mp3").replace("x-wav", "wav");
    return new File([blob], `${song.name}.${ext}`, { type: blob.type || "audio/mpeg" });
  },
  // --- voices + script ---
  systemVoices: () => request<SystemVoices>("/api/voices/system"),
  voices: () => request<VoiceProfile[]>("/api/voices"),
  createVoice: (v: VoiceProfileInput) => request<VoiceProfile>("/api/voices", { method: "POST", body: JSON.stringify(v) }),
  updateVoice: (id: string, v: VoiceProfileInput) => request<VoiceProfile>(`/api/voices/${id}`, { method: "PATCH", body: JSON.stringify(v) }),
  deleteVoice: (id: string) => request<void>(`/api/voices/${id}`, { method: "DELETE" }),
  previewVoice: async (id: string, text?: string): Promise<Blob> => {
    const res = await fetch(`${API_URL}/api/voices/${id}/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch(() => {
      throw new ApiError(0, { code: "NETWORK_ERROR", message: "Cannot reach the server. Is the backend running?" });
    });
    if (!res.ok) throw await parseError(res);
    return res.blob();
  },
  // --- my trends (learned from reference Reels) ---
  references: () => request<LearnedTrend[]>("/api/references"),
  createReference: (name: string, notes: string, files: File[], onProgress?: (f: number) => void) => {
    const form = new FormData();
    form.append("name", name);
    form.append("notes", notes);
    files.forEach((f) => form.append("files", f));
    return upload<LearnedTrend>("/api/references", form, onProgress);
  },
  addReferenceVideos: (id: string, files: File[], onProgress?: (f: number) => void) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return upload<LearnedTrend>(`/api/references/${id}/videos`, form, onProgress);
  },
  updateReference: (id: string, patch: { name?: string; notes?: string }) =>
    request<LearnedTrend>(`/api/references/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  removeReferenceVideo: (id: string, index: number) => request<LearnedTrend>(`/api/references/${id}/videos/${index}`, { method: "DELETE" }),
  deleteReference: (id: string) => request<void>(`/api/references/${id}`, { method: "DELETE" }),
  // admin: Reels creators copied, waiting to teach the styles
  styleSuggestions: () => request<{ items: StyleSuggestion[]; total: number }>("/api/admin/style-suggestions"),
  useStyleSuggestion: (id: string, category: string) =>
    request<{ id: string }>("/api/admin/style-suggestions", { method: "POST", body: JSON.stringify({ id, category }) }),
  removeStyleSuggestion: (id: string) => request<{ ok: boolean }>("/api/admin/style-suggestions", { method: "DELETE", body: JSON.stringify({ id }) }),

  // --- brands + templates ---
  brands: () => request<Brand[]>("/api/brands"),
  createBrand: (b: BrandInput) => request<Brand>("/api/brands", { method: "POST", body: JSON.stringify(b) }),
  updateBrand: (id: string, b: BrandInput) => request<Brand>(`/api/brands/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  deleteBrand: (id: string) => request<void>(`/api/brands/${id}`, { method: "DELETE" }),
  uploadLogo: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<Brand>(`/api/brands/${id}/logo`, form);
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
