/** Small platform-neutral helpers. */
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
/** "sh••••@gmail.com" */
export const maskEmail = (s: string) => s.replace(/^([^@]{1,2})[^@]*(@.*)$/, (_m, a: string, b: string) => `${a}${"•".repeat(4)}${b}`);
/** "{email}" placeholders in a CMS text */
export const fill = (text: string, vars: Record<string, string | number> = {}) => text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
/** A length as "1:05" (seconds in). */
export const clock = (s = 0) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
/** When something happened, said shortly: "just now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const diff = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(diff)) return "";
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
/** A file size as "4.2 MB" (whole MB from 10 MB). */
export const megabytes = (b: number) => (b < 1e7 ? (b / 1e6).toFixed(1) : String(Math.round(b / 1e6))) + " MB";
/** A video's quality: "720p", "1080p" or "4K", and its frame rate above 30 ("1080p · 60 fps"). */
export const videoQuality = (r: { width: number; height: number; fps: number }) => (Math.min(r.width, r.height) >= 2000 ? "4K" : Math.min(r.width, r.height) >= 1000 ? "1080p" : "720p") + (r.fps > 30 ? ` · ${r.fps} fps` : "");
