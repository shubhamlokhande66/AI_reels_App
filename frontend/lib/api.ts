import { tracked } from "./activity";
import { adminHeaders } from "./admin";
import type {
  ApiErrorBody,
  DirectorProfile,
  FeedbackReason,
  GenerateOptions,
  Health,
  Job,
  Media,
  Project,
  ProjectSettings,
  ProjectStatus,
  ProjectSummary,
  SongParts,
  Rendering,
  StyleInfo,
  TrendPreset,
  ExportPreset,
  QualityReport,
  QueueItem,
  TimelineState,
  Brand,
  LearnedTrend,
  PerformanceInput,
  ProductPlan,
  ProductRequest,
  ProductStyleInfo,
  AiModels,
  ModelTestResult,
  AiConfig,
  AiConfigInput,
  AiProviderId,
  AiProviderModels,
  AiTestResult,
  AiUsage,
  Song,
  SongList,
  ReviseResult,
  ChatMessage,
  ChatFile,
  BrandInput,
  Dashboard,
  Insights,
  LibraryResult,
  Script,
  Strategy,
  SystemVoices,
  Template,
  TemplateInput,
  VoiceProfile,
  VoiceProfileInput, Connections, Platform, Post, CheckoutOrder, Credits, Pricing, ReferenceReelInfo, SiteInfo, Retention, Story, StoryOptions } from "@/types/api";

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

export const API_URL = resolveApiUrl(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
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
const AI_TIMEOUT_MS = 240_000; // story planning / a scene picture: one AI call, can take a minute or two

async function request<T>(path: string, init?: RequestInit, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  return method === "GET" ? send<T>(path, init, timeoutMs) : tracked(send<T>(path, init, timeoutMs)); // actions light up the activity bar
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

export const api = {
  health: () => request<Health>("/api/health"),
  me: () => request<{ authEnabled: boolean; user: { id: string; email: string } | null }>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  forgotPassword: (email: string) => request<{ ok: boolean }>("/api/auth/forgot", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/api/auth/reset", { method: "POST", body: JSON.stringify({ token, password }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>("/api/auth/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),
  logoutEverywhere: () => request<{ ok: boolean }>("/api/auth/logout-everywhere", { method: "POST" }),
  deleteAccount: (password: string, confirm: string) =>
    request<{ ok: boolean }>("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password, confirm }) }),
  site: () => request<SiteInfo>("/api/site"),
  /** Is this browser in admin mode? (required = the server has an admin key; without one everyone is admin) */
  adminSession: (key?: string) =>
    request<{ admin: boolean; required: boolean }>("/api/admin/session", key ? { headers: { "X-Admin-Key": key } } : undefined),
  styles: () => request<StyleInfo[]>("/api/styles"),
  trends: () => request<TrendPreset[]>("/api/trends"),

  listProjects: (status?: ProjectStatus) =>
    request<ProjectSummary[]>(`/api/projects${status ? `?status=${status}` : ""}`),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  createProject: (name: string, settings: Partial<ProjectSettings>) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify({ name, settings }) }),
  updateProject: (id: string, patch: Partial<ProjectSettings> & { name?: string }) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  feedback: (id: string, verdict: "accepted" | "rejected", reason?: FeedbackReason, renderingId?: string) =>
    request<DirectorProfile>(`/api/projects/${id}/feedback`, { method: "POST", body: JSON.stringify({ verdict, reason, renderingId }) }),
  purgeMedia: (id: string) => request<{ deleted: number }>(`/api/projects/${id}/purge-media`, { method: "POST" }),
  directorProfile: () => request<DirectorProfile>("/api/director/profile"),
  setDirectorProfile: (enabled: boolean) => request<DirectorProfile>("/api/director/profile", { method: "PUT", body: JSON.stringify({ enabled }) }),
  resetDirectorProfile: () => request<DirectorProfile>("/api/director/profile", { method: "DELETE" }),

  uploadVideos: (id: string, files: File[], onProgress?: (f: number) => void) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return upload<UploadResult>(`/api/projects/${id}/videos`, form, onProgress);
  },
  uploadAudio: (id: string, file: File, onProgress?: (f: number) => void) => {
    const form = new FormData();
    form.append("file", file);
    return upload<Media>(`/api/projects/${id}/audio`, form, onProgress);
  },
  deleteVideo: (id: string, mediaId: string) =>
    request<void>(`/api/projects/${id}/videos/${mediaId}`, { method: "DELETE" }),
  reorderVideos: (id: string, ids: string[]) =>
    request<Project>(`/api/projects/${id}/videos/order`, { method: "PUT", body: JSON.stringify({ ids }) }),

  generate: (id: string, options: GenerateOptions = {}) =>
    request<Job>(`/api/projects/${id}/generate`, { method: "POST", body: JSON.stringify(options) }),
  analyze: (id: string) => request<Job>(`/api/projects/${id}/analyze`, { method: "POST" }),
  /** The best parts of the project's song for a Reel of `duration` seconds, best first (the first = the automatic choice). */
  songParts: (id: string, duration: number, count = 5) =>
    request<SongParts>(`/api/projects/${id}/song-parts?duration=${duration}&count=${count}`, undefined, 240_000), // analyses the song: can take a while
  getJob: (projectId: string, jobId: string) => request<Job>(`/api/projects/${projectId}/jobs/${jobId}`),
  cancelJob: (projectId: string, jobId: string) => request<Job>(`/api/projects/${projectId}/jobs/${jobId}/cancel`, { method: "POST" }),
  renderings: (id: string) => request<Rendering[]>(`/api/projects/${id}/renderings`),
  plans: () => request<Pricing>("/api/plans"),
  credits: () => request<Credits>("/api/credits"),
  createOrder: (item: string) => request<CheckoutOrder>("/api/billing/order", { method: "POST", body: JSON.stringify({ item }) }),
  verifyPayment: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
    request<Credits>("/api/billing/verify", { method: "POST", body: JSON.stringify(body) }),
  setPricing: (body: { plans: { id: string; monthly: number; credits: number; features?: string[] }[]; topUps: { id: string; credits: number; price: number }[]; costs: Record<string, number> }) =>
    request<Pricing>("/api/admin/pricing", { method: "PUT", body: JSON.stringify(body) }),
  storyOptions: () => request<StoryOptions>("/api/story/options"),
  createStory: (body: { text: string; language: string; artStyle: string; scenes: number; seconds: number }) =>
    request<Story>("/api/story", { method: "POST", body: JSON.stringify(body) }, AI_TIMEOUT_MS),
  replanStory: (id: string) => request<Story>(`/api/projects/${id}/story/replan`, { method: "POST" }, AI_TIMEOUT_MS),
  getStory: (id: string) => request<Story>(`/api/projects/${id}/story`),
  editStory: (id: string, body: { title: string; scenes: { id: string; narration: string; visual: string }[] }) =>
    request<Story>(`/api/projects/${id}/story`, { method: "PUT", body: JSON.stringify(body) }),
  scenePicture: (id: string, sceneId: string, another = false) =>
    request<Story>(`/api/projects/${id}/story/scenes/${sceneId}/picture`, { method: "POST", body: JSON.stringify({ another }) }, AI_TIMEOUT_MS),
  uploadScenePicture: (id: string, sceneId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<Story>(`/api/projects/${id}/story/scenes/${sceneId}/upload`, form);
  },
  renderStory: (id: string, body: { voiceId: string | null; quality: "preview" | "final" }) =>
    request<Job>(`/api/projects/${id}/story/render`, { method: "POST", body: JSON.stringify(body) }),
  retention: () => request<Retention>("/api/retention"),
  setRetention: (body: Retention) => request<Retention>("/api/admin/retention", { method: "PUT", body: JSON.stringify(body) }),
  runRetention: () => request<{ uploads: number; projects: number }>("/api/admin/retention/run", { method: "POST" }),
  connections: () => request<Connections>("/api/publish/connections"),
  publish: (id: string, renderingId: string, body: { platforms: Platform[]; caption: string; at?: string | null }) =>
    request<Post>(`/api/projects/${id}/renderings/${renderingId}/publish`, { method: "POST", body: JSON.stringify(body) }),
  posts: (id: string) => request<Post[]>(`/api/projects/${id}/posts`),
  cancelPost: (postId: string) => request<{ ok: boolean }>(`/api/posts/${postId}`, { method: "DELETE" }),

  // --- editor ---
  timeline: (id: string) => request<TimelineState>(`/api/projects/${id}/timeline`),
  startEditing: (id: string, fresh = false) => request<TimelineState>(`/api/projects/${id}/timeline/start${fresh ? "?fresh=true" : ""}`, { method: "POST" }),
  editorCatalog: () => request<{ transitions: string[]; effects: string[]; looks: { id: string; label: string; hint: string }[] }>("/api/editor/catalog"),
  editTimeline: (id: string, ops: object[], label?: string) =>
    request<TimelineState>(`/api/projects/${id}/timeline/ops`, { method: "POST", body: JSON.stringify({ ops, label }) }),
  undo: (id: string) => request<TimelineState>(`/api/projects/${id}/timeline/undo`, { method: "POST" }),
  redo: (id: string) => request<TimelineState>(`/api/projects/${id}/timeline/redo`, { method: "POST" }),
  render: (id: string, quality: "preview" | "final", label?: string) =>
    request<Job>(`/api/projects/${id}/render`, { method: "POST", body: JSON.stringify({ quality, label }) }),
  restore: (id: string, renderingId: string) =>
    request<TimelineState>(`/api/projects/${id}/renderings/${renderingId}/restore`, { method: "POST" }),
  qualityCheck: (id: string) => request<QualityReport>(`/api/projects/${id}/quality-check`, { method: "POST" }),
  qualityFix: (id: string, code: string, segmentId?: string | null) =>
    request<{ state: TimelineState; issues: QualityReport["issues"]; checked: QualityReport["checked"] }>(
      `/api/projects/${id}/quality-fix`,
      { method: "POST", body: JSON.stringify({ code, segmentId }) },
    ),
  exportPresets: () => request<ExportPreset[]>("/api/export-presets"),
  queue: () => request<QueueItem[]>("/api/queue"),

  // --- understanding + library ---
  productStyles: () => request<ProductStyleInfo[]>("/api/product/styles"),
  uploadImages: (id: string, files: File[], onProgress?: (f: number) => void) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return upload<UploadResult>(`/api/projects/${id}/images`, form, onProgress);
  },
  deleteImage: (id: string, mediaId: string) => request<void>(`/api/projects/${id}/images/${mediaId}`, { method: "DELETE" }),
  productPlan: (id: string, body: ProductRequest = {}) =>
    request<ProductPlan>(`/api/projects/${id}/product/plan`, { method: "POST", body: JSON.stringify(body) }),
  generateProduct: (id: string, body: ProductRequest = {}) =>
    request<Job>(`/api/projects/${id}/product/generate`, { method: "POST", body: JSON.stringify(body) }),
  aiModels: () => request<AiModels>("/api/ai/models"),
  chooseModel: (model: string | null) => request<AiModels>("/api/ai/model", { method: "PUT", body: JSON.stringify({ model }) }),
  testModel: (model: string) => request<ModelTestResult>("/api/ai/models/test", { method: "POST", body: JSON.stringify({ model }) }),
  aiConfig: () => request<AiConfig>("/api/ai/config"),
  saveAiConfig: (body: AiConfigInput) => request<AiConfig>("/api/ai/config", { method: "PUT", body: JSON.stringify(body) }),
  aiProviderModels: (provider: AiProviderId) => request<AiProviderModels>(`/api/ai/providers/${provider}/models`),
  testAi: (provider?: AiProviderId, vision = false) =>
    request<AiTestResult>("/api/ai/test", { method: "POST", body: JSON.stringify({ provider, vision }) }),
  aiUsage: () => request<AiUsage>("/api/ai/usage"),
  songs: (q = "") => request<SongList>(`/api/songs?q=${encodeURIComponent(q)}`),
  uploadSongs: (files: File[], onProgress?: (f: number) => void) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return upload<{ uploaded: Song[]; failed: { name: string; error: string }[] }>("/api/songs", form, onProgress);
  },
  deleteSong: (id: string) => request<void>(`/api/songs/${id}`, { method: "DELETE" }),
  importSongs: () => request<{ added: number; folders: string[]; errors?: string[] }>("/api/songs/import", { method: "POST" }),
  songUsed: (id: string) => request<void>(`/api/songs/${id}/used`, { method: "POST" }),
  /** The song's audio as a File, so every existing "song file" flow (waveform, upload) works unchanged. */
  songFile: async (song: Song): Promise<File> => {
    const res = await fetch(assetUrl(song.url) as string);
    if (!res.ok) throw await parseError(res);
    const blob = await res.blob();
    const ext = (blob.type.split("/")[1] ?? "mp3").replace("mpeg", "mp3").replace("x-wav", "wav");
    return new File([blob], `${song.name}.${ext}`, { type: blob.type || "audio/mpeg" });
  },
  revise: (id: string, instruction: string, dryRun = false, confirmedActions?: Record<string, unknown>[]) =>
    request<ReviseResult>(`/api/projects/${id}/revise`, { method: "POST", body: JSON.stringify({ instruction, dryRun, confirmedActions }) }),
  understand: (id: string) => request<Job>(`/api/projects/${id}/understand`, { method: "POST" }),
  library: (params: Record<string, string | boolean | undefined>) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => v !== undefined && v !== "" && q.set(k, String(v)));
    return request<LibraryResult>(`/api/library?${q.toString()}`);
  },
  librarySearch: (query: string, ai: boolean) =>
    request<LibraryResult>("/api/library/search", { method: "POST", body: JSON.stringify({ query, ai }) }),
  patchMedia: (id: string, patch: { favorite?: boolean; tags?: string[] }) =>
    request<unknown>(`/api/library/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

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
  script: (id: string) => request<Script>(`/api/projects/${id}/script`),
  saveScript: (id: string, s: Omit<Script, "estimatedSeconds">) =>
    request<Script>(`/api/projects/${id}/script`, { method: "PUT", body: JSON.stringify(s) }),
  hooks: (id: string, count = 3) =>
    request<{ hooks: string[]; language: string }>(`/api/projects/${id}/script/hooks`, { method: "POST", body: JSON.stringify({ count }) }),
  generateScript: (id: string, body: { hook?: string | null; cta?: string | null }) =>
    request<Script>(`/api/projects/${id}/script/generate`, { method: "POST", body: JSON.stringify(body) }),
  reviseScript: (id: string, instruction: "shorten" | "natural" | "energetic" | "regenerate") =>
    request<Script>(`/api/projects/${id}/script/revise`, { method: "POST", body: JSON.stringify({ instruction }) }),
  generateVoice: (id: string, voiceProfileId?: string) =>
    request<{ state: TimelineState; voice: { duration: number; voice: string; lines: number } }>(`/api/projects/${id}/voice/generate`, {
      method: "POST",
      body: JSON.stringify({ voiceProfileId }),
    }),
  removeVoice: (id: string) => request<TimelineState>(`/api/projects/${id}/voice`, { method: "DELETE" }),

  // --- my trends (learned from reference Reels) ---
  references: () => request<LearnedTrend[]>("/api/references"),
  referenceReel: (id: string) => request<ReferenceReelInfo | null>(`/api/projects/${id}/reference-reel`),
  setReferenceReel: (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<ReferenceReelInfo>(`/api/projects/${id}/reference-reel`, form);
  },
  removeReferenceReel: (id: string) => request<void>(`/api/projects/${id}/reference-reel`, { method: "DELETE" }),
  trendLibrary: () => request<{ count: number; lastAdded: string | null; styles: number }>("/api/trend-library"),
  learnTrends: (files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return upload<{ learned: string[]; failed: { name: string; error: string }[]; total: number }>("/api/trend-library/learn", form);
  },
  groupTrends: () => request<LearnedTrend[]>("/api/trend-library/group", { method: "POST" }, AI_TIMEOUT_MS),
  clearTrendLibrary: () => request<void>("/api/trend-library", { method: "DELETE" }),
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
  applyBrand: (projectId: string, brandId: string) =>
    request<{ state: TimelineState | null }>(`/api/projects/${projectId}/apply-brand`, { method: "POST", body: JSON.stringify({ brandId }) }),
  templates: () => request<Template[]>("/api/templates"),
  createTemplate: (t: TemplateInput) => request<Template>("/api/templates", { method: "POST", body: JSON.stringify(t) }),
  updateTemplate: (id: string, t: TemplateInput) => request<Template>(`/api/templates/${id}`, { method: "PATCH", body: JSON.stringify(t) }),
  deleteTemplate: (id: string) => request<void>(`/api/templates/${id}`, { method: "DELETE" }),
  favoriteTemplate: (id: string, favorite: boolean) =>
    request<unknown>(`/api/templates/${id}/favorite`, { method: "PUT", body: JSON.stringify({ favorite }) }),
  generateTemplate: (prompt: string) =>
    request<{ draft: boolean; template: TemplateInput }>("/api/templates/generate", { method: "POST", body: JSON.stringify({ prompt }) }),
  generateTemplateFromChat: (transcript: string) =>
    request<{ draft: boolean; template: TemplateInput }>("/api/templates/generate-from-chat", { method: "POST", body: JSON.stringify({ transcript }) }),
  applyTemplate: (projectId: string, templateId: string) =>
    request<{ settings: unknown }>(`/api/projects/${projectId}/apply-template`, { method: "POST", body: JSON.stringify({ templateId }) }),

  // --- variations, workspace ---
  strategies: () => request<Strategy[]>("/api/variation-strategies"),
  /** One long video -> several Reels from its best parts (they appear as versions). */
  split: (id: string, count: number, seconds: number) =>
    request<Job>(`/api/projects/${id}/split`, { method: "POST", body: JSON.stringify({ count, seconds }) }),
  variations: (id: string, strategies?: string[]) =>
    request<Job>(`/api/projects/${id}/variations`, { method: "POST", body: JSON.stringify({ strategies }) }),
  duplicate: (id: string, body: { name?: string; variant?: "copy" | "language"; language?: string }) =>
    request<{ id: string; name: string }>(`/api/projects/${id}/duplicate`, { method: "POST", body: JSON.stringify(body) }),
  performance: (projectId: string, renderingId: string, body: PerformanceInput) =>
    request<unknown>(`/api/projects/${projectId}/renderings/${renderingId}/performance`, { method: "PUT", body: JSON.stringify(body) }),
  insights: () => request<Insights>("/api/insights"),
  dashboard: () => request<Dashboard>("/api/dashboard"),

  // --- chat ---
  chat: (messages: ChatMessage[]) => request<{ reply: string }>("/api/chat", { method: "POST", body: JSON.stringify({ messages }) }),
  uploadChatFile: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ChatFile>("/api/chat/files", { method: "POST", body: form });
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
