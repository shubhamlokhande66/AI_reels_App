import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Settings, from the `.env` at the project root (read here once). Real environment variables win over the file. */

export const REPO_ROOT = process.cwd();

function readDotEnv(file: string): Record<string, string> {
  try {
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || line.trimStart().startsWith("#")) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "");
      out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const fileEnv = readDotEnv(path.join(REPO_ROOT, ".env"));
/** A setting by its .env name (real environment variables win over the file). */
export const env = (key: string, fallback = ""): string => process.env[key] ?? fileEnv[key] ?? fallback;
const num = (key: string, fallback: number) => {
  const v = Number(env(key, String(fallback)));
  return Number.isFinite(v) ? v : fallback;
};
const bool = (key: string, fallback: boolean) => {
  const v = env(key, "").toLowerCase();
  return v === "" ? fallback : ["1", "true", "yes", "on"].includes(v);
};

export const settings = {
  nodeEnv: env("NODE_ENV", "development"),
  mongodbUri: env("MONGODB_URI", "mongodb://localhost:27017/ai_reel_maker"),
  mongodbDb: env("MONGODB_DB", "ai_reel_maker"),
  /** relative paths are from the repo root (where the data has always been) */
  storagePath: path.resolve(REPO_ROOT, env("STORAGE_PATH", "./storage")),
  /** STORAGE_PATH is a mounted bucket (Cloudflare R2 through FUSE): temporary work stays on the local disk (SCRATCH_PATH) and
   * FFmpeg writes locally before a file is copied into the bucket */
  storageMounted: bool("STORAGE_MOUNTED", false),
  /** Cloudflare: the scheduler calls /api/cron with this key; KEEP_ALIVE_URL is pinged while jobs run so the container
   * does not go to sleep in the middle of a render */
  cronSecret: env("CRON_SECRET", ""),
  keepAliveUrl: env("KEEP_ALIVE_URL", ""),
  scratchPath: path.resolve(env("SCRATCH_PATH", path.join(os.tmpdir(), "reel-scratch"))),
  maxVideoSizeMb: num("MAX_VIDEO_SIZE_MB", 500),
  maxAudioSizeMb: num("MAX_AUDIO_SIZE_MB", 50),
  maxVideosPerProject: num("MAX_VIDEOS_PER_PROJECT", 0),
  maxImageSizeMb: num("MAX_IMAGE_SIZE_MB", 40),
  maxImagesPerProject: num("MAX_IMAGES_PER_PROJECT", 12),
  minFreeDiskMb: num("MIN_FREE_DISK_MB", 1024),
  outputWidth: num("OUTPUT_WIDTH", 1080),
  outputHeight: num("OUTPUT_HEIGHT", 1920),
  outputFps: num("OUTPUT_FPS", 30),
  ffmpegBin: env("FFMPEG_BIN", ""),
  ffprobeBin: env("FFPROBE_BIN", ""),
  renderTimeoutSeconds: num("RENDER_TIMEOUT_SECONDS", 900),
  ffmpegThreads: num("FFMPEG_THREADS", 0),
  /** auto | off | h264_nvenc | h264_qsv | h264_amf | h264_videotoolbox (CPU fallback) */
  hwAccel: env("HW_ACCEL", "auto"),
  whisperModel: env("WHISPER_MODEL", "base"),
  whisperDevice: env("WHISPER_DEVICE", "cpu"),
  whisperComputeType: env("WHISPER_COMPUTE_TYPE", "int8"),
  whisperLanguage: env("WHISPER_LANGUAGE", ""),
  maxConcurrentJobs: num("MAX_CONCURRENT_JOBS", 1),
  aiProvider: env("AI_PROVIDER", "ollama"),
  aiTextProvider: env("AI_TEXT_PROVIDER", ""),
  aiVisionProvider: env("AI_VISION_PROVIDER", ""),
  aiFallbackEnabled: bool("AI_FALLBACK_ENABLED", false),
  aiFallbackProvider: env("AI_FALLBACK_PROVIDER", ""),
  aiMaxRetries: num("AI_MAX_RETRIES", 2),
  reviewThreshold: num("REVIEW_THRESHOLD", 70),
  adminKey: env("ADMIN_KEY", ""),
  authEnabled: bool("AUTH_ENABLED", false),
  billingEnabled: bool("BILLING_ENABLED", false),
  businessName: env("BUSINESS_NAME", "Reel Maison"),
  supportEmail: env("SUPPORT_EMAIL", ""),
  supportPhone: env("SUPPORT_PHONE", ""),
  businessAddress: env("BUSINESS_ADDRESS", ""),
  legalUpdated: env("LEGAL_UPDATED", "8 October 2026"),
  smtpHost: env("SMTP_HOST", ""),
  smtpPort: num("SMTP_PORT", 587),
  smtpUser: env("SMTP_USER", ""),
  smtpPassword: env("SMTP_PASSWORD", ""),
  smtpFrom: env("SMTP_FROM", ""),
  smtpSsl: bool("SMTP_SSL", false),
  razorpayKeyId: env("RAZORPAY_KEY_ID", ""),
  razorpayKeySecret: env("RAZORPAY_KEY_SECRET", ""),
  razorpayWebhookSecret: env("RAZORPAY_WEBHOOK_SECRET", ""),
  retentionEnabled: bool("RETENTION_ENABLED", false),
  keepUploadsHours: num("KEEP_UPLOADS_HOURS", 2),
  keepProjectsHours: num("KEEP_PROJECTS_HOURS", 24),
  secretKey: env("SECRET_KEY", ""),
  cookieSecure: bool("COOKIE_SECURE", false),
  reviewMaxIterations: num("REVIEW_MAX_ITERATIONS", 3),
  ollamaBaseUrl: env("OLLAMA_BASE_URL", "http://localhost:11434"),
  ollamaModel: env("OLLAMA_MODEL", ""),
  ollamaVisionModel: env("OLLAMA_VISION_MODEL", ""),
  openaiApiKey: env("OPENAI_API_KEY", ""),
  openaiTextModel: env("OPENAI_TEXT_MODEL", ""),
  openaiVisionModel: env("OPENAI_VISION_MODEL", ""),
  openaiBaseUrl: env("OPENAI_BASE_URL", ""),
  openaiReasoningEffort: env("OPENAI_REASONING_EFFORT", ""),
  geminiApiKey: env("GEMINI_API_KEY", ""),
  geminiTtsModel: env("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts"),
  openaiTtsModel: env("OPENAI_TTS_MODEL", "gpt-4o-mini-tts"),
  cloudflareAccountId: env("CLOUDFLARE_ACCOUNT_ID", ""),
  cloudflareApiToken: env("CLOUDFLARE_API_TOKEN", ""),
  storyPaidImages: env("STORY_PAID_IMAGES", ""),
  contactEmail: env("CONTACT_EMAIL", ""),
  geminiImageModel: env("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image"),
  openaiImageModel: env("OPENAI_IMAGE_MODEL", "gpt-image-2"),
  trendFeedUrl: env("TREND_FEED_URL", ""),
  trendFeedKey: env("TREND_FEED_KEY", ""),
  instagramUserId: env("INSTAGRAM_USER_ID", ""),
  instagramAccessToken: env("INSTAGRAM_ACCESS_TOKEN", ""),
  tiktokAccessToken: env("TIKTOK_ACCESS_TOKEN", ""),
  youtubeClientId: env("YOUTUBE_CLIENT_ID", ""),
  youtubeClientSecret: env("YOUTUBE_CLIENT_SECRET", ""),
  youtubeRefreshToken: env("YOUTUBE_REFRESH_TOKEN", ""),
  publicBaseUrl: env("PUBLIC_BASE_URL", ""),
  geminiTextModel: env("GEMINI_TEXT_MODEL", ""),
  geminiVisionModel: env("GEMINI_VISION_MODEL", ""),
  anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
  claudeTextModel: env("CLAUDE_TEXT_MODEL", "claude-opus-5-5"),
  claudeVisionModel: env("CLAUDE_VISION_MODEL", ""),
  claudeEffort: env("CLAUDE_EFFORT", "medium"),
  claudeTimeoutSeconds: num("CLAUDE_TIMEOUT_SECONDS", 180),
  aiTimeoutSeconds: num("AI_TIMEOUT_SECONDS", 300),
  cloudAiTimeoutSeconds: num("CLOUD_AI_TIMEOUT_SECONDS", 60),
  visionTimeoutSeconds: num("VISION_TIMEOUT_SECONDS", 420),
  visionMaxFramesPerClip: num("VISION_MAX_FRAMES_PER_CLIP", 4),
  visionMaxImageSize: num("VISION_MAX_IMAGE_SIZE", 384),
  visionDetailLevel: env("VISION_DETAIL_LEVEL", "low"),
  aiModelPrices: env("AI_MODEL_PRICES", ""),
  aiCurrency: env("AI_CURRENCY", "USD"),
  aiCurrencyRate: num("AI_CURRENCY_RATE", 1),
  dailyAiBudget: num("DAILY_AI_BUDGET", 0),
  monthlyAiBudget: num("MONTHLY_AI_BUDGET", 0),
  songImportFolders: env("SONG_IMPORT_FOLDERS", ""),
  rateLimitPerMinute: num("RATE_LIMIT_PER_MINUTE", 60),
  /** the Python backend, for every endpoint not moved to Next.js yet (see docs/MIGRATION.md) */
};
