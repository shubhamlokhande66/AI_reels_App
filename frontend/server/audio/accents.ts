import { round } from "@/server/core/py";
import * as sp from "./dsp/spectral";
import { argsortDesc, clip, Mat, max, mean, median, percentile } from "./dsp/util";

/** Which beats are strong, medium or weak, the bar starts, and each beat on its real hit (was
 * backend/app/audio/accents.py). Per beat: the kick (low-frequency attack), the snare / clap band, how much the chords
 * and the bass note change across it. Bar starts: the 4-beat phase with the kick, chord changes and bass moves, window
 * by window, with a confidence. Strength is judged against the beats around it. */

const HOP = 512, KICK_HZ = 150, SNARE: [number, number] = [1800, 6000], SEARCH = 2, WINDOW_BARS = 8, STRONG_CONTEXT = 8;
const STRONG_SHARE = 0.28, STRONG_RATIO = 1.25, BEATS_PER_BAR = 4;
const FINE_HOP = 128, HIT_WINDOW = 0.05, HIT_CLEAR = 1.5, MEDIUM_RATIO = 1.0;

export interface Accents {
  downbeats: number[];
  downbeatConfidence: number;
  strongBeats: number[];
  levels: number[];
  kick: number[];
  beats: number[] | null;
  mediumBeats: number[] | null;
}

/** The moment the hit near `tp` rises halfway from the level before it to its top (`amp`: the waveform's level per `step` s). */
function attack(amp: Float64Array, tp: number, step: number): number {
  const k = Math.round(tp / step);
  const lo = Math.max(k - Math.trunc(0.03 / step), 0), hi = Math.min(k + Math.trunc(0.012 / step), amp.length);
  if (hi - lo < 10) return tp;
  const base = median(amp.subarray(Math.max(lo - Math.trunc(0.02 / step), 0), lo + 5));
  let top = lo;
  for (let i = lo + 1; i < hi; i++) if (amp[i] > amp[top]) top = i;
  if (amp[top] <= base * 1.3) return tp;
  const level = base + 0.5 * (amp[top] - base);
  let i = top;
  while (i > lo && amp[i - 1] >= level) i--;
  return i * step;
}

/** Each beat moved onto its real hit (fine onset curve, ~6 ms frames, sub-frame peak, then the waveform's attack), and
 * whether a clear hit was there. */
export function snapToHits(y: Float32Array, sr: number, beats: number[]): [number[], boolean[]] {
  const env = sp.onsetStrength(y, sr, FINE_HOP, 512);
  if (env.length < 3) return [beats.slice(), beats.map(() => false)];
  const ms = Math.max(Math.trunc(sr * 0.001), 1);
  const amp = new Float64Array(Math.floor(y.length / ms));
  for (let i = 0; i < amp.length; i++) {
    let m = 0;
    for (let j = i * ms; j < (i + 1) * ms; j++) m = Math.max(m, Math.abs(y[j]));
    amp[i] = m;
  }
  const win = Math.max(Math.trunc((HIT_WINDOW * sr) / FINE_HOP), 2);
  const floor = median(env);
  const out = beats.slice(), clear = beats.map(() => false);
  beats.forEach((t, i) => {
    const f = Math.round((t * sr) / FINE_HOP);
    const lo = Math.max(f - win, 1), hi = Math.min(f + win + 1, env.length - 1);
    if (hi - lo < 3) return;
    let k = lo;
    for (let j = lo + 1; j < hi; j++) if (env[j] > env[k]) k = j;
    const peak = env[k];
    if (peak < HIT_CLEAR * Math.max(median(env.subarray(lo, hi)), 1e-9) || peak <= floor) return;
    const a = env[k - 1], b = env[k], c = env[k + 1];
    const den = a - 2 * b + c;
    const shift = Math.abs(den) > 1e-12 ? (0.5 * (a - c)) / den : 0;
    out[i] = round(attack(amp, ((k + clip(shift, -0.5, 0.5)) * FINE_HOP) / sr, ms / sr), 3);
    clear[i] = true;
  });
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1] + 0.05) out[i] = beats[i] > out[i - 1] + 0.05 ? beats[i] : out[i - 1] + 0.05; // never swap or touch
  return [out, clear];
}

function bandOnset(S: Mat, freqs: Float64Array, lo: number, hi: number): Float64Array {
  const rows: number[] = [];
  for (let f = 0; f < freqs.length; f++) if (freqs[f] >= lo && freqs[f] < hi) rows.push(f);
  if (!rows.length) return new Float64Array(S.cols);
  const band = new Mat(rows.length, S.cols);
  rows.forEach((f, i) => band.data.set(S.row(f), i * S.cols));
  return sp.onsetStrengthS(sp.amplitudeToDb(band, "max"));
}

const at = (curve: Float64Array, frames: number[]) => frames.map((f) => (curve.length ? max(curve, Math.max(f - SEARCH, 0), Math.min(f + SEARCH + 1, curve.length)) : 0));

/** How different a feature (rows = dims) is just after each frame than just before (1 - cosine). */
function change(feat: Mat, frames: number[], width: number): number[] {
  const T = feat.cols;
  const avg = (a: number, b: number) => {
    const v = new Float64Array(feat.rows);
    for (let r = 0; r < feat.rows; r++) v[r] = mean(feat.data, r * T + a, r * T + b);
    return v;
  };
  return frames.map((f) => {
    const a = f > 0 ? avg(Math.max(f - width, 0), f) : avg(0, 1);
    const b = f < T ? avg(f, Math.min(f + width, T)) : avg(T - 1, T);
    let dot = 0, na = 0, nb = 0;
    for (let r = 0; r < feat.rows; r++) { dot += a[r] * b[r]; na += a[r] * a[r]; nb += b[r] * b[r]; }
    na = Math.sqrt(na); nb = Math.sqrt(nb);
    return na < 1e-9 || nb < 1e-9 ? 0 : 1 - dot / (na * nb);
  });
}

function relTo(x: number[], k: number): number[] {
  return x.map((v, i) => {
    const med = median(x.slice(Math.max(i - k, 0), i + k + 1));
    return med > 1e-9 ? v / med : 1;
  });
}

function z(x: number[]): number[] {
  const m = mean(x);
  const s = Math.sqrt(mean(x.map((v) => (v - m) ** 2)));
  return s > 1e-9 ? x.map((v) => (v - m) / s) : x.map(() => 0);
}

export function analyze(y: Float32Array, sr: number, beatsIn: number[], sectionStarts: number[] = []): Accents {
  const n = beatsIn.length;
  if (n < BEATS_PER_BAR * 2) return { downbeats: [], downbeatConfidence: 0, strongBeats: beatsIn.slice(), levels: beatsIn.map(() => 1), kick: beatsIn.map(() => 0), beats: null, mediumBeats: null };
  const [b, clear] = snapToHits(y, sr, beatsIn);
  const S = sp.stftMag(y, 2048, HOP);
  const freqs = sp.fftFrequencies(sr, 2048);
  const frames = b.map((t) => Math.min(Math.max(sp.timeToFrames(t, sr, HOP), 0), S.cols - 1));
  const kickOn = bandOnset(S, freqs, 0, KICK_HZ), snareOn = bandOnset(S, freqs, ...SNARE);
  const Spow = S.map((v) => v * v);
  const chroma = sp.chromaStft(Spow, sr);
  const bassPow = new Mat(S.rows, S.cols);
  for (let f = 0; f < S.rows; f++) if (freqs[f] < 250) for (let t = 0; t < S.cols; t++) bassPow.data[f * S.cols + t] = Spow.data[f * S.cols + t];
  const bassChroma = sp.chromaStft(bassPow, sr);
  const period = median(b.slice(1).map((t, i) => t - b[i]));
  const width = Math.max(Math.trunc((period * sr) / HOP), 2);
  const kick = at(kickOn, frames), snare = at(snareOn, frames);
  const harm = change(chroma, frames, width * 2), bass = change(bassChroma, frames, width);

  // bar starts: the phase with the kick, the chord changes and the bass moves, window by window
  const zk = z(kick), zh = z(harm), zb = z(bass), zs = z(snare);
  const votes = new Array(n).fill(0);
  for (const t of sectionStarts) {
    let i = 0;
    for (let j = 1; j < n; j++) if (Math.abs(b[j] - t) < Math.abs(b[i] - t)) i = j;
    if (Math.abs(b[i] - t) <= period * 0.5) votes[i] += 1;
  }
  const cue = b.map((_, i) => 1.0 * zk[i] + 0.8 * zh[i] + 0.5 * zb[i] - 0.3 * zs[i] + 0.8 * votes[i]);
  const win = WINDOW_BARS * BEATS_PER_BAR;
  const phases: [number, number][] = [], margins: number[] = [];
  for (let start = 0; start < n; start += win / 2) {
    const seg = Array.from({ length: Math.min(start + win, n) - start }, (_, k) => start + k);
    if (seg.length < BEATS_PER_BAR * 2) break;
    const score = [0, 1, 2, 3].map((p) => { const xs = seg.filter((i) => (i - p) % BEATS_PER_BAR === 0).map((i) => cue[i]); return xs.length ? mean(xs) : 0; });
    const order = argsortDesc(score);
    phases.push([start, order[0]]);
    margins.push(score[order[0]] - score[order[1]]);
  }
  if (!phases.length) return { downbeats: [], downbeatConfidence: 0, strongBeats: b.slice(), levels: b.map(() => 1), kick: b.map(() => 0), beats: b, mediumBeats: [] };
  const counts = new Map<number, number>();
  for (const [, p] of phases) counts.set(p, (counts.get(p) ?? 0) + 1);
  // Python max(set(...), key=count): ties go to the smallest phase number (a set of small ints iterates in order)
  const main = [...counts.keys()].sort((x, y2) => x - y2).reduce((best, p) => (counts.get(p)! > counts.get(best)! ? p : best));
  const consistency = phases.filter(([, p]) => p === main).length / phases.length;
  const margin = clip(median(margins) / 1.0, 0, 1);
  const confidence = round(clip(margin * consistency * 1.2, 0, 1), 2);
  const phaseAt = new Array(n).fill(main);
  phases.forEach(([start, p], k) => { if (p !== main && margins[k] > 0.6) for (let i = start; i < Math.min(start + win, n); i++) phaseAt[i] = p; });
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  const isDown = b.map((_, i) => mod(i - phaseAt[i], BEATS_PER_BAR) === 0);
  const isBack = b.map((_, i) => [1, 3].includes(mod(i - phaseAt[i], BEATS_PER_BAR)));

  const kickRel = relTo(kick, STRONG_CONTEXT), snareRel = relTo(snare, STRONG_CONTEXT);
  const hit = kickRel.map((k, i) => Math.max(k, 0.8 * snareRel[i]));
  const levels = b.map((_, i) => (isDown[i] ? (kickRel[i] >= STRONG_RATIO ? 4 : 3) : isBack[i] && snareRel[i] >= 1.0 ? 2 : 1));
  const score = hit.map((h, i) => h + 0.35 * (isDown[i] ? 1 : 0) + 0.15 * (levels[i] === 4 ? 1 : 0));
  const target = Math.max(round(n * STRONG_SHARE), 1);
  const candidates = b.map((_, i) => i).filter((i) => levels[i] === 4 || hit[i] >= STRONG_RATIO);
  const keep = candidates.map((i, k) => [i, k] as const).sort((x, y2) => -score[x[0]] + score[y2[0]] || x[1] - y2[1]).map(([i]) => i).slice(0, target);
  if (keep.length < target * 0.6) {
    const bars = b.map((_, i) => i).filter((i) => isDown[i] && !keep.includes(i)).map((i, k) => [i, k] as const).sort((x, y2) => -score[x[0]] + score[y2[0]] || x[1] - y2[1]).map(([i]) => i);
    keep.push(...bars.slice(0, target - keep.length));
  }
  const keepSet = new Set(keep);
  const strong = keep.map((i) => b[i]).sort((x, y2) => x - y2);
  const medium = b.map((_, i) => i).filter((i) => !keepSet.has(i) && clear[i] && (levels[i] >= 2 || hit[i] >= MEDIUM_RATIO)).map((i) => round(b[i], 3));
  const top = percentile(kick, 97) || 1;
  return {
    downbeats: b.filter((_, i) => isDown[i]).map((t) => round(t, 3)),
    downbeatConfidence: confidence,
    strongBeats: strong.map((t) => round(t, 3)),
    levels,
    kick: kick.map((k) => round(Math.min(k / top, 1), 3)),
    beats: b.map((t) => round(t, 3)),
    mediumBeats: medium,
  };
}
