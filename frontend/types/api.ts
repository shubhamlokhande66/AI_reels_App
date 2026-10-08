export type ProjectStatus = "draft" | "processing" | "completed" | "failed";
export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled";

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ProjectSettings {
  reelType?: "edit" | "product" | "story";
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
  /** Optional brief fields; empty = inferred by the Creative Director. */
  objective?: string;
  audience?: string;
  /** Creative direction: auto, or one of the three concepts. */
  concept?: Concept;
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
  /** The Quality Reviewer scores the edit and revises it (up to 2 rounds) before rendering. */
  autoReview?: boolean;
  /** Whooshes on moving transitions, a riser + impact on the drop, pops under text (synthesised locally). */
  soundEffects?: boolean;
  /** Privacy: delete the uploaded clips and music once a final Reel is rendered (the Reels are kept). */
  deleteMediaAfterRender?: boolean;
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
  postCopy: { title: string; description: string; hashtags: string[] } | null;
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
  type: "analyze" | "generate" | "render" | "variations" | "split" | "product";
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
    duration: number; bpm: number; audioStart?: number; warnings: string[]; notes?: string[]; segments: TimelineSegment[];
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

export type Sequence = "mixed" | "steps" | "talk";

export interface SongPart {
  start: number;
  end: number;
  score: number;
  reasons: string[];
}

export interface SongParts {
  songSeconds: number;
  bpm: number;
  duration: number;
  parts: SongPart[];
  tooShort: boolean;
}
export type Concept = "auto" | "viral" | "cinematic" | "premium";

export interface GenerateOptions {
  sequence?: Sequence;
  teaser?: boolean;
  stepLabels?: boolean;
  orderMode?: "auto" | "manual";
  audioMode?: string;
  brief?: string;
  concept?: Concept;
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
  /** Why the director chose this shot here, in plain words. */
  why?: string | null;
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
    /** Labelled song parts inside the Reel and what cuts land on there. */
    sections?: { start: number; end: number; label: string; energy: number; vocal: number; density: number; cutOn: string; confidence: number }[];
    /** One point per beat: section, energy, beat strength, position in the musical phrase. */
    timeline?: { time: number; section: string | null; energy: number; beatStrength: number; phrasePosition: number }[];
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
  /** The Quality Reviewer's verdict on the final edit, with the revisions it made before rendering. */
  review?: CreativeReview;
  /** The strongest possible openings the director compared (best first). */
  hookCandidates?: HookCandidate[];
  /** The single strongest moment of the footage, kept for the music's peak. */
  heroMoment?: { clipId: string; asset: string; start: number; end: number; score: number } | null;
  /** Phase 2: the project brief (who / what / why), with the fields the app inferred. */
  brief?: ProjectBrief;
  /** Phase 2: the Creative Plan this edit carries out. */
  creativePlan?: CreativePlan;
  /** Phase 2: the hook engine's typed, scored openings (best first). */
  hooks?: HookOption[];
  /** Phase 2: the Reviewer's ten measured scores. */
  scorecard?: Scorecard;
  /** Phase 2: review -> correct -> re-render rounds after the first render. */
  selfCorrection?: { iteration: number; scoreBefore: number; scoreAfter: number | null; changes: string[]; kept: boolean; aiSummary: string }[];
}

export interface ProjectBrief {
  platform: string;
  duration: number;
  objective: string;
  contentType: string;
  audience: string;
  style: string;
  tone: string;
  cta: string;
  brand: string;
  language: string;
  inferred: string[];
}

export interface CreativePlan {
  concept: string;
  direction: "auto" | "viral" | "cinematic" | "premium";
  logline: string;
  hook: { type?: string; clipId?: string; asset?: string; start?: number; duration?: number; why?: string };
  story: string[];
  pacing: string;
  visualEnergy: string;
  musicInterpretation: string;
  textStrategy: string;
  effectsStrategy: string;
  transitionStrategy: string;
  ending: string;
  source: "rules" | "ai";
}

export interface HookOption {
  clipId: string;
  asset: string;
  start: number;
  end: number;
  type: string;
  hookScore: number;
  clarity: number;
  curiosity: number;
  visualStrength: number;
  reason: string;
  text: string;
}

export interface Scorecard {
  overallScore: number;
  hook: number;
  story: number;
  pacing: number;
  musicSync: number;
  visualQuality: number;
  brandFit: number;
  textReadability: number;
  audio: number;
  ending: number;
  retention: number;
  issues: string[];
  threshold: number;
  measured: boolean;
}

export interface CreativeIssue {
  timestamp: number;
  problem: string;
  severity: "high" | "medium" | "low";
  category: string;
  fix: string | null;
}

export interface CreativeReview {
  overallScore: number;
  target: number;
  categories: Record<string, number>;
  issues: CreativeIssue[];
  iterations: { round: number; changes: string[]; scoreBefore: number; scoreAfter: number; kept: boolean }[];
}

export interface HookCandidate {
  clipId: string;
  asset: string;
  start: number;
  end: number;
  score: number;
  parts: Record<string, number>;
  reason: string;
}

export interface DirectorProfile {
  ready: boolean;
  enabled: boolean;
  evidence: number;
  minEvidence: number;
  preferences: {
    avgShotSeconds?: number | null;
    duration?: number;
    style?: string;
    pace?: "calm" | "balanced" | "fast";
    transitions?: "minimal" | "more" | "as styled";
    effects?: "minimal" | "as styled";
    hook?: "aggressive" | "balanced";
    text?: "minimal" | "as styled";
  };
  counts: Record<string, number>;
}

export type FeedbackReason = "opening" | "pacing" | "music" | "clips" | "text" | "effects" | "other";

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

/** Publishing (official platform APIs; keys on the server). */
export type Platform = "instagram" | "tiktok" | "youtube";
export type Connections = Record<Platform, { connected: boolean; missing: string[] }>;
export interface Post {
  id: string;
  renderingId: string;
  platforms: Platform[];
  caption: string;
  at: string;
  status: "scheduled" | "publishing" | "done" | "failed" | "cancelled";
  results: Partial<Record<Platform, { ok: boolean; postId: string | null; url: string; error: string | null }>>;
  error: string | null;
  createdAt: string;
}

/** Automatic deletion (admin setting). */
export interface Retention {
  enabled: boolean;
  uploadsHours: number;
  projectsHours: number;
}

/** Story -> Reel. */
export type PictureSource = "library" | "public_domain" | "free_ai" | "paid_ai" | "upload";
export interface StoryScene {
  id: string;
  narration: string;
  visual: string;
  keywords: string[];
  characters: string[];
  shot: "wide" | "medium" | "close";
  mood: string;
  source: PictureSource | null;
  credit: string;
  imageUrl: string | null;
}
export interface Story {
  projectId: string;
  title: string;
  language: string;
  artStyle: string;
  characters: { name: string; look: string }[];
  scenes: StoryScene[];
  postCopy: { title: string; description: string; hashtags: string[] } | null;
  plannedBy: "ai" | "simple";
}
export interface StoryOptions {
  artStyles: { id: string; name: string; paintings: boolean; sources: string[] }[];
  narrators: { id: string; name: string }[];
  freeAi: boolean;
  paidAi: boolean;
}
