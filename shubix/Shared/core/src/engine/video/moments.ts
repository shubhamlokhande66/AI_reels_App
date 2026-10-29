import { fixed, round } from "../core/py";
import type { BestSegment, Moment, MomentKind, UsableWindow } from "../models/clip";

/** Best moments - the instants of a clip worth cutting to - and short spans built around them (was
 * backend/app/video/moments.py): action peaks, camera settling, faces appearing, focus landing, the subject filling the
 * frame, reveals. Only moments inside usable windows count. */

const MAX_MOMENTS = 12, MAX_SEGMENTS = 6, MIN_GAP = 0.6, SEG_BEFORE = 0.7, SEG_AFTER = 1.3, PLAIN_SEG = 2;
const PRODUCT_CATEGORIES = ["product", "jewelry", "fashion", "beauty"];
export const REASONS: Record<MomentKind, string> = {
  action_peak: "the movement peaks", camera_settles: "the camera move arrives and settles", face_appears: "a face turns up",
  focus_peak: "the picture snaps into focus", subject_close: "the subject fills the frame", reveal: "the picture goes from empty to showing something",
};

const windowAt = (windows: UsableWindow[], t: number) => windows.find((w) => w.start - 1e-6 <= t && t <= w.end + 1e-6) ?? null;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

function localPeaks(x: number[], minRise: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length - 1; i++) {
    if (x[i] >= x[i - 1] && x[i] > x[i + 1]) {
      const lo = Math.min(Math.min(...x.slice(Math.max(i - 4, 0), i)), Math.min(...x.slice(i + 1, i + 5)));
      if (x[i] - lo >= minRise) out.push(i);
    }
  }
  return out;
}

const byDesc = <T,>(xs: T[], key: (x: T) => number) => xs.map((x, i) => [x, i] as const).sort((a, b) => key(b[0]) - key(a[0]) || a[1] - b[1]).map(([x]) => x);

export function detectMoments(times: number[], subjMotion: number[], camera: number[], faces: boolean[], sharp: number[], areas: number[], empty: boolean[],
                              windows: UsableWindow[], sceneCuts: boolean[] = []): Moment[] {
  const n = times.length;
  if (n < 3 || !windows.length) return [];
  const t = times, sm = subjMotion, cam = camera, sh = sharp, ar = areas;
  const cuts = sceneCuts.length === n ? sceneCuts : new Array(n).fill(false);
  const raw: [number, MomentKind, number][] = [];
  const typical = median(sm) + 1e-4;
  const rel = sm.map((v) => v / typical);
  const peaks = localPeaks(rel, 0.6).filter((i) => rel[i] >= 1.8 && sm[i] >= 0.004);
  for (const i of byDesc(peaks, (i) => rel[i]).slice(0, Math.max(2, Math.trunc((t[n - 1] - t[0]) / 3)))) raw.push([t[i], "action_peak", Math.min(0.4 + 0.15 * rel[i], 1)]);
  for (let i = 2; i < n; i++) {
    if (cuts[i] || cuts[i - 1]) continue;
    const before = cam.slice(Math.max(i - 4, 0), i);
    const m = before.reduce((a, b) => a + b, 0) / Math.max(before.length, 1);
    if (before.length >= 2 && m >= 0.35 && cam[i] < 0.15) raw.push([t[i], "camera_settles", Math.min(m + 0.3, 1)]);
  }
  for (let i = 1; i < n; i++) if (faces[i] && !faces.slice(Math.max(i - 3, 0), i).some(Boolean) && !cuts[i]) raw.push([t[i], "face_appears", 0.8]);
  for (const i of localPeaks(sh, 0.2)) if (Math.min(...sh.slice(Math.max(i - 4, 0), i)) < 0.55) raw.push([t[i], "focus_peak", sh[i]]);
  const arMax = Math.max(...ar);
  if (arMax > 0.12) {
    const med = median(ar);
    const top = localPeaks(ar, 0.12).filter((i) => ar[i] >= 0.85 * arMax && ar[i] - med >= 0.1);
    for (const i of byDesc(top, (i) => ar[i]).slice(0, 2)) raw.push([t[i], "subject_close", Math.min(ar[i] * 1.5, 1)]);
  }
  for (let i = 2; i < n; i++) if (!empty[i] && empty.slice(Math.max(i - 3, 0), i).every(Boolean) && !cuts[i]) raw.push([t[i], "reveal", 0.75]);
  const out: Moment[] = [];
  for (const [tm, kind, strength] of byDesc(raw, (r) => r[2])) {
    const w = windowAt(windows, tm);
    if (!w || out.some((m) => Math.abs(m.t - tm) < MIN_GAP)) continue;
    out.push({ t: round(tm, 3), kind, score: round(strength * (0.5 + 0.5 * w.quality), 3), reason: REASONS[kind] });
    if (out.length >= MAX_MOMENTS) break;
  }
  return out.sort((a, b) => a.t - b.t);
}

const spanValue = (w: UsableWindow) => 0.45 * w.quality + 0.25 * w.composition + 0.2 * w.subject + 0.1 * (1 - w.empty);

/** Short spans (about 1-3 s), each inside one usable window, best first, never overlapping. */
export function bestSegments(windows: UsableWindow[], moments: Moment[]): BestSegment[] {
  const cands: BestSegment[] = [];
  for (const m of moments) {
    const w = windowAt(windows, m.t);
    if (!w) continue;
    const a = Math.max(m.t - SEG_BEFORE, w.start), b = Math.min(m.t + SEG_AFTER, w.end);
    if (b - a < 0.5) continue;
    cands.push({ start: round(a, 2), end: round(b, 2), score: round(0.55 * spanValue(w) + 0.45 * m.score, 3), moment: m.kind, reason: `${REASONS[m.kind]} at ${fixed(m.t, 1)}s` });
  }
  for (const w of windows) {
    if (w.end - w.start < 0.5) continue;
    let mid = (w.start + w.end) / 2;
    if (w.motionCurve.length) mid = w.start + w.motionCurve.indexOf(Math.max(...w.motionCurve)) * w.curveDt;
    const half = Math.min(PLAIN_SEG, w.end - w.start) / 2;
    const a = Math.min(Math.max(mid - half, w.start), w.end - 2 * half);
    cands.push({ start: round(a, 2), end: round(a + 2 * half, 2), score: round(0.85 * spanValue(w), 3), moment: null, reason: w.shotSize !== "unknown" ? `${w.shotSize} shot, clean picture` : "clean picture" });
  }
  const out: BestSegment[] = [];
  for (const c of byDesc(cands, (c) => c.score)) {
    if (out.every((o) => c.end <= o.start + 0.1 || c.start >= o.end - 0.1)) out.push(c);
    if (out.length >= MAX_SEGMENTS) break;
  }
  return out;
}

/** How clearly the product is on screen (for clips the vision model says show a product); null otherwise. */
export function productVisibility(windows: UsableWindow[], category: string | null): number | null {
  if (!category || !PRODUCT_CATEGORIES.includes(category) || !windows.length) return null;
  let best = 0;
  for (const w of windows) {
    const framing = ({ close: 1, medium: 0.8, wide: 0.5 } as Record<string, number>)[w.shotSize] ?? 0.6;
    best = Math.max(best, (0.5 * w.subject + 0.2 * w.composition + 0.3 * w.quality) * framing * (1 - 0.7 * w.empty));
  }
  return round(Math.min(best * 1.15, 1), 3);
}
