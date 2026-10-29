export type ProjectStatus = "draft" | "processing" | "completed" | "failed";
export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/** What was measured in a trending Reel (or averaged over a trend's Reels). Seconds unless noted. */
export interface TrendProfile {
  videos?: number;
  seconds: number;
  shots?: number;
  pace?: "calm" | "balanced" | "fast";
  avgShot?: number;
  medianShot?: number;
  shortestShot?: number;
  longestShot?: number;
  hookSeconds?: number;
  cutsPer10s?: number;
  bpm?: number;
  onBeatShare?: number; // 0..1
  beatsPerShot?: number | null;
  loudAvgShot?: number | null;
  calmAvgShot?: number | null;
  look?: { brightness?: number; saturation?: number };
  described?: TrendLook | TrendLook[] | null;
  name?: string;
  hasMusic?: boolean;
}

export interface TrendLook {
  framing?: string;
  textOnScreen?: string;
  effects?: string[];
  transitions?: string[];
  colour?: string;
  mood?: string;
  summary?: string;
}

/** A Reel a creator copied ("Copy a Reel"), waiting for the administrator to teach the styles with it. */
export interface StyleSuggestion {
  id: string;
  name: string;
  /** "copy": given to Copy a Reel; "made": made in the studio and saved */
  from: "copy" | "made";
  createdAt: string;
  pace: string;
  trans: string;
  bpm: number;
  dur: number;
}

export interface LearnedTrend {
  id: string;
  name: string;
  notes: string;
  profile: TrendProfile;
  videos: TrendProfile[];
  auto?: boolean; // sorted out of the learned Reels automatically
  createdAt: string;
  updatedAt: string;
}

export interface ClipSummary {
  clipId: string;
  qualityScore: number;
  motionScore: number;
  brightnessScore: number;
  sharpnessScore: number;
  flags: string[];
  usable: boolean;
  /** Seconds of this clip the editor can really use (good parts only); absent before the analysis. */
  goodSeconds?: number;
  /** Shot intelligence (video analysis v3); absent on older analyses. */
  compositionScore?: number;
  subjectScore?: number;
  /** Only when the vision model says the clip shows a product. */
  productVisibility?: number | null;
  /** Share of usable footage per shot size, e.g. { close: 0.6, wide: 0.4 }. */
  shotSizes?: Record<string, number>;
  bestSegments?: { start: number; end: number; score: number }[];
}

export interface Media {
  id: string;
  kind: "video" | "audio" | "image";
  name: string;
  size: number;
  mimeType: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  analysis: ClipSummary | null;
  url: string;
  thumbnailUrl: string | null;
  /** Deleted for privacy after rendering (the Reels are kept). */
  purged?: boolean;
}

export interface JobStage {
  name: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: number;
}

export interface Job {
  id: string;
  projectId: string;
  type: "analyze" | "generate" | "render" | "variations" | "split" | "product";
  status: JobStatus;
  progress: number;
  stage: string;
  stages: JobStage[];
  error: ApiErrorBody | null;
  renderingId: string | null;
  createdAt: string;
  updatedAt: string;
  /** while it waits for a free server: its place in line (1 = next) */
  queuePosition?: number | null;
}

export interface Health {
  status: "ok" | "degraded";
  mongodb: boolean;
  ffmpeg: boolean;
  /** local = nothing leaves this computer (Ollama); false = cloud AI (only compact metadata + keyframes are sent). */
  ai: { provider: string; model: string | null; available: boolean; detail: string; local?: boolean; fallback?: string | null };
}

export type AiProviderId = "ollama" | "openai" | "gemini" | "claude";

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  local: boolean;
  /** Whether the backend has an API key. The key itself never reaches the browser. */
  keyConfigured: boolean;
  textModel: string | null;
  visionModel: string | null;
}

export interface AiProviderStatus {
  provider: AiProviderId;
  local: boolean;
  available: boolean;
  model: string | null;
  detail: string;
  errorKind?: string;
}

export interface AiTestResult {
  provider: AiProviderId;
  model?: string | null;
  ok: boolean;
  correct: boolean;
  detail: string;
  latencyMs: number;
  vision?: boolean;
  at?: string;
  errorKind?: string;
  errorCode?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface AiBudgetState {
  exceeded: boolean;
  reason: string | null;
  dailySpent: number | null;
  monthlySpent: number | null;
}

export interface AiConfig {
  provider: AiProviderId;
  textProvider: AiProviderId;
  visionProvider: AiProviderId;
  fallbackEnabled: boolean;
  fallbackProvider: AiProviderId | null;
  taskProviders: Record<string, AiProviderId>;
  providers: AiProviderInfo[];
  dailyBudget: number;
  monthlyBudget: number;
  budgetOverride: boolean;
  currency: string;
  status: { text: AiProviderStatus; vision: AiProviderStatus };
  budget: AiBudgetState;
  lastTest: AiTestResult | null;
  mode: "local" | "cloud";
  vision: { maxFramesPerClip: number; maxImageSize: number; detail: string };
}

export interface AiConfigInput {
  provider?: AiProviderId;
  textProvider?: AiProviderId | "";
  visionProvider?: AiProviderId | "";
  fallbackEnabled?: boolean;
  fallbackProvider?: AiProviderId | "";
  models?: Partial<Record<AiProviderId, { text?: string | null; vision?: string | null }>>;
  dailyBudget?: number;
  monthlyBudget?: number;
  budgetOverride?: boolean;
}

export interface AiProviderModels {
  provider: AiProviderId;
  reachable: boolean;
  detail: string | null;
  models: { name: string; vision: boolean | null }[];
}

export interface AiUsagePeriod {
  /** each kind of AI work (shot_ranking, studio_director, captions…): calls, cost and cost per call */
  tasks?: { task: string; calls: number; cost: number | null; perCall: number | null }[];
  calls: number;
  ok: number;
  failed: number;
  fallbacks: number;
  cost: number | null;
  allPriced: boolean;
  providers: { provider: string; calls: number; ok: number; failed: number; cost: number | null }[];
}

export interface AiUsage {
  today: AiUsagePeriod;
  week: AiUsagePeriod;
  month: AiUsagePeriod;
  currency: string;
  budget: AiBudgetState & { daily: number; monthly: number; override: boolean };
}

// ---- Library / voice / brand / templates / workspace -------------------------
export type Language = "en" | "hi" | "mr" | "hinglish";
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "mr", label: "Marathi" },
  { id: "hinglish", label: "Hinglish" },
];

export interface VoiceProfile {
  id: string;
  name: string;
  voice: string | null;
  language: Language;
  speed: number;
  pitch: number;
  energy: "low" | "medium" | "high";
  emotion: "neutral" | "friendly" | "energetic" | "calm" | "serious";
  pauseStyle: "tight" | "natural" | "dramatic";
  pronunciations: Record<string, string>;
}
export type VoiceProfileInput = Omit<VoiceProfile, "id">;

export interface SystemVoices {
  provider: string;
  available: boolean;
  voices: { id: string; name: string; language: string; gender: string }[];
  languages: Record<Language, boolean>;
  note: string | null;
}

export interface Brand {
  id: string;
  name: string;
  colors: { primary: string; secondary: string; accent: string };
  captionFont: string | null;
  headingFont: string | null;
  watermark: { enabled: boolean; position: "br" | "bl" | "tr" | "tl" | "center"; opacity: number; scale: number };
  cta: string;
  language: Language;
  voiceProfileId: string | null;
  scriptTone: string;
  captionStyle: string;
  style: string;
  /** The brand look the Creative Director uses whenever a project style is auto. */
  visualStyle?: BrandVisualStyle | null;
  pace: "calm" | "balanced" | "fast";
  trendId: string | null;
  musicStyle: string;
  exportPreset: string;
  hasLogo: boolean;
  logoUrl: string | null;
}
export type BrandInput = Omit<Brand, "id" | "hasLogo" | "logoUrl">;
export const BRAND_VISUAL_STYLES = ["luxury", "cinematic", "viral", "minimal", "energetic", "storytelling", "product_focus", "social_native"] as const;
export type BrandVisualStyle = (typeof BRAND_VISUAL_STYLES)[number];

export interface AiModel {
  name: string;
  sizeGb: number;
  capabilities: string[];
  vision: boolean;
  thinking: boolean;
  embeddingOnly: boolean;
  current: boolean;
}

export interface AiModels {
  provider: string;
  reachable: boolean;
  detail: string | null;
  current: string;
  source: "settings" | "env" | "none";
  envModel: string | null;
  models: AiModel[];
  needsVision: string;
}

export interface ModelTestResult {
  model: string;
  ok: boolean;
  seconds: number;
  verdict: "correct" | "over-eager" | "wrong" | "failed";
  detail: string;
}

// ---- Song library -----------------------------------------------------------------
export interface Song {
  id: string;
  name: string;
  artist: string | null;
  duration: number | null;
  size: number | null;
  source: "upload" | "folder";
  license: string | null;
  licenseUrl: string | null;
  shareUrl: string | null;
  image: string | null;
  /** Relative to the API: stream it with assetUrl(). */
  url: string;
  useCount: number;
}

export type { Pricing, Credits } from "@shubix/types";
export interface CheckoutOrder {
  orderId: string;
  keyId: string;
  amount: number;
  currency: string;
  label: string;
  email: string;
}

/** Business details for the legal and contact pages. */
export interface SiteInfo {
  businessName: string;
  supportEmail: string;
  supportPhone: string;
  businessAddress: string;
  legalUpdated: string;
  /** the phone apps' store pages; empty = "Coming soon" */
  playStoreUrl: string;
  appStoreUrl: string;
  /** GST number, on receipts (empty: not shown) */
  gstin: string;
}

/** Administration → Overview (server/adminDashboard.ts). Dates arrive as ISO strings. */
export interface AdminVisitor { id: string; email: string | null; path: string; device: string; at: string; since: string }
export interface AdminOverview {
  billing: boolean;
  users: { total: number; today: number; week: number; buyers: number };
  visitors: { online: number; onlineSignedIn: number; onlineGuests: number; today: number; week: number };
  online: AdminVisitor[];
  revenue: { total: number; month: number; payments: number };
  credits: { left: number; used30d: number };
  reels: { total: number }; // saved to My Reels
  plans: { plan: string; name: string; users: number }[];
  signupsByDay: { day: string; users: number }[];
  revenueByMonth: { month: string; rupees: number }[];
  recentUsers: { id: string; email: string; createdAt: string | null }[];
  recentPayments: { id: string; email: string; label: string; rupees: number; paidAt: string | null }[];
}
/** Administration → Users: one row per account. credits = null before the person's wallet exists. */
export interface AdminUserRow {
  id: string; email: string; admin: boolean; createdAt: string | null; lastLoginAt: string | null; lastSeenAt: string | null; logins: number; online: boolean;
  plan: string; planName: string; planEnds: string | null; credits: number | null; creditsUsed: number;
  spent: number; purchases: number; lastPurchase: string | null; reels: number;
}
export interface AdminUserDetail {
  id: string; email: string; admin: boolean; self: boolean; createdAt: string | null; lastLoginAt: string | null; lastSeenAt: string | null; logins: number;
  wallet: { plan: string; planName: string; period: string | null; monthly: number; extra: number; balance: number; planEnds: string | null; renews: string | null } | null;
  payments: { id: string; label: string; rupees: number; status: string; createdAt: string | null; paidAt: string | null; via: string | null }[];
  history: { delta: number; reason: string; at: string | null; balance: number | null; refunded: boolean }[];
  reels: { id: string; name: string; status: string; createdAt: string | null }[];
  devices: { device: string; path: string; at: string | null; online: boolean }[];
}
