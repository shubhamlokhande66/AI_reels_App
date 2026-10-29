import { round } from "@shubix/core/engine/core/py";
import * as sp from "./dsp/spectral";
import { argsortDesc, clip, mean, median, percentile, uniformFilter1d, vec } from "./dsp/util";

/** Drops, build-ups, breakdowns and entries (was backend/app/audio/drops.py): every moment judged on five measurements
 * at once - energy, bass, flux, density, brightness - each change against how much it normally changes in the music
 * around it (a robust z-score). Estimates, with the measurements behind them. */

export const HOP_S = 0.1, JUMP = 2.0, LOCAL = 30.0, MIN_GAP = 8.0;
const WEIGHTS: Record<string, number> = { energy: 0.35, bass: 0.3, flux: 0.2, density: 0.1, brightness: 0.05 };
const KEYS = Object.keys(WEIGHTS);
const LOUDNESS = ["energy", "bass"];
const BASS_HZ = 150, DROP_Z = 1.5, AGREE_Z = 1.5, MIN_SPREAD = 0.06, LOUD_AFTER = 50, BIG_RISE = 0.3, QUIET_BEFORE = 15;
const BUILD_MIN = 3, BUILD_MAX = 16, DROP_CONFIDENCE = 0.5;

export interface MusicEvent {
  time: number;
  type: string;
  strength: number;
  confidence: number;
  end: number | null;
  measurements: Record<string, number>;
}

function norm(x: Float64Array): Float64Array {
  const top = percentile(x, 95);
  return top > 1e-9 ? x.map((v) => clip(v / top, 0, 1)) : vec(x.length);
}

/** The five curves, every HOP_S seconds, each 0..1. */
export function measurements(y: Float32Array, sr: number, env: Float64Array, onsets: number[], hop = 512): Record<string, Float64Array> {
  const n = Math.max(Math.trunc(y.length / sr / HOP_S), 1);
  const step = Math.trunc(sr * HOP_S);
  const rms = sp.rmsY(y, step * 4, step).slice(0, n);
  const fluxSum = vec(n), fluxCount = vec(n);
  for (let f = 0; f < env.length; f++) { // each frame into the 0.1 s cell whose [k*HOP_S, (k+1)*HOP_S) holds it
    const t = sp.framesToTime(f, sr, hop);
    let k = Math.floor(t / HOP_S);
    if (k > 0 && t < k * HOP_S) k -= 1;
    else if (t >= (k + 1) * HOP_S) k += 1;
    if (k >= 0 && k < n) { fluxSum[k] += env[f]; fluxCount[k]++; }
  }
  const flux = fluxSum.map((s, k) => (fluxCount[k] ? s / fluxCount[k] : 0));
  const counts = vec(n);
  for (const t of onsets) counts[clip(Math.trunc(t / HOP_S), 0, n - 1)] += 1;
  const density = uniformFilter1d(counts, Math.trunc(1 / HOP_S)).map((v) => v / HOP_S);
  const S = sp.stftMag(y, 2048, step);
  const freqs = sp.fftFrequencies(sr, 2048);
  const bass = vec(S.cols);
  const low = Array.from(freqs).map((f, i) => [f, i] as const).filter(([f]) => f <= BASS_HZ).map(([, i]) => i);
  for (let t = 0; t < S.cols; t++) bass[t] = Math.sqrt(low.reduce((a, f) => a + S.data[f * S.cols + t] ** 2, 0) / low.length);
  const centroid = sp.spectralCentroid(S, sr);
  const curves: Record<string, Float64Array> = { energy: rms, bass: bass.slice(0, n), flux, density, brightness: centroid.slice(0, n) };
  const out: Record<string, Float64Array> = {};
  for (const [k, v] of Object.entries(curves)) {
    let x = v;
    if (x.length < n) { // numpy pad "edge"
      const p = vec(n);
      p.set(x);
      p.fill(x.length ? x[x.length - 1] : 0, x.length);
      x = p;
    }
    out[k] = norm(uniformFilter1d(x, 3));
  }
  return out;
}

function jumps(x: Float64Array, w: number): Float64Array {
  const c = vec(x.length + 1);
  for (let i = 0; i < x.length; i++) c[i + 1] = c[i] + x[i];
  const out = vec(x.length);
  for (let i = w; i < x.length - w; i++) out[i] = (c[i + w] - c[i]) / w - (c[i] - c[i - w]) / w;
  return out;
}

function localSpread(j: Float64Array, w: number): Float64Array {
  const a = j.map(Math.abs);
  return a.map((_, i) => {
    const seg = a.subarray(Math.max(i - w, 0), i + w + 1);
    const med = median(seg);
    return Math.max(med + 1.4826 * median(seg.map((v) => Math.abs(v - med))), MIN_SPREAD);
  });
}

export function detectEvents(curves: Record<string, Float64Array>, beats: number[]): MusicEvent[] {
  const n = curves.energy.length;
  const w = Math.trunc(JUMP / HOP_S), local = Math.trunc(LOCAL / HOP_S / 2);
  if (n < 2 * w + 1) return [];
  const z: Record<string, Float64Array> = {};
  for (const k of KEYS) {
    const j = jumps(curves[k], w);
    const s = localSpread(j, local);
    z[k] = j.map((v, i) => v / s[i]);
  }
  const rising = vec(n), falling = vec(n);
  for (const k of KEYS) for (let i = 0; i < n; i++) { rising[i] += WEIGHTS[k] * Math.max(z[k][i], 0); falling[i] += WEIGHTS[k] * Math.max(-z[k][i], 0); }
  const energy = curves.energy;
  const loud = percentile(energy, LOUD_AFTER), quiet = percentile(energy, QUIET_BEFORE);
  const before = Float64Array.from({ length: n }, (_, i) => (i ? mean(energy, Math.max(i - w, 0), i) : energy[0]));
  const after = Float64Array.from({ length: n }, (_, i) => mean(energy, i, Math.min(i + w, n)));
  const snap = (t: number) => {
    let near = t;
    if (beats.length) near = beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0]);
    return round(Math.abs(near - t) <= 0.25 ? near : t, 3);
  };
  const gap = Math.min(MIN_GAP, Math.max(3, (n * HOP_S) / 6));
  const others = KEYS.filter((k) => !LOUDNESS.includes(k));
  const event = (i: number, kind: string, sign: number): MusicEvent => {
    const loudAgree = LOUDNESS.filter((k) => sign * z[k][i] >= AGREE_Z).length / LOUDNESS.length;
    const otherAgree = others.filter((k) => sign * z[k][i] >= AGREE_Z).length / others.length;
    const score = sign > 0 ? rising[i] : falling[i];
    const sure = clip((score - DROP_Z) / (DROP_Z / 2), 0, 1);
    return {
      time: snap(i * HOP_S), type: kind, strength: round(sign > 0 ? after[i] : before[i], 2), confidence: round(0.5 * sure + 0.3 * loudAgree + 0.2 * otherAgree, 2), end: null,
      measurements: { ...Object.fromEntries(KEYS.map((k) => [`${k}_change`, round(z[k][i], 2)])), combined: round(score, 2), energy_before: round(before[i], 2), energy_after: round(after[i], 2) },
    };
  };
  const peaks = (sign: number) => {
    const score = sign > 0 ? rising : falling;
    const found: number[] = [];
    for (const i of argsortDesc(score)) {
      if (score[i] < DROP_Z) break;
      if (found.every((j) => Math.abs(i - j) * HOP_S >= gap)) found.push(i);
    }
    return found.sort((a, b) => a - b);
  };
  const events: MusicEvent[] = [];
  for (const i of peaks(+1)) {
    if (after[i] < loud && after[i] - before[i] < BIG_RISE) continue;
    const agree = KEYS.filter((k) => z[k][i] >= AGREE_Z).length;
    if (agree < 2 || !LOUDNESS.some((k) => z[k][i] >= AGREE_Z)) continue;
    events.push(event(i, before[i] <= quiet ? "entry" : "possible_drop", +1));
  }
  for (const i of peaks(-1)) {
    if (after[i] <= percentile(energy, 50) && KEYS.filter((k) => -z[k][i] >= AGREE_Z).length >= 2) {
      const ev = event(i, "breakdown", -1);
      let back = n - 1;
      for (let k = i + w; k < n; k++) if (energy[k] >= before[i] * 0.9) { back = k; break; }
      ev.end = round(back * HOP_S, 3);
      events.push(ev);
    }
  }
  const rise = uniformFilter1d(Float64Array.from({ length: n }, (_, i) => curves.energy[i] * 0.6 + curves.density[i] * 0.4), Math.trunc(1 / HOP_S));
  for (const d of events.filter((e) => e.type === "possible_drop")) {
    const i = round(d.time / HOP_S);
    let k = i - 1;
    while (k > 0 && i - k < BUILD_MAX / HOP_S && rise[k - 1] <= rise[k] + 0.01) k -= 1;
    const span = (i - k) * HOP_S;
    if (span >= BUILD_MIN && rise[i - 1] - rise[k] >= 0.15) {
      events.push({ time: snap(k * HOP_S), end: d.time, type: "build_up", strength: round(rise[i - 1] - rise[k], 2), confidence: round(Math.min(d.confidence, 0.4 + (rise[i - 1] - rise[k])), 2),
        measurements: { seconds: round(span, 2), rise: round(rise[i - 1] - rise[k], 2) } });
    }
  }
  return events.map((e, i) => [e, i] as const).sort((a, b) => a[0].time - b[0].time || a[1] - b[1]).map(([e]) => e);
}

/** The song's drops: the sure drops and entries. */
export const dropsFrom = (events: MusicEvent[]) => [...new Set(events.filter((e) => ["possible_drop", "entry"].includes(e.type) && e.confidence >= DROP_CONFIDENCE).map((e) => e.time))].sort((a, b) => a - b);
