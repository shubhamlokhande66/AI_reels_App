import { round } from "@/server/core/py";
import { autocorrelate } from "./dsp/fft";
import { tempo as tempoOf, timeToFrames } from "./dsp/spectral";
import { clip, diff, max, mean, median, percentile } from "./dsp/util";

/** Tempo that may change through the song, how sure each beat is, and the bar starts (was backend/app/audio/tempo.py).
 * The song is read in overlapping windows; each window's tempo is measured from the beats and, independently, from the
 * onset autocorrelation; neighbouring windows at the same tempo merge into sections. */

export const HOP = 512, SR = 22050;
export const WINDOW = 12, STEP = 6, SAME_TEMPO = 0.04, TEMPO_CHANGE = 0.08;
const MIN_BPM = 50, MAX_BPM = 220, SEARCH = 3, BETTER_FIT = 1.1;
const RHYTHM_FIGURES = [3 / 4, 4 / 3, 2 / 3, 3 / 2];

export interface TempoSection { start: number; end: number; bpm: number; confidence: number }

function foldNear(bpm: number, ref: number): number {
  if (bpm <= 0 || ref <= 0) return bpm;
  while (bpm < ref / 1.41) bpm *= 2;
  while (bpm > ref * 1.41) bpm /= 2;
  return bpm;
}

/** [bpm, clarity 0..1] from the onset autocorrelation of frames a..b. */
function tempogramBpm(env: Float64Array, a: number, b: number): [number, number] {
  const seg = env.subarray(a, b);
  if (seg.length < 64 || max(seg) <= 0) return [0, 0];
  const m = mean(seg);
  const ac = autocorrelate(seg.map((v) => v - m));
  if (ac[0] <= 0) return [0, 0];
  let best = -Infinity, k = -1;
  for (let lag = 1; lag < ac.length; lag++) {
    const bpm = (60 * SR) / HOP / lag;
    if (bpm >= MIN_BPM && bpm <= MAX_BPM && ac[lag] > best) { best = ac[lag]; k = lag; }
  }
  if (k < 0) return [0, 0];
  return [(60 * SR) / HOP / k, Math.min(clip(ac[k] / ac[0], 0, 1) * 2, 1)];
}

/** [bpm, regularity 0..1] from the beats between a and b. */
export function beatBpm(beats: ArrayLike<number>, a: number, b: number): [number, number] {
  const inside = Array.from(beats).filter((t) => t >= a && t < b);
  if (inside.length < 4) return [0, 0];
  const d = diff(inside);
  const med = median(d);
  if (med <= 0) return [0, 0];
  const regular = Math.max(0, 1 - (median(Array.from(d, (x) => Math.abs(x - med))) / med) * 4);
  const steady = Array.from(d).filter((x) => x > 0.8 * med && x < 1.2 * med);
  return [60 / (steady.length ? mean(steady) : med), regular];
}

function pulseFit(env: Float64Array, a: number, b: number, period: number): number {
  if (b - a < period * 3) return 0;
  let best = 0;
  for (let phase = 0; phase < period; phase += 1) {
    let s = 0, n = 0;
    for (let x = a + phase; x < b; x += period) {
      const i = Math.round(x);
      if (i < env.length) { s += env[i]; n++; }
    }
    if (n) best = Math.max(best, s / n);
  }
  return best;
}

const bestFit = (env: Float64Array, a: number, b: number, bpm: number, fps: number) =>
  Math.max(...Array.from({ length: 13 }, (_, i) => pulseFit(env, a, b, (60 * fps) / (bpm * (1 + (i - 6) * 0.005)))));

/** The song's tempo, section by section (one section when it never changes). */
export function localTempo(env: Float64Array, beats: ArrayLike<number>, duration: number, globalBpm: number): TempoSection[] {
  if (duration <= 0) return [];
  const starts: number[] = [];
  if (duration > WINDOW) for (let s = 0; s <= Math.max(duration - WINDOW, 0) + 1e-6; s += STEP) starts.push(s);
  else starts.push(0);
  const readings: [number, number, number, number][] = [];
  for (const s of starts) {
    const e = duration > WINDOW ? Math.min(s + WINDOW, duration) : duration;
    const a = timeToFrames(s), b = timeToFrames(e);
    if (b - a < 64) continue;
    const tb = tempoOf(env.subarray(a, b));
    const [, clarity] = tempogramBpm(env, a, b);
    const [bb, regular] = beatBpm(beats, s, e);
    if (tb <= 0) continue;
    const agree = bb > 0 ? 1 - Math.min(Math.abs(Math.log2(foldNear(bb, tb) / tb)) / 0.1, 1) : 0;
    readings.push([s, e, tb, round(clip(0.4 * clarity + 0.35 * agree + 0.25 * regular, 0, 1), 2)]);
  }
  if (!readings.length) return [{ start: 0, end: round(duration, 3), bpm: round(globalBpm, 1), confidence: 0 }];
  const fps = SR / HOP;
  for (const r of readings) {
    const [s, e, bpm] = r;
    if (globalBpm > 0 && Math.abs(bpm / globalBpm - 1) > TEMPO_CHANGE) {
      const a = Math.trunc(s * fps), b = Math.trunc(e * fps);
      const own = bestFit(env, a, b, bpm, fps), main = bestFit(env, a, b, globalBpm, fps);
      const ratio = bpm / globalBpm;
      const figure = RHYTHM_FIGURES.some((x) => Math.abs(ratio / x - 1) < 0.03) && main >= 0.5 * own;
      if (own < main * BETTER_FIT || figure) r[2] = globalBpm;
    }
  }
  const sections: [number, number, number, number, number][] = [];
  readings.forEach(([s, e, bpm, conf], k) => {
    const ownStart = k === 0 ? 0 : readings[k - 1][1] > s ? (s + readings[k - 1][1]) / 2 : s;
    const last = sections[sections.length - 1];
    if (last && Math.abs(bpm - last[2]) / last[2] <= SAME_TEMPO) {
      const n = last[4];
      last[1] = e;
      last[2] = (last[2] * n + bpm) / (n + 1);
      last[3] = (last[3] * n + conf) / (n + 1);
      last[4] = n + 1;
    } else {
      if (last) last[1] = ownStart;
      sections.push([ownStart, e, bpm, conf, 1]);
    }
  });
  sections[sections.length - 1][1] = duration;
  let k = 1;
  while (k > 0 && k < sections.length - 1) {
    if (sections[k][4] === 1) {
      const prev = sections[k - 1], cur = sections[k], nxt = sections[k + 1];
      if (Math.abs(cur[2] - prev[2]) <= Math.abs(cur[2] - nxt[2])) prev[1] = cur[1];
      else nxt[0] = cur[0];
      sections.splice(k, 1);
      continue;
    }
    k++;
  }
  return sections.filter(([s, e]) => e - s > 0.5).map(([s, e, bpm, c]) => ({ start: round(s, 3), end: round(e, 3), bpm: round(bpm, 1), confidence: round(c, 2) }));
}

function changePoint(env: Float64Array, near: number, before: number, after: number, loS: number, hiS: number): number {
  const fps = SR / HOP;
  const pa = (60 * fps) / before, pb = (60 * fps) / after;
  const span = Math.trunc(2 * STEP * fps);
  const lo = Math.trunc(Math.max(near - STEP, loS) * fps), hi = Math.trunc(Math.min(near + STEP, hiS) * fps);
  let bestT = near, best = -1;
  for (let f = lo; f <= hi; f += 2) {
    const score = pulseFit(env, Math.max(f - span, 0), f, pa) + pulseFit(env, f, Math.min(f + span, env.length), pb);
    if (score > best) { best = score; bestT = f / fps; }
  }
  return round(bestT, 3);
}

/** Sharper sections: each boundary moved to where the pulse really changes, each tempo from its beats. */
export function refine(sections: TempoSection[], beats: ArrayLike<number>, env: Float64Array | null): TempoSection[] {
  if (sections.length < 2 || beats.length < 8) return sections;
  const out = sections.map((s) => ({ ...s }));
  const precise = (margin: number) => {
    for (const sec of out) {
      const [bpm, regular] = beatBpm(beats, sec.start + margin, sec.end - margin);
      if (bpm > 0 && Math.abs(Math.log2(bpm / sec.bpm)) < 0.1) {
        sec.bpm = round(bpm, 1);
        sec.confidence = round(Math.max(sec.confidence, 0.5 * sec.confidence + 0.5 * regular), 2);
      }
    }
  };
  precise(STEP);
  if (env) {
    for (let k = 1; k < out.length; k++) {
      const t = changePoint(env, out[k].start, out[k - 1].bpm, out[k].bpm, out[k - 1].start + 1, out[k].end - 1);
      out[k - 1].end = out[k].start = t;
    }
  }
  precise(1);
  return out;
}

/** True when confident sections differ by more than TEMPO_CHANGE (a real change, not a wobble). */
export function changesTempo(sections: TempoSection[], minConfidence = 0.5): boolean {
  const sure = sections.filter((s) => s.confidence >= minConfidence && s.end - s.start >= WINDOW).map((s) => s.bpm);
  return sure.length >= 2 && Math.max(...sure) / Math.min(...sure) - 1 > TEMPO_CHANGE;
}

const peakAt = (env: Float64Array, f: number) => max(env, Math.max(f - SEARCH, 0), Math.min(f + SEARCH + 1, env.length));
const frameOf = (env: Float64Array, t: number) => Math.min(Math.max(timeToFrames(t), 0), env.length - 1);

/** 0..1 per beat: the hit on the beat against the music around it (60%), and the beat on the local grid (40%). */
export function beatConfidence(beats: number[], env: Float64Array, sections: TempoSection[]): number[] {
  if (!beats.length) return [];
  const win = Math.trunc((4 * SR) / HOP);
  const gaps = diff(beats);
  return beats.map((t, i) => {
    const f = frameOf(env, t);
    const hit = peakAt(env, f);
    const local = percentile(env.subarray(Math.max(f - win, 0), f + win + 1), 90);
    const strength = clip(hit / Math.max(local, 1e-6), 0, 1);
    const sec = sections.find((s) => s.start <= t && t < s.end) ?? sections[sections.length - 1];
    const period = 60 / (sec ? sec.bpm : 120);
    const near = Math.min(i < gaps.length ? gaps[i] : Infinity, i > 0 ? gaps[i - 1] : Infinity);
    const r = near / period;
    const off = Number.isFinite(r) ? Math.abs(r - Math.round(Math.max(r, 0.5) * 2) / 2) : 1;
    const onGrid = clip(1 - (Number.isFinite(off) ? off : 1) * 4, 0, 1);
    return round(0.6 * strength + 0.4 * onGrid, 2);
  });
}

