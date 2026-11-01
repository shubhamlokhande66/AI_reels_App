import { round } from "../core/py";
import { withMats, type CV, type Mat } from "./cvOps";

/** Shot intelligence on the analyzer's small grey frames (was backend/app/video/shots.py): the subject (a face, or the
 * most salient region - spectral-residual saliency), shot size, composition for the 9:16 output, empty frames, and
 * camera vs subject motion. Heuristics, not a detector model. */

const SAL_SIZE = 64, EMPTY_EDGES = 0.012, CLOSE_FACE = 0.28, MEDIUM_FACE = 0.11, CLOSE_AREA = 0.3, MEDIUM_AREA = 0.1;
export type Box = [number, number, number, number];

export interface FrameLook { subject: Box | null; subjectStrength: number; edges: number; faceH: number | null; focus: number }
export const look = (subject: Box | null, subjectStrength: number, edges: number, faceH: number | null = null, focus = 1): FrameLook => ({ subject, subjectStrength, edges, faceH, focus });
export const isEmpty = (l: FrameLook) => l.edges < EMPTY_EDGES && l.faceH === null && l.subjectStrength < 0.35;
export const area = (l: FrameLook) => (l.subject ? Math.max(l.subject[2] - l.subject[0], 0) * Math.max(l.subject[3] - l.subject[1], 0) : 0);

/** Spectral-residual saliency map (SAL_SIZE x SAL_SIZE, 0..1). */
function saliency(cv: CV, gray: Mat): Float32Array {
  return withMats((keep) => {
    const small = keep(new cv.Mat());
    cv.resize(gray, small, new cv.Size(SAL_SIZE, SAL_SIZE), 0, 0, cv.INTER_AREA);
    const f32 = keep(new cv.Mat());
    small.convertTo(f32, cv.CV_32F);
    const F = keep(new cv.Mat());
    cv.dft(f32, F, cv.DFT_COMPLEX_OUTPUT);
    const fd = F.data32F as Float32Array;
    const n = SAL_SIZE * SAL_SIZE;
    const logAmp = keep(new cv.Mat(SAL_SIZE, SAL_SIZE, cv.CV_32F));
    const la = logAmp.data32F as Float32Array;
    const angle = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const re = fd[2 * i], im = fd[2 * i + 1];
      la[i] = Math.log(Math.hypot(re, im) + 1e-6);
      angle[i] = Math.atan2(im, re);
    }
    const blurred = keep(new cv.Mat());
    cv.blur(logAmp, blurred, new cv.Size(3, 3));
    const bd = blurred.data32F as Float32Array;
    const Z = keep(new cv.Mat(SAL_SIZE, SAL_SIZE, cv.CV_32FC2));
    const zd = Z.data32F as Float32Array;
    for (let i = 0; i < n; i++) {
      const m = Math.exp(la[i] - bd[i]);
      zd[2 * i] = m * Math.cos(angle[i]);
      zd[2 * i + 1] = m * Math.sin(angle[i]);
    }
    const inv = keep(new cv.Mat());
    cv.dft(Z, inv, cv.DFT_INVERSE | cv.DFT_SCALE | cv.DFT_COMPLEX_OUTPUT);
    const id = inv.data32F as Float32Array;
    const sal = keep(new cv.Mat(SAL_SIZE, SAL_SIZE, cv.CV_32F));
    const sd = sal.data32F as Float32Array;
    for (let i = 0; i < n; i++) sd[i] = id[2 * i] ** 2 + id[2 * i + 1] ** 2;
    const smooth = keep(new cv.Mat());
    cv.GaussianBlur(sal, smooth, new cv.Size(9, 9), 2.5);
    const out = Float32Array.from(smooth.data32F as Float32Array);
    let hi = 0;
    for (const v of out) hi = Math.max(hi, v);
    return hi > 1e-12 ? out.map((v) => v / hi) : new Float32Array(n);
  });
}

/** The box around the most salient blob and how strongly it stands out. */
function salientBox(cv: CV, gray: Mat): [Box | null, number] {
  const sal = saliency(cv, gray);
  let mean = 0;
  for (const v of sal) mean += v;
  mean /= sal.length;
  if (mean <= 1e-9) return [null, 0];
  return withMats((keep) => {
    const thr = Math.max(3 * mean, 0.25);
    const mask = keep(new cv.Mat(SAL_SIZE, SAL_SIZE, cv.CV_8UC1));
    const md = mask.data as Uint8Array;
    for (let i = 0; i < sal.length; i++) md[i] = sal[i] > thr ? 1 : 0;
    const labels = keep(new cv.Mat()), stats = keep(new cv.Mat()), cents = keep(new cv.Mat());
    const n = cv.connectedComponentsWithStats(mask, labels, stats, cents, 8);
    if (n <= 1) return [null, 0] as [Box | null, number];
    const lab = labels.data32S as Int32Array;
    const st = (i: number, k: number) => stats.intAt(i, k);
    const sums = new Float64Array(n), counts = new Float64Array(n);
    for (let i = 0; i < lab.length; i++) { sums[lab[i]] += sal[i]; counts[lab[i]]++; }
    const weight = Array.from({ length: n - 1 }, (_, k) => st(k + 1, cv.CC_STAT_AREA) * (sums[k + 1] / Math.max(counts[k + 1], 1)));
    const top = Math.max(...weight);
    const keepIds = weight.map((w, k) => [w, k + 1] as const).filter(([w]) => w >= 0.25 * top).map(([, i]) => i);
    const x0 = Math.min(...keepIds.map((i) => st(i, cv.CC_STAT_LEFT))), y0 = Math.min(...keepIds.map((i) => st(i, cv.CC_STAT_TOP)));
    const x1 = Math.max(...keepIds.map((i) => st(i, cv.CC_STAT_LEFT) + st(i, cv.CC_STAT_WIDTH))), y1 = Math.max(...keepIds.map((i) => st(i, cv.CC_STAT_TOP) + st(i, cv.CC_STAT_HEIGHT)));
    const ids = new Set(keepIds);
    let inSum = 0, inCount = 0;
    for (let i = 0; i < lab.length; i++) if (ids.has(lab[i])) { inSum += sal[i]; inCount++; }
    const strength = Math.min(Math.max((inSum / Math.max(inCount, 1) / mean - 1.5) / 4, 0), 1);
    const s = SAL_SIZE, w = (x1 - x0) / s, h = (y1 - y0) / s;
    if (Math.max(w, h) > 0.85 && Math.min(w, h) / Math.max(w, h) < 0.45) return [null, 0] as [Box | null, number];
    const touches = [x0 <= 1, y0 <= 1, x1 >= SAL_SIZE - 1, y1 >= SAL_SIZE - 1].filter(Boolean).length;
    if (touches >= 2 && w * h >= 0.45) return [null, 0] as [Box | null, number];
    const fill = inCount / Math.max((x1 - x0) * (y1 - y0), 1);
    if (w * h > 0.2 && fill < 0.15 && keepIds.length >= 4) return [null, 0] as [Box | null, number];
    return [[x0 / s, y0 / s, x1 / s, y1 / s], round(strength, 3)] as [Box | null, number];
  });
}

function focusRatio(cv: CV, gray: Mat, box: Box): number {
  return withMats((keep) => {
    const h = gray.rows, w = gray.cols;
    const x0 = Math.trunc(box[0] * w), y0 = Math.trunc(box[1] * h);
    const x1 = Math.max(Math.trunc(box[2] * w), x0 + 1), y1 = Math.max(Math.trunc(box[3] * h), y0 + 1);
    const lap = keep(new cv.Mat());
    cv.Laplacian(gray, lap, cv.CV_32F);
    const d = lap.data32F as Float32Array;
    let inS = 0, inN = 0, outS = 0, outN = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = Math.abs(d[y * w + x]);
      if (y >= y0 && y < y1 && x >= x0 && x < x1) { inS += v; inN++; } else { outS += v; outN++; }
    }
    if (!inN || outN < 0.05 * w * h) return 1;
    return round(inS / inN / Math.max(outS / outN, 1e-3), 3);
  });
}

export function lookOf(cv: CV, gray: Mat, faceBox: Box | null = null): FrameLook {
  const edges = withMats((keep) => {
    const e = keep(new cv.Mat());
    cv.Canny(gray, e, 60, 160);
    return cv.countNonZero(e) / (e.rows * e.cols);
  });
  if (faceBox) return look(faceBox, 1, edges, faceBox[3] - faceBox[1]);
  const [box, strength] = salientBox(cv, gray);
  return look(box, strength, edges, null, box ? focusRatio(cv, gray, box) : 1);
}

export function shotSize(l: FrameLook): "close" | "medium" | "wide" {
  if (l.faceH !== null) return l.faceH >= CLOSE_FACE ? "close" : l.faceH >= MEDIUM_FACE ? "medium" : "wide";
  if (!l.subject || l.subjectStrength < 0.15 || isEmpty(l)) return "wide";
  if (l.focus < 1.15) return "wide";
  const a = area(l);
  return a >= CLOSE_AREA ? "close" : a >= MEDIUM_AREA ? "medium" : "wide";
}

export function composition(l: FrameLook): number {
  if (isEmpty(l)) return 0.15;
  if (!l.subject || l.subjectStrength < 0.15) return 0.5;
  const [x0, y0, x1, y1] = l.subject;
  const cy = (y0 + y1) / 2, cx = (x0 + x1) / 2;
  const placeY = 1 - Math.min(Math.abs(cy - 1 / 3), Math.abs(cy - 0.5)) / 0.35;
  const placeX = 1 - Math.max(Math.abs(cx - 0.5) - 0.3, 0) / 0.2;
  const margin = 0.02;
  const cut = [x0, y0].filter((v) => v <= margin).length + [x1, y1].filter((v) => v >= 1 - margin).length;
  let notCut = 1 - Math.min(cut, 2) / 2;
  if (l.faceH !== null) notCut = Math.min(notCut, y0 > 0.03 ? 1 : 0.4);
  const size = l.faceH === null ? Math.min(area(l) / 0.06, 1) : Math.min(l.faceH / 0.08, 1);
  return round(Math.min(Math.max(0.35 * Math.max(placeY, 0) + 0.1 * Math.max(placeX, 0) + 0.3 * notCut + 0.25 * size, 0), 1), 3);
}

export function subjectValue(l: FrameLook): number {
  if (isEmpty(l) || !l.subject) return 0;
  if (l.faceH !== null) return round(Math.min(0.6 + l.faceH * 1.5, 1), 3);
  const a = area(l);
  const size = Math.min(a / 0.15, 1) * (a < 0.85 ? 1 : 0.5);
  const standsOut = Math.min(Math.max((l.focus - 0.9) / 0.6, 0.2), 1);
  return round(l.subjectStrength * (0.4 + 0.6 * size) * standsOut, 3);
}

/** Movement left after compensating the camera's global shift (mean absolute difference, 0..1 raw). */
export function subjectMotion(cv: CV, prev: Mat, cur: Mat, shiftPx: [number, number] | null): number {
  return withMats((keep) => {
    let p = prev;
    if (shiftPx) {
      const m = keep(cv.matFromArray(2, 3, cv.CV_32F, [1, 0, shiftPx[0], 0, 1, shiftPx[1]]));
      p = keep(new cv.Mat());
      cv.warpAffine(prev, p, m, new cv.Size(prev.cols, prev.rows), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    }
    const h = cur.rows, w = cur.cols;
    const by = Math.max(Math.trunc(h * 0.06), 1), bx = Math.max(Math.trunc(w * 0.06), 1);
    const d = keep(new cv.Mat());
    cv.absdiff(p, cur, d);
    const dd = d.data as Uint8Array;
    let s = 0, n = 0;
    for (let y = by; y < h - by; y++) for (let x = bx; x < w - bx; x++) { s += dd[y * w + x]; n++; }
    return n ? s / n / 255 : 0;
  });
}

/** 0..1 from the global shift (share of the frame per sample): ~30% of the frame per second reads as a fast move. */
export function cameraScore(shift: [number, number] | null, dt: number): number {
  if (!shift || dt <= 0) return 0;
  return round(1 - Math.exp(-Math.hypot(...shift) / dt / 0.12), 3);
}
