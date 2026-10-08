export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** "5 min", "45 sec", "1h 5min" — a rough spoken-style duration for progress estimates, not a clock. */
export function formatEta(seconds: number): string {
  const s = Math.max(Math.round(seconds), 0);
  if (s < 60) return `${Math.max(s, 5)} sec`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? ` ${m}min` : ""}`;
  return `${m} min`;
}

/**
 * A rough "how long left" estimate for a running job, from its own elapsed time and progress so far.
 * Held back until there is enough signal (some progress, a few seconds elapsed) so it never guesses wildly early on.
 */
export function estimateProgress(createdAt: string, progressPct: number, now: Date = new Date()) {
  const elapsedMs = now.getTime() - new Date(createdAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 4000 || progressPct < 3) return null;
  const totalMs = (elapsedMs / progressPct) * 100;
  const remainingMs = Math.max(totalMs - elapsedMs, 0);
  return { elapsed: formatEta(elapsedMs / 1000), remaining: formatEta(remainingMs / 1000), total: formatEta(totalMs / 1000) };
}

export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

export const STYLE_LABELS: Record<string, string> = {
  viral: "Viral",
  cinematic: "Cinematic",
  luxury: "Luxury",
  energetic: "Energetic",
  storytelling: "Storytelling",
  product_focus: "Product Focus",
  social_native: "Social Native",
  fast_trending: "Fast Trending",
  minimal: "Minimal",
  food: "Food",
  travel: "Travel",
  custom: "Custom",
  auto: "Auto",
};

export function styleLabel(id: string): string {
  return STYLE_LABELS[id] ?? id;
}

export const ACCEPTED_VIDEO = ".mp4,.mov,.m4v,.webm,.mkv,.avi";
export const ACCEPTED_AUDIO = ".mp3,.wav,.m4a,.aac,.ogg,.flac";
// For the file picker: the wildcard types make phones open the photo/video gallery and the music files directly.
// (Files are still checked by extension after they are chosen.)
export const ACCEPTED_IMAGE = ".jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff";
export const PICKER_IMAGE = `${ACCEPTED_IMAGE},image/*`;
export const PICKER_VIDEO = `${ACCEPTED_VIDEO},video/*`;
export const PICKER_AUDIO = `${ACCEPTED_AUDIO},audio/*`;
const VIDEO_EXT = new Set(ACCEPTED_VIDEO.split(","));
const AUDIO_EXT = new Set(ACCEPTED_AUDIO.split(","));

function ext(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i).toLowerCase();
}
export const isVideoFile = (f: File) => VIDEO_EXT.has(ext(f.name));
export const isAudioFile = (f: File) => AUDIO_EXT.has(ext(f.name));
const IMAGE_EXT = new Set(ACCEPTED_IMAGE.split(","));
export const isImageFile = (f: File) => IMAGE_EXT.has(ext(f.name));
export const isHeic = (f: File) => [".heic", ".heif"].includes(ext(f.name));

/** Upload limits (the same as the backend defaults: MAX_VIDEO_SIZE_MB, MAX_AUDIO_SIZE_MB). */
export const MAX_VIDEO_MB = 500;
export const MAX_AUDIO_MB = 50;
/** The files over `mb` megabytes, as "name (612 MB)" for a message. */
export function tooBig(files: File[], mb: number): string[] {
  return files.filter((x) => x.size > mb * 1024 * 1024).map((x) => `${x.name} (${Math.round(x.size / 1024 / 1024)} MB)`);
}
