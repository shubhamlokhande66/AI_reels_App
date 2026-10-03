export type ProjectStatus = "draft" | "processing" | "completed" | "failed";
export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type Platform = "none" | "instagram";

/** Post copy for a rendering. Instagram Reels also get a line asking for the send and alt text. */
export interface PostCopyData {
  title: string;
  description: string;
  hashtags: string[];
  sendPrompt?: string;
  altText?: string;
  platform?: Platform;
  /** "template" = made from the project name and instructions without AI. */
  source?: string;
}

export interface ProjectSettings {
  reelType?: "edit" | "product";
  productStyle?: string;
  hookText?: string;
  taglineText?: string;
  ctaText?: string;
  loop?: boolean;
  duration: number;
  /** Where in the song the Reel begins (seconds). null/undefined = the app picks the best part. */
  audioStart?: number | null;
  style: string;
  exportPreset?: string;
  /** The social network the Reel is made for. "instagram" tunes the edit, checks and caption to how Instagram ranks Reels. */
  platform?: Platform;
  pace: "auto" | "calm" | "balanced" | "fast";
  /** mixed = best moments in any order; steps = every clip once, in the order it happened (recipes, tutorials). */
  sequence?: Sequence;
  /** Step by step: open with a short look at the finished dish. */
  teaser?: boolean;
  /** Step by step: "Step 1", "Step 2"… on screen. */
  stepLabels?: boolean;
  /** Step by step: "auto" guesses the order (file names / what clips show); "manual" keeps the clip list order exactly. */
  orderMode?: "auto" | "manual";
  audioMode?: "music" | "voice_music" | "voice" | "original" | "none";
  language?: string;
  brief?: string;
  brandId?: string | null;
  voiceProfileId?: string | null;
  captions: boolean;
  captionStyle: string;
  ai: boolean;
  /** With AI on: the AI director plans every shot (validated before use). Off = AI only assists the rule-based editor. */
  aiDirector?: boolean;
  trendId: string | null;
  /** Edit like a learned trend: "auto" (the AI picks from My trends), "none", or a trend id. */
  reference?: string;
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

export interface LearnedTrend {
  id: string;
  name: string;
  notes: string;
  profile: TrendProfile;
  videos: TrendProfile[];
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
}

export interface Rendering {
  id: string;
  projectId: string;
  style: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  label: string;
  createdAt: string;
  url: string;
  downloadUrl: string;
  kind?: "final" | "preview";
  timelineVersion?: number;
  postCopy: PostCopyData | null;
  performance?: PerformanceInput | null;
}

export interface PerformanceInput {
  platform: "instagram" | "youtube" | "tiktok" | "other";
  views: number;
  watchSeconds: number;
  likes: number;
  shares: number;
  saves: number;
  comments: number;
  completionRate: number | null;
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
  type: "analyze" | "generate" | "render" | "variations" | "product";
  status: JobStatus;
  progress: number;
  stage: string;
  stages: JobStage[];
  error: ApiErrorBody | null;
  renderingId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineSegment {
  clipId: string;
  video: string;
  timelineStart: number;
  timelineEnd: number;
  transitionIn: { type: string; duration: number };
}

export interface Project {
  images?: Media[];
  productPlan?: ProductPlan | null;
  reelPlan?: ReelPlan | null;
  id: string;
  name: string;
  status: ProjectStatus;
  settings: ProjectSettings;
  videos: Media[];
  audio: Media | null;
  analysis: {
    warnings?: string[];
    usableClips?: number;
    audio?: { bpm: number; duration: number; beatCount: number };
  } | null;
  timeline: {
    duration: number; bpm: number; warnings: string[]; notes?: string[]; segments: TimelineSegment[];
    colorGrade?: string | null;
    overlays?: { id: string; text: string; start: number; end: number; role: string }[];
    /** Which AI made the creative decisions ("AI: Gemini"). */
    ai?: { provider: string; model: string; local: boolean; tasks: string[]; director: boolean; fallbackUsed: boolean } | null;
  } | null;
  timelineVersion?: number;
  preview?: Rendering | null;
  output: Rendering | null;
  latestJob: Job | null;
  error: ApiErrorBody | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  style: string;
  duration: number;
  videoCount: number;
  thumbnailUrl: string | null;
  outputUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StyleInfo {
  id: string;
  name: string;
  description: string;
  captionStyle: string;
}

export interface TrendPreset {
  id: string;
  trendName: string;
  recommendedDuration: number;
  cutFrequency: "fast" | "medium" | "slow";
  transitionStyle: "smooth" | "punchy" | "minimal";
  captionStyle: string;
  description: string;
}

export interface Health {
  status: "ok" | "degraded";
  mongodb: boolean;
  ffmpeg: boolean;
  /** local = nothing leaves this computer (Ollama); false = cloud AI (only compact metadata + keyframes are sent). */
  ai: { provider: string; model: string | null; available: boolean; detail: string; local?: boolean; fallback?: string | null };
}

export type AiProviderId = "ollama" | "openai" | "gemini";

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

export type Sequence = "mixed" | "steps";

export interface GenerateOptions {
  sequence?: Sequence;
  teaser?: boolean;
  stepLabels?: boolean;
  orderMode?: "auto" | "manual";
  audioMode?: string;
  brief?: string;
  language?: string;
  style?: string;
  pace?: "auto" | "calm" | "balanced" | "fast";
  duration?: number;
  audioStart?: number;
  audioAuto?: boolean;
  seed?: number;
  label?: string;
  captions?: boolean;
  ai?: boolean;
}

// ---- Editor / EDL ---------------------------------------------------------
export type Framing = "auto" | "fill" | "fit";

export interface EdlSegment {
  id: string;
  clipId: string;
  video: string;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  timelineEnd: number;
  speed: number;
  effect: string;
  transitionIn: { type: string; duration: number };
  crop: { framing: Framing; focusX: number | null; focusY: number | null };
}

export interface EdlCaption {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface EdlTimeline {
  duration: number;
  bpm: number;
  audioStart: number;
  style: string;
  segments: EdlSegment[];
  captions: EdlCaption[];
  captionStyle: string;
  voice?: { fileKey: string; duration: number; start: number; volume: number; duckMusic: boolean; profileName: string; language: string; lines: { text: string; start: number; end: number }[] } | null;
  watermark?: { logoKey: string; position: string; opacity: number; scale: number } | null;
  musicVolume: number;
  musicFadeIn: number | null;
  musicFadeOut: number | null;
  warnings: string[];
  notes: string[];
}

export interface TimelineState {
  timeline: EdlTimeline | null;
  version: number;
  canUndo: boolean;
  canRedo: boolean;
  index: number;
  history: { label: string; at: string | null }[];
}

export interface QualityIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  fix: string | null;
  segmentId: string | null;
}

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
  checked: { timelineVersion: number; renderingId: string | null; kind: "final" | "preview" | null };
}

export interface QueueItem extends Job {
  projectName: string;
  position: number | null;
}

export interface ExportPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  aspect: string;
  maxSeconds: number | null;
}

// ---- Library / voice / brand / templates / workspace -------------------------
export type Language = "en" | "hi" | "mr" | "hinglish";
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: "en", label: "English" },
  { id: "hi", label: "Hindi" },
  { id: "mr", label: "Marathi" },
  { id: "hinglish", label: "Hinglish" },
];

export interface LibraryItem {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
  url: string;
  tags: string[];
  userTags: string[];
  aiTags: string[];
  category: string;
  summary: string;
  camera: string;
  people: number | null;
  analyzed: boolean;
  favorite: boolean;
  used: boolean;
  score?: number;
  matched?: string[];
}

export interface LibraryResult {
  items: LibraryItem[];
  total: number;
  tags?: { tag: string; count: number }[];
  terms?: string[];
  note?: string | null;
  ai?: boolean;
}

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

export interface Script {
  language: Language;
  lines: { text: string; pauseAfter: number | null }[];
  hook: string | null;
  cta: string | null;
  tone: string;
  voiceProfileId: string | null;
  estimatedSeconds: number;
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
  pace: "calm" | "balanced" | "fast";
  trendId: string | null;
  musicStyle: string;
  exportPreset: string;
  hasLogo: boolean;
  logoUrl: string | null;
}
export type BrandInput = Omit<Brand, "id" | "hasLogo" | "logoUrl">;

export interface Template {
  id: string;
  name: string;
  description: string;
  duration: number;
  style: string;
  pace: "calm" | "balanced" | "fast";
  hook: boolean;
  captions: boolean;
  captionStyle: string;
  audioMode: string;
  musicSync: boolean;
  ai: boolean;
  language: Language;
  exportPreset: string;
  builtin: boolean;
  favorite: boolean;
  uses: number;
}
export type TemplateInput = Omit<Template, "id" | "builtin" | "favorite" | "uses">;

export interface Strategy {
  id: string;
  label: string;
  description: string;
  style: string;
  order: string;
}

export interface Dashboard {
  projects: { total: number; draft: number; processing: number; completed: number; failed: number };
  rendering: number;
  templates: { total: number; favorites: { id: string; name: string }[]; mostUsed: { id: string; name: string; uses: number }[] };
  voiceProfiles: number;
  brands: number;
  library: { clips: number; analyzed: number };
  recentlyGenerated: { id: string; projectId: string; projectName: string; label: string; style: string; createdAt: string; url: string }[];
  mostUsedStyles: { style: string; projects: number }[];
}

export interface ReviseResult {
  mode: "edit" | "rebuild" | "none";
  understood: { text: string; does: string; source: "rules" | "ai"; rebuild: boolean }[];
  notUnderstood: string[];
  warnings: string[];
  notes: string[];
  usedAi: boolean;
  aiNote: string | null;
  examples: string[];
  job: Job | null;
  needsConfirmation: boolean;
  actions: Record<string, unknown>[];
}

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

// ---- Product Reels (directed from photos) ---------------------------------
export interface ProductView {
  cx: number;
  cy: number;
  hh: number;
  roll: number;
}
export interface ProductShot {
  index: number;
  start: number;
  end: number;
  purpose: "hook" | "curiosity" | "reveal" | "hero" | "detail" | "macro" | "payoff" | "cta";
  framing: string;
  imageIndex: number;
  camera: { type: string; start: ProductView; end: ProductView; ease: string };
  effects: { type: string; at: number; duration: number; strength: number; x: number | null; y: number | null; onBeat: boolean }[];
  transitionIn: { type: string; duration: number };
  beatTime: number | null;
  note: string;
}
export interface ProductText {
  id: string;
  text: string;
  start: number;
  end: number;
  x: number;
  y: number;
  size: number;
  animationIn: string;
  role: "hook" | "tagline" | "cta";
}
export interface ReelPlanShot {
  index: number;
  start: number;
  end: number;
  asset: string;
  sourceStart: number;
  sourceEnd: number;
  purpose: string;
  subject: string;
  shotType: string | null;
  camera: string;
  speed: number;
  transition: string;
  text: string | null;
  musicEvent: string;
  beatLevel: 1 | 2 | 3 | 4;
  beatLevelName: string;
  mayTrigger: string;
  energy: string;
  importance: number | null;
}

export interface ReelPlanCheck {
  name: string;
  ok: boolean;
  fixed: boolean;
  detail: string;
}

/** The director's plan for an edited Reel: what was decided, shot by shot, and how it was checked. */
export interface ReelPlan {
  label: string;
  duration: number;
  format: string;
  timelineVersion?: number;
  category: { name: string; confidence: number; source: "vision" | "style" | "none"; evidence: string[] };
  music: {
    bpm: number;
    beats: { t: number; level: number; downbeat: boolean }[];
    accents: { t: number; strength: number }[];
    bars: number[];
    phrases: number[];
    drops: number[];
    pauses: { start: number; end: number }[];
    energyCurve: { start: number; end: number; level: string }[];
    notDetected: string[];
  };
  hook: { asset: string; start: number; end: number; kind: string };
  story: string[];
  shots: ReelPlanShot[];
  ending: { asset: string; purpose: string };
  quality: ReelPlanCheck[];
  limits: string[];
  /** Present when the AI director planned the Reel: its decisions, shot by shot, and what the safety layer changed. */
  aiDirector?: AiDirectorLog;
  /** Set when the AI director was asked for but the rule-based editor made this Reel (and why). */
  directorFallback?: { reason: string };
  /** Present for Reels made for Instagram: how the Reel scores against Instagram's ranking signals. */
  instagram?: InstagramReport;
}

export type InstagramSignal = "hook" | "watch_time" | "rewatch" | "shares" | "eligibility" | "discovery";

export interface InstagramCheck {
  id: string;
  signal: InstagramSignal;
  name: string;
  /** info = advice the app cannot measure (not scored). */
  status: "pass" | "warn" | "fail" | "info";
  detail: string;
  tip: string;
}

export interface InstagramReport {
  platform: "instagram";
  score: number;
  verdict: string;
  /** Recommendation rules this Reel breaks (it is not shown to new viewers until they are fixed). */
  blocked: string[];
  signals: { id: InstagramSignal; label: string; score: number | null }[];
  checks: InstagramCheck[];
  postingTips: string[];
  note: string;
}

export interface AiDirectorShotLog {
  shot: number;
  clip: string;
  purpose: string;
  beatAlignment: string;
  asked: { start: number; seconds: number; from: number; to: number; effect: string; transition: string; speed: number; crop: string };
  used: { start: number; end: number; from: number; to: number; effect: string; transition: string; transitionSeconds: number; speed: number; crop: string };
  changes: string[];
  /** Fine timing only (a cut moved a little onto the beat): not a correction. */
  timing?: string | null;
}

export interface AiDirectorLog {
  /** Present when the AI was asked to correct its own plan once: problems before / after, and which plan was used. */
  revision?: { before: number; after: number; used: boolean } | null;
  provider: string;
  model: string;
  reused: boolean;
  latencyMs: number | null;
  tokens: { input: number | null; output: number | null } | null;
  idea: string;
  style: { asked: string; used: string };
  grade: { asked: string; used: string | null };
  texts: { asked: { text: string; start: number; end: number; role: string }[]; used: { text: string; start: number; end: number; role: string }[] };
  shots: AiDirectorShotLog[];
  fixes: string[];
}

export interface ProductPlan {
  style: string;
  duration: number;
  fps: number;
  bpm: number;
  audioStart: number;
  concept: Record<string, string>;
  images: string[];
  shots: ProductShot[];
  texts: ProductText[];
  loop: boolean;
  warnings: string[];
  notes: string[];
  quality: { name: string; ok: boolean; detail: string }[];
}
export interface ProductStyleInfo {
  id: string;
  name: string;
  description: string;
}
export interface ProductRequest {
  productStyle?: string;
  hookText?: string;
  taglineText?: string;
  ctaText?: string;
  loop?: boolean;
  duration?: number;
  audioStart?: number;
  audioAuto?: boolean;
  seed?: number;
  quality?: "preview" | "final";
  label?: string;
}

export interface Insights {
  posts: number;
  enoughData: boolean;
  byStyle: InsightGroup[];
  byDuration: InsightGroup[];
  byCaptionStyle: InsightGroup[];
  byVoiceOver: InsightGroup[];
  note: string;
}
export interface InsightGroup {
  name: string;
  n: number;
  avgViews: number;
  avgCompletion: number | null;
  confident: boolean;
}

export type ChatRole = "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
  images?: string[];
}

export type ChatFileKind = "image" | "video" | "audio" | "text";
export interface ChatFile {
  name: string;
  kind: ChatFileKind;
  mime: string;
  sizeBytes: number;
  text?: string | null;
  images: string[];
  truncated: boolean;
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

export interface SongList {
  songs: Song[];
  /** Folders watched for new songs (SONG_IMPORT_FOLDERS in the backend .env). */
  folders: string[];
}
