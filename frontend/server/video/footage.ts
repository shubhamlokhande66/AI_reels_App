import type { UsableWindow } from "@/server/models/clip";

/** Which footage a shot may use (was backend/app/video/footage.py): only the good parts of a clip, never a moment
 * already shown - except a slowed-down replay when every good moment is used. */

export const OVERLAP_TOLERANCE = 0.1, MIN_SLOW = 0.5, REPLAY_SPEED = 0.6;
type Range = [number, number];
export type Span = [number, number, UsableWindow];

/** Usable windows with touching pieces of the same continuous shot joined again. */
export function joined(windows: UsableWindow[], gap = 0.08): UsableWindow[] {
  const out: UsableWindow[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    const prev = out[out.length - 1];
    if (prev && w.shot === prev.shot && w.start - prev.end >= 0 && w.start - prev.end <= gap) out[out.length - 1] = { ...prev, end: w.end, quality: Math.min(prev.quality, w.quality) };
    else out.push(w);
  }
  return out;
}

export const overlapSeconds = (a0: number, a1: number, used: Range[]) => used.reduce((s, [b0, b1]) => s + Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)), 0);
export const isFresh = (a0: number, a1: number, used: Range[]) => overlapSeconds(a0, a1, used) <= OVERLAP_TOLERANCE;

/** The good parts of a clip not shown yet. */
export function freeSpans(windows: UsableWindow[], used: Range[]): Span[] {
  const out: Span[] = [];
  const sortedUsed = [...used].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const w of windows) {
    let pieces: Range[] = [[w.start, w.end]];
    for (const [u0, u1] of sortedUsed) {
      const nxt: Range[] = [];
      for (const [p0, p1] of pieces) {
        if (u1 <= p0 || u0 >= p1) { nxt.push([p0, p1]); continue; }
        if (u0 > p0) nxt.push([p0, u0]);
        if (u1 < p1) nxt.push([u1, p1]);
      }
      pieces = nxt;
    }
    for (const [a, b] of pieces) if (b - a > 0.05) out.push([a, b, w]);
  }
  return out;
}

/** A fresh range of `need` seconds inside a good part, as close to `near` as possible (null = the best part). */
export function place(windows: UsableWindow[], need: number, used: Range[], near: number | null = null): Span | null {
  const spans = freeSpans(windows, used).filter((s) => s[1] - s[0] >= need - 1e-6);
  if (!spans.length) return null;
  if (near === null) {
    const best = spans.reduce((x, s) => (s[2].quality > x[2].quality || (s[2].quality === x[2].quality && s[1] - s[0] > x[1] - x[0]) ? s : x), spans[0]);
    return [best[0], best[0] + need, best[2]];
  }
  const startIn = (s: Span) => Math.min(Math.max(near, s[0]), s[1] - need);
  const best = spans.reduce((x, s) => (Math.abs(startIn(s) - near) < Math.abs(startIn(x) - near) ? s : x), spans[0]);
  const st = startIn(best);
  return [st, st + need, best[2]];
}

export function longestFree(windows: UsableWindow[], used: Range[]): Span | null {
  const spans = freeSpans(windows, used);
  return spans.length ? spans.reduce((x, s) => (s[1] - s[0] > x[1] - x[0] ? s : x), spans[0]) : null;
}
