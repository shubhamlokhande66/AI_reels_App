import { OVERLAY_MAX_CHARS, OVERLAY_MAX_WORDS, type TextOverlay } from "@/server/models/timeline";
import { round } from "@/server/core/py";

/** Text overlays (hook, benefit, CTA ...): tidy and lay out (was backend/app/video/overlays.py). Rendering to libass
 * lives with the renderer. */

export const MIN_SECONDS = 0.8;

/** Remove everything libass would read as a tag or a line break; keep letters of every script (product/textass.py). */
export function cleanText(text: string, limit = 80): string {
  return text.replace(/[\x00-\x1f\x7f{}\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

const EMOJI = /[🀀-🫿☀-➿⬀-⯿️‍󠀠-󠁿]/gu;
/** Emoji out: the video text engine draws them as grey outlines, not in colour. They belong in the post caption. */
export const stripEmoji = (text: string) => text.replace(EMOJI, "").replace(/s+/g, " ").trim();

/** Clean, no emoji, at most OVERLAY_MAX_WORDS words and OVERLAY_MAX_CHARS characters (cut at a word boundary). */
export function tidyText(text: string): string {
  const words = cleanText(stripEmoji(text), 200).split(" ").filter(Boolean).slice(0, OVERLAY_MAX_WORDS);
  let out = "";
  for (const w of words) {
    const next = `${out} ${w}`.trim();
    if (next.length > OVERLAY_MAX_CHARS) break;
    out = next;
  }
  return out;
}

/** Clamp into the Reel, enforce minimum time and no overlap. Returns [overlays, notes about what changed]. */
export function normalize(overlays: TextOverlay[], duration: number): [TextOverlay[], string[]] {
  const notes: string[] = [];
  const out: TextOverlay[] = [];
  const sorted = overlays.map((o, i) => [o, i] as const).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]).map(([o]) => o);
  for (const o of sorted) {
    const text = tidyText(o.text);
    if (!text) continue;
    if (text !== cleanText(o.text, 200)) notes.push(`Text "${o.text.slice(0, 30)}" was shortened to "${text}" (max ${OVERLAY_MAX_WORDS} words on screen).`);
    let start = Math.min(Math.max(o.start, 0), Math.max(duration - MIN_SECONDS, 0));
    const end = Math.min(Math.max(o.end, start + MIN_SECONDS), duration);
    const prev = out[out.length - 1];
    if (prev && start < prev.end) {
      start = prev.end;
      if (end - start < MIN_SECONDS) {
        notes.push(`Text "${text}" was dropped: it would overlap another text.`);
        continue;
      }
    }
    if (end - start < MIN_SECONDS - 1e-6) {
      notes.push(`Text "${text}" was dropped: too little time left to read it.`);
      continue;
    }
    out.push({ ...o, text, start: round(start, 3), end: round(end, 3) });
  }
  return [out, notes];
}
