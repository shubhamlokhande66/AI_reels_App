import { round } from "../core/py";
import { clipDefaults, windowDefaults, windowLength, type ClipAnalysis, type UsableWindow } from "../models/clip";
import { bgrMat, phaseCorrelate, withMats, type CV, type Mat } from "./cvOps";
import { joined } from "./footage";
import * as mom from "./moments";
import * as shots from "./shots";

/** Video analysis (was backend/app/video/analyzer.py, OpenCV): the real picture inside any padding, then about four
 * frames a second measured for exposure, sharpness, motion, camera shift, faces and composition, turned into usable
 * windows, scores, flags and best moments.
 *
 * This is the shared core: it runs on the server (frames from FFmpeg, server/video/analyzer.ts) and in the browser
 * (frames from the phone's own decoder, lib/clipAnalysis), so both give the same result. It needs no Node.js: whatever
 * decodes frames, loads OpenCV and finds faces is passed in (AnalysisDeps). */

/** The clip's facts the analysis needs (server/media/probe.ts VideoMetadata). */
export interface VideoMetadata {
  duration: number; width: number; height: number; fps: number; codec: string; hasAudio: boolean; rotation: number;
  bitRate: number | null; orientation: "square" | "landscape" | "portrait";
}
export type FaceBox = [number, number, number, number];
export interface FrameSpec {
  step: number;
  /** normalised x0, y0, x1, y1 of the picture to keep, in the decoded (rotated) frame; null = all of it */
  rect: [number, number, number, number] | null;
  srcW: number; srcH: number; width: number; height: number;
  /** one byte per pixel (grey) instead of three (BGR) */
  gray?: boolean;
  /** only these frame numbers (instead of every step-th) */
  frames?: number[];
}
export interface AnalysisDeps {
  cv: CV;
  /** frames n (0, step, 2*step... or `frames`), scaled to width x height: BGR, or grey with `gray` */
  readFrames(spec: FrameSpec): AsyncIterable<{ n: number; data: Uint8Array }>;
  /** the largest face (x, y, w, h in pixels) in one small frame, or null */
  findFace(gray: Uint8Array, bgr: Uint8Array, w: number, h: number): Promise<FaceBox | null>;
  /** called after every frame: lets a server answer other requests, or a page stay responsive */
  breathe?(): Promise<void>;
}
export class NoFrames extends Error {
  code = "CORRUPTED_MEDIA";
  constructor() { super("No frames could be decoded from this video."); }
}

export const VIDEO_ANALYSIS_VERSION = 3;
const SAMPLE_FPS = 4, MAX_SAMPLES = 320, ANALYSIS_WIDTH = 320, WINDOW_MAX_SECONDS = 6, MIN_WINDOW_SECONDS = 0.5, MIN_CLIP_SECONDS = 1;
const DARK_LEVEL = 0.12, BRIGHT_LEVEL = 0.93, BLUR_VARIANCE = 20;
const RECT_FRAMES = 24, RECT_SPREAD_MAX = 8, RECT_ROW_FRACTION = 0.6, RECT_MIN_AREA = 0.12, RECT_MAX_AREA = 0.93;
const GOOD_WIDTH = 720, BLOCKING_WIDTH = 240, LOW_RES_WIDTH = 540;
type Rect = [number, number, number, number];

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(xs.length, 1);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const pct = (xs: ArrayLike<number>, q: number) => { const s = Float64Array.from(xs).sort(); const p = (q / 100) * (s.length - 1); const lo = Math.floor(p); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo); };

// ---------------------------------------------------------------- content rect
function longestRun(flags: boolean[], maxGap: number): [number, number] | null {
  let best: [number, number] | null = null, start: number | null = null, last = -1;
  flags.forEach((f, i) => {
    if (!f) return;
    if (start === null || i - last - 1 > maxGap) start = i;
    last = i;
    if (!best || last - start > best[1] - best[0]) best = [start, last];
  });
  return best;
}

/** The real picture inside solid padding, normalised (x0, y0, x1, y1), or null. `frames` are grey, h x w. */
export function findContentRect(frames: Uint8Array[], w: number, h: number): Rect | null {
  if (!frames.length) return null;
  const F = frames.length;
  const px = (f: number, y: number, x: number) => frames[f][y * w + x];
  const rh = Math.max(2, Math.trunc(h * 0.01)), rw = Math.max(2, Math.trunc(w * 0.01));
  const flatColour = (ring: number[]) => { const bg = median(ring); return pct(ring.map((v) => Math.abs(v - bg)), 90) <= RECT_SPREAD_MAX ? bg : null; };
  const tb: number[] = [], lr: number[] = [];
  for (let f = 0; f < F; f++) {
    for (let y = 0; y < rh; y++) for (let x = 0; x < w; x++) tb.push(px(f, y, x));
    for (let y = h - rh; y < h; y++) for (let x = 0; x < w; x++) tb.push(px(f, y, x));
    for (let y = 0; y < h; y++) { for (let x = 0; x < rw; x++) lr.push(px(f, y, x)); for (let x = w - rw; x < w; x++) lr.push(px(f, y, x)); }
  }
  const bgTb = flatColour(tb), bgLr = flatColour(lr);
  let r0 = 0, r1 = h - 1, c0 = 0, c1 = w - 1;
  if (bgTb !== null) {
    const rows = Array.from({ length: h }, (_, y) => median(Array.from({ length: F }, (_, f) => { let c = 0; for (let x = 0; x < w; x++) if (Math.abs(px(f, y, x) - bgTb) > 20) c++; return c / w; })) >= RECT_ROW_FRACTION);
    const run = longestRun(rows, Math.max(2, Math.trunc(h * 0.02)));
    if (!run) return null;
    [r0, r1] = run;
  }
  if (bgLr !== null) {
    const cols = Array.from({ length: w }, (_, x) => median(Array.from({ length: F }, (_, f) => { let c = 0; for (let y = r0; y <= r1; y++) if (Math.abs(px(f, y, x) - bgLr) > 20) c++; return c / (r1 - r0 + 1); })) >= RECT_ROW_FRACTION);
    const run = longestRun(cols, Math.max(2, Math.trunc(w * 0.02)));
    if (!run) return null;
    [c0, c1] = run;
  }
  // trim thin flat white / black lines along the edges
  const flatLine = (pts: [number, number][]) => {
    const med = pts.map(([y, x]) => median(Array.from({ length: F }, (_, f) => px(f, y, x))));
    const m = meanOf(med);
    const sd = Math.sqrt(meanOf(med.map((v) => (v - m) ** 2)));
    return sd < 10 && (m > 225 || m < 25);
  };
  const col = (x: number) => Array.from({ length: r1 - r0 + 1 }, (_, k) => [r0 + k, x] as [number, number]);
  const row = (y: number) => Array.from({ length: c1 - c0 + 1 }, (_, k) => [y, c0 + k] as [number, number]);
  for (let k = 0; k < Math.trunc(w * 0.04) && c1 - c0 > 8 && flatLine(col(c0)); k++) c0++;
  for (let k = 0; k < Math.trunc(w * 0.04) && c1 - c0 > 8 && flatLine(col(c1)); k++) c1--;
  for (let k = 0; k < Math.trunc(h * 0.04) && r1 - r0 > 8 && flatLine(row(r0)); k++) r0++;
  for (let k = 0; k < Math.trunc(h * 0.04) && r1 - r0 > 8 && flatLine(row(r1)); k++) r1--;
  const trimmed = (r0 + (h - 1 - r1)) / h + (c0 + (w - 1 - c1)) / w;
  const area = ((r1 - r0 + 1) * (c1 - c0 + 1)) / (h * w);
  if (trimmed < 0.008 || area > RECT_MAX_AREA || area < RECT_MIN_AREA) return null;
  const insetX = c0 > 0 || c1 < w - 1 ? Math.max(1, Math.trunc(w * 0.006)) : 0;
  const insetY = r0 > 0 || r1 < h - 1 ? Math.max(1, Math.trunc(h * 0.006)) : 0;
  const x0 = (c0 + insetX) / w, x1 = (c1 + 1 - insetX) / w, y0 = (r0 + insetY) / h, y1 = (r1 + 1 - insetY) / h;
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
}

const scaled = (w: number, h: number): [number, number] => { const s = w > ANALYSIS_WIDTH ? ANALYSIS_WIDTH / w : 1; return [Math.max(Math.trunc(w * s), 8), Math.max(Math.trunc(h * s), 8)]; };

async function detectContentRect(deps: AnalysisDeps, meta: VideoMetadata): Promise<Rect | null> {
  const total = Math.max(Math.trunc(meta.duration * (meta.fps || 30)), 1);
  const wanted = [...new Set(Array.from({ length: RECT_FRAMES }, (_, i) => Math.trunc((total * (i + 0.5)) / RECT_FRAMES)))];
  const [w, h] = scaled(meta.width, meta.height);
  const frames: Uint8Array[] = [];
  try {
    for await (const f of deps.readFrames({ step: 1, frames: wanted, rect: null, srcW: meta.width, srcH: meta.height, width: w, height: h, gray: true })) frames.push(f.data);
  } catch {
    return null;
  }
  return frames.length < 4 ? null : findContentRect(frames, w, h);
}

// ---------------------------------------------------------------- sampling
interface Sample {
  t: number; brightness: number; sharpVar: number; hist: Float32Array; motion: number; focusX: number; focusY: number; hasFocus: boolean;
  face: [number, number] | null; faceBox: shots.Box | null; shift: [number, number] | null; look: shots.FrameLook | null; subjMotion: number;
  camera: number; sceneCut: boolean; duplicate: boolean;
}

function hsvHist(cv: CV, bgr: Mat): Float32Array {
  return withMats((keep) => {
    const hsv = keep(new cv.Mat());
    cv.cvtColor(bgr, hsv, cv.COLOR_BGR2HSV);
    const vec = keep(new cv.MatVector());
    vec.push_back(hsv);
    const hist = keep(new cv.Mat()), mask = keep(new cv.Mat());
    cv.calcHist(vec, [0, 1], mask, hist, [8, 3], [0, 180, 0, 256]);
    const h = Float32Array.from(hist.data32F as Float32Array);
    let total = 0;
    for (const v of h) total += v;
    return total ? h.map((v) => v / total) : h;
  });
}

function compareHistCorrel(a: Float32Array, b: Float32Array): number {
  const ma = meanOf(Array.from(a)), mb = meanOf(Array.from(b));
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return Math.abs(da * db) > Number.EPSILON ? num / Math.sqrt(da * db) : 1;
}

const scoreBrightness = (b: number) => Math.max(0, 1 - Math.abs(b - 0.5) / 0.5);
const scoreSharpness = (v: number) => 1 - Math.exp(-Math.max(v, 0) / 120);
const scoreMotion = (d: number) => 1 - Math.exp(-Math.max(d, 0) / 0.03);

async function sampleVideo(deps: AnalysisDeps, meta: VideoMetadata, progress: ((f: number) => void) | null, rect: Rect | null): Promise<Sample[]> {
  const cv = deps.cv;
  const fps = meta.fps || 30;
  const total = Math.max(Math.trunc(meta.duration * fps), 1);
  const step = Math.max(Math.max(round(fps / SAMPLE_FPS), 1), Math.ceil(total / MAX_SAMPLES));
  let cw = meta.width, ch = meta.height;
  if (rect) { cw = Math.trunc(rect[2] * meta.width) - Math.trunc(rect[0] * meta.width); ch = Math.trunc(rect[3] * meta.height) - Math.trunc(rect[1] * meta.height); }
  const s = cw > ANALYSIS_WIDTH ? ANALYSIS_WIDTH / cw : 1;
  const w = Math.trunc(cw * s), h = Math.trunc(ch * s);
  const samples: Sample[] = [];
  const faceJobs: Promise<void>[] = [];
  let prevGray: Mat | null = null, prevHist: Float32Array | null = null;
  try {
    for await (const frame of deps.readFrames({ step, rect, srcW: meta.width, srcH: meta.height, width: w, height: h })) {
      const small = bgrMat(cv, frame.data, w, h);
      const gray = new cv.Mat();
      cv.cvtColor(small, gray, cv.COLOR_BGR2GRAY);
      const hist = hsvHist(cv, small);
      const [brightness, sharpVar] = withMats((keep) => {
        const lap = keep(new cv.Mat()), mean = keep(new cv.Mat()), sd = keep(new cv.Mat());
        cv.Laplacian(gray, lap, cv.CV_64F);
        cv.meanStdDev(lap, mean, sd);
        return [cv.mean(gray)[0] / 255, sd.doubleAt(0, 0) ** 2];
      });
      const smp: Sample = { t: frame.n / fps, brightness, sharpVar, hist, motion: 0, focusX: 0.5, focusY: 0.5, hasFocus: false, face: null, faceBox: null, shift: null, look: null, subjMotion: 0, camera: 0, sceneCut: false, duplicate: false };
      if (prevGray && prevHist && prevGray.rows === gray.rows && prevGray.cols === gray.cols) {
        const pg: Mat = prevGray;
        withMats((keep) => {
          const diff = keep(new cv.Mat());
          cv.absdiff(gray, pg, diff);
          smp.motion = cv.mean(diff)[0] / 255;
          const corr = compareHistCorrel(hist, prevHist!);
          smp.sceneCut = (corr < 0.55 && smp.motion > 0.08) || smp.motion > 0.3;
          smp.duplicate = smp.motion < 0.0015;
          if (!smp.sceneCut) {
            const dd = diff.data as Uint8Array;
            let n = 0, sx = 0, sy = 0;
            for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dd[y * w + x] > 25) { n++; sx += x; sy += y; }
            if (n > 20) { smp.focusX = sx / n / w; smp.focusY = sy / n / h; smp.hasFocus = true; }
            let dxdy: [number, number] | null = null;
            if (!smp.duplicate) {
              const [dx, dy, resp] = phaseCorrelate(cv, pg, gray);
              if (resp > 0.03) { smp.shift = [dx / w, dy / h]; dxdy = [dx, dy]; }
            }
            smp.subjMotion = !smp.duplicate ? shots.subjectMotion(cv, pg, gray, smp.shift ? dxdy : null) : 0;
            smp.camera = shots.cameraScore(smp.shift, step / fps);
          }
        });
      }
      if (samples.length % 2 === 0) {
        // faces are looked for on every other sample, in the worker pool, while sampling goes on
        faceJobs.push(deps.findFace(gray.data as Uint8Array, frame.data, w, h).then((best) => {
          if (!best) return;
          const [fx, fy, fw, fh] = best;
          smp.face = [(fx + fw / 2) / w, (fy + fh / 2) / h];
          smp.faceBox = [fx / w, fy / h, (fx + fw) / w, (fy + fh) / h];
        }));
      }
      smp.look = shots.lookOf(cv, gray, null);
      samples.push(smp);
      small.delete();
      prevGray?.delete();
      prevGray = gray;
      prevHist = hist;
      progress?.(Math.min(frame.n / total, 1));
      // buffered frames would otherwise be worked through back to back: let other work in between frames
      await deps.breathe?.();
    }
  } finally {
    prevGray?.delete();
    await Promise.allSettled(faceJobs);
  }
  await Promise.all(faceJobs);
  if (!samples.length) throw new NoFrames();
  return samples;
}

function iou(a: shots.Box, b: shots.Box): number {
  const ix = Math.max(Math.min(a[2], b[2]) - Math.max(a[0], b[0]), 0), iy = Math.max(Math.min(a[3], b[3]) - Math.max(a[1], b[1]), 0);
  const inter = ix * iy, union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/** A face counts only when the neighbouring detection finds one in about the same place (cascades fire on textures). */
function confirmFaces(samples: Sample[]) {
  const det = Array.from({ length: Math.ceil(samples.length / 2) }, (_, k) => 2 * k);
  const boxes = new Map(det.map((i) => [i, samples[i].faceBox]));
  det.forEach((i, k) => {
    const b = boxes.get(i);
    if (!b) return;
    const near = [k - 1, k + 1].filter((j) => j >= 0 && j < det.length).map((j) => boxes.get(det[j]));
    if (!near.some((o) => o && iou(b, o) > 0.1)) { samples[i].faceBox = null; samples[i].face = null; }
  });
  for (let i = 1; i < samples.length; i += 2) samples[i].faceBox = samples[i - 1].faceBox;
  for (const s of samples) if (s.faceBox && s.look) s.look = shots.look(s.faceBox, 1, s.look.edges, s.faceBox[3] - s.faceBox[1]);
}

// ---------------------------------------------------------------- scoring
function shakeScore(samples: Sample[]): number {
  const deltas: number[] = [];
  let prev: [number, number] | null = null;
  for (const s of samples) {
    if (!s.shift || s.sceneCut) { prev = null; continue; }
    if (prev) deltas.push(Math.hypot(s.shift[0] - prev[0], s.shift[1] - prev[1]));
    prev = s.shift;
  }
  return deltas.length ? Math.min(meanOf(deltas) / 0.04, 1) : 0;
}

function pan(ch: Sample[], dt: number): [number, number] {
  const shifts = ch.map((s) => s.shift).filter((x): x is [number, number] => x !== null);
  if (shifts.length < Math.max(2, Math.trunc(ch.length / 3))) return [0, 0];
  return [round(median(shifts.map((s) => s[0])) / dt, 3), round(median(shifts.map((s) => s[1])) / dt, 3)];
}

function windowFrom(ch: Sample[], start: number, end: number, shot: number, dt: number, shake: number, resFactor: number): UsableWindow {
  const bright = meanOf(ch.map((s) => s.brightness));
  const sharp = meanOf(ch.map((s) => scoreSharpness(s.sharpVar)));
  const motionCurve = ch.map((s) => round(scoreMotion(s.motion), 3));
  const motion = meanOf(motionCurve);
  const dup = meanOf(ch.map((s) => (s.duplicate ? 1 : 0)));
  const faces = ch.map((s) => s.face).filter((f): f is [number, number] => f !== null);
  const face = faces.length >= Math.max(1, Math.floor(ch.length / 4));
  let source: UsableWindow["focusSource"] = "center", fx = 0.5, fy = 0.5;
  if (face) {
    source = "face";
    fx = meanOf(faces.map((f) => f[0]));
    fy = meanOf(faces.map((f) => f[1]));
  } else {
    const pts = ch.filter((s) => s.hasFocus);
    if (pts.length) {
      source = "motion";
      const wts = pts.map((p) => Math.max(p.motion, 1e-4));
      const sw = wts.reduce((a, b) => a + b, 0);
      fx = pts.reduce((a, p, i) => a + p.focusX * wts[i], 0) / sw;
      fy = pts.reduce((a, p, i) => a + p.focusY * wts[i], 0) / sw;
    }
  }
  const quality = (0.45 * sharp + 0.25 * scoreBrightness(bright) + 0.15 * (1 - shake) + 0.15 * (1 - dup)) * resFactor;
  const sig = Array.from({ length: ch[0].hist.length }, (_, k) => meanOf(ch.map((s) => s.hist[k])));
  const [panX, panY] = pan(ch, dt);
  const looks = ch.map((s) => s.look).filter((l): l is shots.FrameLook => l !== null);
  const sizes = looks.map(shots.shotSize);
  const size = sizes.length ? (["close", "medium", "wide"] as const).reduce((best, k) => (sizes.filter((x) => x === k).length > sizes.filter((x) => x === best).length ? k : best), "close" as "close" | "medium" | "wide") : "unknown";
  return windowDefaults({
    start: round(start, 3), end: round(end, 3), quality: round(quality, 3), motion: round(motion, 3), brightness: round(bright, 3), sharpness: round(sharp, 3),
    focusX: round(Math.min(Math.max(fx, 0), 1), 3), focusY: round(Math.min(Math.max(fy, 0), 1), 3), face, focusSource: source, signature: sig.map((x) => round(x, 4)),
    shot, motionCurve, curveDt: round(dt, 4), panX, panY, shotSize: size,
    composition: looks.length ? round(meanOf(looks.map(shots.composition)), 3) : 0.5, subject: looks.length ? round(meanOf(looks.map(shots.subjectValue)), 3) : 0,
    cameraMotion: round(meanOf(ch.map((s) => s.camera)), 3), subjectMotion: round(meanOf(ch.map((s) => scoreMotion(s.subjMotion))), 3),
    empty: looks.length ? round(meanOf(looks.map((l) => (shots.isEmpty(l) ? 1 : 0))), 3) : 0,
  });
}

function buildWindows(samples: Sample[], duration: number, shake: number, resFactor: number): UsableWindow[] {
  if (!samples.length) return [];
  let dt = duration / Math.max(samples.length, 1);
  if (samples.length > 1) dt = median(samples.slice(1).map((s, i) => s.t - samples[i].t));
  dt = Math.max(dt, 1e-3);
  const shotList: Sample[][] = [[]];
  for (const s of samples) {
    if (s.sceneCut && shotList[shotList.length - 1].length) shotList.push([]);
    shotList[shotList.length - 1].push(s);
  }
  const windows: UsableWindow[] = [];
  shotList.forEach((shot, shotIdx) => {
    const runs: Sample[][] = [];
    let run: Sample[] = [];
    for (const s of shot) {
      if (DARK_LEVEL <= s.brightness && s.brightness <= BRIGHT_LEVEL && s.sharpVar >= BLUR_VARIANCE) run.push(s);
      else if (run.length) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    for (const r of runs) {
      const chunks: Sample[][] = [];
      let cur: Sample[] = [];
      for (const s of r) {
        if (cur.length && s.t - cur[0].t >= WINDOW_MAX_SECONDS) { chunks.push(cur); cur = []; }
        cur.push(s);
      }
      if (cur.length) chunks.push(cur);
      for (const c of chunks) {
        const start = c[0].t, end = Math.min(c[c.length - 1].t + dt, duration);
        if (end - start < MIN_WINDOW_SECONDS) continue;
        windows.push(windowFrom(c, start, end, shotIdx, dt, shake, resFactor));
      }
    }
  });
  return windows;
}

/** A clip measured from its frames: scores, flags, usable windows and best moments. */
export async function analyzeFrames(deps: AnalysisDeps, meta: VideoMetadata, clipId: string, progress: ((f: number) => void) | null = null): Promise<ClipAnalysis> {
  const rect = await detectContentRect(deps, meta);
  const samples = await sampleVideo(deps, meta, progress, rect);
  confirmFaces(samples);
  let contentRect: number[] | null = null;
  if (rect) {
    const cx0 = Math.floor(Math.trunc(rect[0] * meta.width) / 2) * 2, cy0 = Math.floor(Math.trunc(rect[1] * meta.height) / 2) * 2;
    const cw = Math.max(Math.floor(Math.trunc((rect[2] - rect[0]) * meta.width) / 2) * 2, 2), chh = Math.max(Math.floor(Math.trunc((rect[3] - rect[1]) * meta.height) / 2) * 2, 2);
    contentRect = [cx0, cy0, Math.min(cw, meta.width - cx0), Math.min(chh, meta.height - cy0)];
  }
  const contentW = contentRect ? contentRect[2] : meta.width;
  const resScore = Math.min(contentW / GOOD_WIDTH, 1);
  const resFactor = 0.5 + 0.5 * resScore;
  const brightness = meanOf(samples.map((s) => s.brightness));
  const sharpScores = samples.map((s) => scoreSharpness(s.sharpVar));
  const sharpness = meanOf(sharpScores);
  const medianVar = median(samples.map((s) => s.sharpVar));
  const motion = samples.length > 1 ? meanOf(samples.slice(1).map((s) => scoreMotion(s.motion))) : 0;
  const shake = shakeScore(samples);
  const duplicateRatio = samples.length > 1 ? meanOf(samples.slice(1).map((s) => (s.duplicate ? 1 : 0))) : 0;
  const sceneChanges = samples.filter((s) => s.sceneCut).map((s) => round(s.t, 3));
  const windows = buildWindows(samples, meta.duration, shake, resFactor);
  const flags: string[] = [];
  if (brightness < DARK_LEVEL * 1.4) flags.push("too_dark");
  if (medianVar < BLUR_VARIANCE) flags.push("too_blurry");
  if (meta.duration < MIN_CLIP_SECONDS) flags.push("too_short");
  if (contentW < LOW_RES_WIDTH) flags.push("low_resolution");
  if (meta.orientation === "landscape") flags.push("wrong_orientation");
  if (shake > 0.6) flags.push("shaky");
  if (duplicateRatio > 0.5) flags.push("duplicate_heavy");
  let quality: number;
  if (windows.length) {
    const wl = windows.map(windowLength);
    quality = windows.reduce((s, w, i) => s + w.quality * wl[i], 0) / wl.reduce((a, b) => a + b, 0);
  } else quality = 0.25 * scoreBrightness(brightness) + 0.25 * sharpness;
  if (flags.includes("wrong_orientation")) quality *= 0.92;
  if (flags.includes("too_short")) quality *= 0.7;
  quality = Math.min(Math.max(quality * resFactor, 0), 1);
  const looks = samples.map((s) => s.look ?? shots.look(null, 0, 0));
  const found = mom.detectMoments(samples.map((s) => s.t), samples.map((s) => s.subjMotion), samples.map((s) => s.camera), samples.map((s) => s.faceBox !== null), sharpScores,
    looks.map((l) => (l.subjectStrength >= 0.15 && !shots.isEmpty(l) ? shots.area(l) : 0)), samples.map((s) => Boolean(s.look && shots.isEmpty(s.look))), windows, samples.map((s) => s.sceneCut));
  const wl = windows.map(windowLength), wsum = wl.reduce((a, b) => a + b, 0);
  const wmean = (k: keyof UsableWindow, def: number) => (windows.length ? round(windows.reduce((s, w, i) => s + (w[k] as number) * wl[i], 0) / wsum, 3) : def);
  const sizes: Record<string, number> = {};
  for (const w of windows) if (w.shotSize !== "unknown") sizes[w.shotSize] = (sizes[w.shotSize] ?? 0) + windowLength(w);
  const totalLen = Object.values(sizes).reduce((a, b) => a + b, 0);
  const shotSizes = totalLen ? Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, round(v / totalLen, 3)])) : {};
  const usable = windows.length > 0 && !flags.some((f) => ["too_dark", "too_blurry", "too_short"].includes(f)) && contentW >= BLOCKING_WIDTH;
  return clipDefaults({
    clipId, metadata: meta, qualityScore: round(quality, 3), motionScore: round(motion, 3), brightnessScore: round(scoreBrightness(brightness), 3),
    sharpnessScore: round(sharpness, 3), shakeScore: round(shake, 3), contentRect, resolutionScore: round(resScore, 3), duplicateRatio: round(duplicateRatio, 3),
    sceneChanges, flags, usable, windows, analysisVersion: VIDEO_ANALYSIS_VERSION, compositionScore: wmean("composition", 0.5), subjectScore: wmean("subject", 0),
    cameraMotionScore: wmean("cameraMotion", 0), subjectMotionScore: wmean("subjectMotion", 0), shotSizes, moments: found, bestSegments: mom.bestSegments(windows, found),
  });
}

const MIN_USEFUL_WINDOW = 0.4;

/** Seconds of the clip the editor can really use (its good parts, joined). */
export function goodSeconds(a: ClipAnalysis): number {
  if (!a.usable) return 0;
  return round(joined(a.windows).filter((w) => windowLength(w) >= MIN_USEFUL_WINDOW).reduce((s, w) => s + windowLength(w), 0), 2);
}

/** The small, UI-friendly summary stored on the media document. */
export function clipSummary(a: ClipAnalysis) {
  return {
    goodSeconds: goodSeconds(a), clipId: a.clipId, qualityScore: a.qualityScore, motionScore: a.motionScore, brightnessScore: a.brightnessScore, sharpnessScore: a.sharpnessScore,
    shakeScore: a.shakeScore, flags: a.flags, usable: a.usable, sceneChanges: a.sceneChanges.length, windows: a.windows.length, orientation: a.metadata.orientation,
    resolutionScore: a.resolutionScore, contentRect: a.contentRect, compositionScore: a.compositionScore, subjectScore: a.subjectScore, productVisibility: a.productVisibility,
    shotSizes: a.shotSizes, bestSegments: a.bestSegments.slice(0, 3).map((b) => ({ start: b.start, end: b.end, score: b.score })),
  };
}

