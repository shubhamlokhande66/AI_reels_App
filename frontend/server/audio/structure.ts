import { round } from "@/server/core/py";
import { agglomerative } from "./dsp/segment";
import * as sp from "./dsp/spectral";
import { convolveSame, interp, Mat, max as vmax, mean, percentile, slope, vec } from "./dsp/util";

/** What each part of the song is and how an editor cuts it (was backend/app/audio/structure.py): curves every
 * CURVE_HOP s (loudness, brightness, rhythmic density, vocal presence - an estimate), finer structural parts (MFCC +
 * loudness clustering) and their labels (intro, build, drop, chorus, verse, bridge, outro) with a cut strategy. */

export const CURVE_HOP = 0.5;
export const CUT_STRATEGY: Record<string, string> = { intro: "phrase", verse: "bar", build: "beat", drop: "accent", chorus: "beat", bridge: "bar", outro: "phrase" };

export interface Curves { loudnessDb: number[]; brightness: number[]; density: number[]; vocal: number[] }

function norm(x: Float64Array, lo = 5, hi = 95): Float64Array {
  const a = percentile(x, lo), b = percentile(x, hi);
  if (b - a < 1e-9) return vec(x.length).fill(0.5);
  return x.map((v) => Math.min(Math.max((v - a) / (b - a), 0), 1));
}

function resample(x: ArrayLike<number>, srcHop: number, n: number): Float64Array {
  const per = Math.max(round(CURVE_HOP / srcHop), 1);
  const out = vec(n);
  for (let i = 0; i < n; i++) {
    const a = i * per, b = Math.min((i + 1) * per, x.length);
    out[i] = b > a ? mean(x, a, b) : i ? out[i - 1] : 0;
  }
  return out;
}

const VOICE_LO = 150, VOICE_HI = 1000;

/** Per frame, how much the strongest tonal partial in the voice range wavers (0..1): singing never holds a pitch still. */
function pitchMotion(S: Mat, freqs: Float64Array, fh: number): Float64Array {
  const band: number[] = [];
  for (let f = 0; f < freqs.length; f++) if (freqs[f] >= VOICE_LO && freqs[f] <= VOICE_HI) band.push(f);
  const T = S.cols, B = band.length;
  const ok = new Uint8Array(T), moving = vec(T), signed = vec(T);
  const clear = new Uint8Array(T), semis = vec(T);
  for (let t = 0; t < T; t++) {
    let k = 0;
    const col = band.map((f) => S.data[f * T + t]);
    for (let i = 1; i < B; i++) if (col[i] > col[k]) k = i;
    const sorted = col.slice().sort((a, b) => a - b);
    const med = B % 2 ? sorted[(B - 1) / 2] : (sorted[B / 2 - 1] + sorted[B / 2]) / 2;
    clear[t] = col[k] > 6 * Math.max(med, 1e-9) ? 1 : 0;
    const kk = Math.min(Math.max(k, 1), B - 2);
    const [a, bb, c] = [-1, 0, 1].map((d) => Math.log(Math.max(col[kk + d], 1e-9)));
    const den = a - 2 * bb + c;
    const off = Math.abs(den) > 1e-9 ? (0.5 * (a - c)) / den : 0;
    const f = freqs[band[kk]] + Math.min(Math.max(off, -0.5), 0.5) * (freqs[1] - freqs[0]);
    semis[t] = 12 * Math.log2(Math.max(f, 1) / 440);
  }
  for (let t = 0; t < T; t++) {
    const d = t ? semis[t] - semis[t - 1] : 0;
    const step = Math.abs(d);
    ok[t] = clear[t] && clear[(t - 1 + T) % T] && step < 1.5 ? 1 : 0; // np.roll(clear, 1)
    moving[t] = ok[t] ? Math.min(Math.max((step - 0.03) / 0.12, 0), 1) : 0;
    signed[t] = ok[t] ? Math.sign(d) * moving[t] : 0;
  }
  const w = Math.max(round(0.4 / fh), 1);
  const ones = new Float64Array(w).fill(1);
  const held = convolveSame(Float64Array.from(ok), ones);
  const mv = convolveSame(moving, ones), sg = convolveSame(signed, ones);
  return held.map((h, t) => (h > 0 ? Math.max(mv[t] - Math.abs(sg[t]), 0) / Math.max(h, 1) : 0) * (h / w));
}

export function computeCurves(y: Float32Array, sr: number, onsets: number[], hop = 1024): Curves {
  const duration = y.length / sr;
  const n = Math.max(Math.ceil(duration / CURVE_HOP), 1);
  const fh = hop / sr;
  const rms = sp.rmsY(y, hop * 2, hop);
  const loud = resample(rms, fh, n).map((v) => 20 * Math.log10(Math.max(v, 1e-5)));
  const S = sp.stftMag(y, 2048, hop);
  const bright = norm(resample(sp.spectralCentroid(S, sr), fh, n));
  const counts = vec(n);
  for (const t of onsets) { const k = Math.trunc(t / CURVE_HOP); if (k >= 0 && k < n) counts[k] += 1; }
  const window = Math.max(Math.trunc(2 / CURVE_HOP), 1);
  const dens = convolveSame(counts, new Float64Array(window).fill(1 / (window * CURVE_HOP))).map((v) => Math.min(Math.max(v / 8, 0), 1));
  const freqs = sp.fftFrequencies(sr, 2048);
  const share = vec(S.cols);
  for (let t = 0; t < S.cols; t++) {
    let inBand = 0, all = 0;
    for (let f = 0; f < S.rows; f++) { const v = S.data[f * S.cols + t]; all += v; if (freqs[f] >= 250 && freqs[f] <= 3500) inBand += v; }
    share[t] = Math.min(Math.max((inBand / Math.max(all, 1e-9)) * 1.5, 0), 1);
  }
  const pm = pitchMotion(S, freqs, fh);
  let vocal = resample(pm.map((v, t) => Math.min(Math.max(v * 1.5, 0), 1) * (0.4 + 0.6 * share[t])), fh, n);
  vocal = convolveSame(vocal, new Float64Array(3).fill(1 / 3));
  const loudMax = vmax(loud);
  for (let i = 0; i < n; i++) if (loud[i] < loudMax - 35) vocal[i] = 0;
  return {
    loudnessDb: Array.from(loud, (v) => round(v, 1)), brightness: Array.from(bright, (v) => round(v, 3)),
    density: Array.from(dens, (v) => round(v, 3)), vocal: Array.from(vocal, (v) => round(Math.min(Math.max(v, 0), 1), 3)),
  };
}

export interface Part { start: number; end: number }
export const MIN_PART = 4.0;

/** Finer structure than the coarse sections: timbre (MFCC) + loudness clustering, about one part per 8 s, boundaries on
 * beats, nothing shorter than MIN_PART; a drop always starts a part. */
export function structuralParts(y: Float32Array, sr: number, beats: number[], duration: number, energy: number[], energyHop: number, drops: number[] = [], hop = 512): Part[] {
  if (duration < 2 * MIN_PART) return [{ start: 0, end: round(duration, 2) }];
  const k = Math.trunc(Math.min(Math.max(round(duration / 8), 3), 12));
  const mf = sp.normalizeRows(sp.mfcc(y, sr, 13, hop * 4));
  const T = mf.cols;
  const loud = interp(Float64Array.from({ length: T }, (_, i) => (i * hop * 4) / sr), Float64Array.from({ length: energy.length }, (_, i) => i * energyHop), energy);
  const feats = new Mat(14, T);
  feats.data.set(mf.data, 0);
  for (let t = 0; t < T; t++) feats.data[13 * T + t] = 3 * loud[t];
  const bounds = agglomerative(feats, k).map((f) => sp.framesToTime(f, sr, hop * 4));
  const nearest = (t: number) => (beats.length ? beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]) : t);
  const edges = [0];
  for (const t of bounds.sort((a, b) => a - b)) {
    if (t <= 0.5 || t >= duration - 0.5) continue;
    const s = nearest(t);
    if (s - edges[edges.length - 1] >= MIN_PART) edges.push(round(s, 2));
  }
  if (duration - edges[edges.length - 1] < MIN_PART && edges.length > 1) edges.pop();
  edges.push(round(duration, 2));
  let e = edges;
  for (const d of drops) {
    if (!(d > 0 && d < duration)) continue;
    let near: number | null = null;
    for (let i = 1; i < e.length - 1; i++) if (near === null || Math.abs(e[i] - d) < Math.abs(e[near] - d)) near = i;
    if (near !== null && Math.abs(e[near] - d) <= MIN_PART && e[near - 1] + 1 < d && d < e[near + 1] - 1) e[near] = round(d, 2);
    else if (e.every((x) => Math.abs(x - d) >= MIN_PART)) e = [...e, round(d, 2)].sort((a, b) => a - b);
  }
  return e.slice(0, -1).map((a, i) => ({ start: a, end: e[i + 1] }));
}

const meanOf = (curve: ArrayLike<number>, a: number, b: number, hop: number) => {
  const i = Math.trunc(a / hop), j = Math.max(Math.trunc(b / hop), Math.trunc(a / hop) + 1);
  const hi = Math.min(j, curve.length);
  return hi > i ? mean(curve, i, hi) : 0;
};

function slopeOf(energy: number[], a: number, b: number, hop: number): number {
  const i = Math.trunc(a / hop), j = Math.max(Math.trunc(b / hop), Math.trunc(a / hop) + 2);
  const seg = energy.slice(i, j);
  if (seg.length < 4) return 0;
  const x = Array.from({ length: seg.length }, (_, k) => k / (seg.length - 1));
  return slope(x, seg);
}

export interface SongSectionRow { start: number; end: number; label: string; energy: number; density: number; vocal: number; confidence: number; cutOn: string }

export function labelSections(sections: Part[], energy: number[], energyHop: number, drops: number[], curves: Curves): SongSectionRow[] {
  if (!sections.length) return [];
  const songMean = energy.length ? mean(energy) : 0.5;
  const rows = sections.map((s) => ({
    start: round(s.start, 2), end: round(s.end, 2), energy: round(meanOf(energy, s.start, s.end, energyHop), 3),
    slope: round(slopeOf(energy, s.start, s.end, energyHop), 3), density: round(meanOf(curves.density, s.start, s.end, CURVE_HOP), 3),
    vocal: round(meanOf(curves.vocal, s.start, s.end, CURVE_HOP), 3),
  }));
  const hi = Math.max(...rows.map((r) => r.energy));
  const n = rows.length;
  return rows.map((r, i) => {
    const startsOnDrop = drops.some((d) => Math.abs(d - r.start) <= 1.5);
    const loud = r.energy >= Math.max(0.75 * hi, songMean);
    const nxt = i + 1 < n ? rows[i + 1] : null;
    let label: string, conf: number;
    if (startsOnDrop && loud) [label, conf] = ["drop", 0.85];
    else if (i === 0 && r.energy < 0.8 * hi && n > 1) [label, conf] = ["intro", 0.8];
    else if (i === n - 1 && n > 1 && (r.slope < -0.05 || r.energy < 0.8 * hi)) [label, conf] = ["outro", 0.75];
    else if (nxt && (r.slope > 0.12 || (nxt.energy > r.energy * 1.25 && drops.some((d) => Math.abs(d - nxt.start) <= 1.5)))) [label, conf] = ["build", 0.7];
    else if (loud) [label, conf] = ["chorus", 0.6];
    else if (i > 0 && i < n - 1 && r.energy < 0.7 * songMean && rows[i - 1].energy > r.energy * 1.3) [label, conf] = ["bridge", 0.55];
    else [label, conf] = ["verse", 0.5];
    return { start: r.start, end: r.end, label, energy: r.energy, density: r.density, vocal: r.vocal, confidence: conf, cutOn: CUT_STRATEGY[label] };
  });
}
