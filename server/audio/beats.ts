import { round } from "@/server/core/py";
import { bpmFromBeats } from "./bpm";
import type { BeatThisResult } from "./beatThis";
import type { EssentiaBeats } from "./essentia";
import * as tempo from "./tempo";

/** Beats and tempo. The beats are Essentia's RhythmExtractor2013 (multifeature: five onset functions, the beats they agree
 * on, with a confidence) and are kept EXACTLY as detected: nothing is inserted, removed or moved afterwards. When Essentia
 * finds no usable beats, an evenly spaced grid is used instead and labelled as such (beatSource = "inferred_grid").
 *
 * Tempo: Essentia's own BPM, compared with an independent estimate (PercivalBpmEstimator) and with the beat intervals.
 * Two estimates that differ by a half / double (or 2:3) factor are a metrical-level ambiguity, not a confirmation; it is
 * reported, not resolved by changing the beats. Bars (downbeats) and the meter are only given with enough evidence. */

export type BpmAgreement = "agree" | "octave" | "disagree" | "unknown";
export interface BeatResult {
  bpm: number;
  /** Essentia's confidence scaled to 0..1 (its own scale is 0..5.32; above ~3.5 is very sure, below ~1.5 unsure) */
  confidence: number;
  essentiaConfidence: number;
  beats: number[];
  /** per beat 0..1: evidence for that beat (a hit on it, against the music around; and its spacing on the local grid) */
  beatConfidences: number[];
  beatSource: "beat_this" | "essentia" | "inferred_grid";
  /** per beat: its place in the bar, 1 = the bar start (empty when the bars are not known) */
  beatPositions: number[];
  bpmEstimates: { beatThis?: number | null; rhythmExtractor: number; percival: number | null; beatIntervals: number | null };
  bpmAgreement: BpmAgreement;
  onsets: number[];
  tempoSections: tempo.TempoSection[];
  downbeats: number[];
  downbeatConfidence: number;
  meter: 3 | 4 | null;
}

const AGREE = 0.04; // two tempo estimates within 4% are the same tempo
const OCTAVE_RATIOS = [2, 0.5, 1.5, 2 / 3, 3, 1 / 3];
const BAR_MIN_CONFIDENCE = 0.5; // below this the bar phase is not trusted, and no downbeats are given
const ESSENTIA_MAX_CONFIDENCE = 5.32;

export function compareBpm(a: number, b: number | null): BpmAgreement {
  if (!a || !b) return "unknown";
  if (Math.abs(a - b) / a <= AGREE) return "agree";
  return OCTAVE_RATIOS.some((r) => Math.abs(b / a - r) / r <= AGREE) ? "octave" : "disagree";
}

/** How loud the hit at each beat is (dB): the peak 10 ms energy just around it (a little before, for an early beat time). */
export function beatLevels(beats: number[], y: Float32Array, sr: number): number[] {
  const win = Math.max(1, Math.round(0.01 * sr));
  return beats.map((b) => {
    const a = Math.max(0, Math.round((b - 0.03) * sr)), z = Math.min(y.length, Math.round((b + 0.06) * sr));
    let best = 0;
    for (let i = a; i + win <= z; i += Math.max(1, win >> 1)) {
      let e = 0;
      for (let k = i; k < i + win; k++) e += y[k] * y[k];
      best = Math.max(best, e / win);
    }
    return 10 * Math.log10(best + 1e-12);
  });
}
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const SILENT_BELOW_DB = 40; // a bar whose loudest beat is this far under the song's loud level is silence: no evidence

/** The meter and bar phase from the evidence: for each phase of 3 or 4 beats, is that beat the loudest of its bar in most
 * bars, and is the difference large against the spread? confidence = consistency x separation (both 0..1). Medians and
 * median deviations, so a few odd bars (a fill, the silent tail) do not decide it. */
export function beatPositions(beats: number[]): number[] {
  const period = median(beats.slice(1).map((t, i) => t - beats[i]));
  const pos = [0];
  for (let i = 1; i < beats.length; i++) pos.push(pos[i - 1] + Math.max(1, Math.round((beats[i] - beats[i - 1]) / Math.max(period, 1e-6))));
  return pos;
}

export function barPhase(beats: number[], levels: number[]): { meter: 3 | 4; phase: number; confidence: number } | null {
  let best: { meter: 3 | 4; phase: number; confidence: number } | null = null;
  const loud = median([...levels].sort((a, b) => b - a).slice(0, Math.max(1, levels.length >> 2)));
  const pos = beatPositions(beats); // a missed beat leaves a gap of two periods: it still counts as two beats
  for (const m of [4, 3] as const) {
    const byBar = new Map<number, number[]>();
    pos.forEach((p, i) => {
      const bar = byBar.get(Math.floor(p / m)) ?? Array<number>(m).fill(NaN);
      bar[p % m] = levels[i];
      byBar.set(Math.floor(p / m), bar);
    });
    const bars = [...byBar.values()].filter((b) => b.every(Number.isFinite) && Math.max(...b) >= loud - SILENT_BELOW_DB);
    if (bars.length < 4) continue;
    const byPhase = Array.from({ length: m }, (_, p) => bars.map((b) => b[p]));
    const order = byPhase.map((xs, p) => [median(xs), p] as const).sort((a, b) => b[0] - a[0]);
    const p = order[0][1];
    // the margin inside each bar (that beat against the loudest other beat of the same bar): the song getting louder or
    // softer does not change it. separation = typical margin / its spread (dB, with a 0.5 dB floor)
    const margins = bars.map((b) => b[p] - Math.max(...b.filter((_, k) => k !== p)));
    const mm = median(margins), sep = mm / (1.4826 * median(margins.map((x) => Math.abs(x - mm))) + 0.5);
    const won = bars.filter((b) => b[p] >= Math.max(...b) - 1e-9).length;
    const consistency = (won / bars.length - 1 / m) / (1 - 1 / m); // 0 = chance, 1 = every bar
    const confidence = Math.round(Math.max(0, Math.min(1, consistency) * Math.min(1, sep / 3)) * 100) / 100;
    if (!best || confidence > best.confidence) best = { meter: m, phase: p, confidence };
  }
  return best;
}

const uniformGrid = (bpm: number, duration: number) => {
  const period = 60 / bpm;
  return Array.from({ length: Math.trunc(duration / period) + 1 }, (_, i) => round(i * period, 3));
};

/** Each beat's place in its bar (1 = the bar start), counted from the bar starts; the beats before the first bar start
 * count back from it (..., 3, 4, then 1). Empty when there are no bar starts. */
export function barPositions(beats: number[], downbeats: number[], meter: number): number[] {
  if (!downbeats.length || !beats.length) return [];
  const isDown = (t: number) => downbeats.some((d) => Math.abs(d - t) < 1e-3);
  const first = beats.findIndex(isDown);
  if (first < 0) return [];
  let pos = 0;
  return beats.map((t, i) => {
    if (i < first) return ((((meter - (first - i)) % meter) + meter) % meter) + 1;
    pos = isDown(t) ? 1 : pos + 1;
    return pos;
  });
}

/** Beats and bars from the neural tracker (Beat This!): its own beats and bar starts, the meter from how many beats a
 * bar has, the tempo from the beat spacing, and its probabilities as the confidence. */
function fromNetwork(net: BeatThisResult, ess: EssentiaBeats, onsets: number[], env: Float64Array, duration: number, percival: number | null): BeatResult {
  const keep = net.beats.map((t, i) => [t, net.beatProbabilities[i]] as const).filter(([t]) => t >= 0 && t <= duration + 0.05);
  const beats = keep.map(([t]) => t), probs = keep.map(([, p]) => p);
  // the tempo: a straight-line fit of beat time against beat number (the network works in 20 ms frames: one beat gap
  // is rounded to a frame, the fit over all beats is not); runs of beats with a skipped beat count it as two
  const gap = median(beats.slice(1).map((t, i) => t - beats[i]));
  const idx: number[] = [0];
  for (let i = 1; i < beats.length; i++) idx.push(idx[i - 1] + Math.max(1, Math.round((beats[i] - beats[i - 1]) / gap)));
  const mi = idx.reduce((x, y) => x + y, 0) / idx.length, mt = beats.reduce((x, y) => x + y, 0) / beats.length;
  const slope = idx.reduce((acc, k, i) => acc + (k - mi) * (beats[i] - mt), 0) / Math.max(idx.reduce((acc, k) => acc + (k - mi) ** 2, 0), 1e-9);
  const bpm = 60 / (slope > 0 ? slope : gap);
  const downbeats = net.downbeats.filter((t) => t <= duration + 0.05);
  const perBar = downbeats.slice(1).map((d, i) => beats.filter((b) => downbeats[i] - 1e-3 <= b && b < d - 1e-3).length);
  const meter: 3 | 4 | null = downbeats.length >= 2 ? (median(perBar) <= 3 ? 3 : 4) : null;
  let sections = tempo.localTempo(env, beats, duration, bpm);
  if (tempo.changesTempo(sections)) sections = tempo.refine(sections, beats, env);
  else sections = [{ start: 0, end: round(duration, 3), bpm: round(bpm, 1), confidence: round(median(probs), 2) }];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    bpm: round(bpm, 2), confidence: round(mean(probs), 3), essentiaConfidence: round(ess.confidence, 3),
    beats, beatConfidences: probs, beatSource: "beat_this", beatPositions: meter ? barPositions(beats, downbeats, meter) : [],
    bpmEstimates: { beatThis: round(bpm, 2), rhythmExtractor: round(ess.bpm, 2), percival: percival ? round(percival, 2) : null, beatIntervals: round(bpm, 2) },
    bpmAgreement: compareBpm(bpm, percival), onsets: onsets.map((t) => round(t, 3)), tempoSections: sections,
    downbeats, downbeatConfidence: round(mean(net.downbeatProbabilities), 3), meter,
  };
}

export function detectBeats(ess: EssentiaBeats, onsets: number[], env: Float64Array, duration: number, percival: number | null = null,
                            signal: { y: Float32Array; sr: number } | null = null, net: BeatThisResult | null = null): BeatResult {
  if (net && net.beats.length >= 4) return fromNetwork(net, ess, onsets, env, duration, percival);
  // fallback (the network could not run): Essentia's beats, unchanged
  const raw = ess.beats.filter((t) => t >= 0 && t <= duration + 0.05);
  const usable = raw.length >= 4 && ess.bpm > 0;
  const bpm = usable ? ess.bpm : percival || ess.bpm || 120;
  const beats = usable ? raw : uniformGrid(bpm, duration);
  const [fromIntervals] = raw.length >= 4 ? bpmFromBeats(raw) : [0];
  let sections = tempo.localTempo(env, beats, duration, bpm);
  if (tempo.changesTempo(sections)) sections = tempo.refine(sections, beats, env);
  else {
    const [, regular] = tempo.beatBpm(beats, 0, duration);
    const conf = round(sections.length ? sections.reduce((a, s) => a + s.confidence, 0) / sections.length : regular, 2);
    sections = [{ start: 0, end: round(duration, 3), bpm: round(bpm, 1), confidence: conf }];
  }
  // the meter and bar phase only when one clearly fits better than the other
  let downbeats: number[] = [], barConf = 0, meter: 3 | 4 | null = null;
  if (usable && signal) {
    const bar = barPhase(beats, beatLevels(beats, signal.y, signal.sr));
    if (bar && bar.confidence >= BAR_MIN_CONFIDENCE) {
      const pos = beatPositions(beats);
      downbeats = beats.filter((_, i) => pos[i] % bar.meter === bar.phase);
      barConf = bar.confidence;
      meter = bar.meter;
    }
  }
  return {
    bpm: round(bpm, 2),
    confidence: usable ? round(Math.min(Math.max(ess.confidence / ESSENTIA_MAX_CONFIDENCE, 0), 1), 3) : 0,
    essentiaConfidence: round(ess.confidence, 3),
    beats: beats.map((t) => round(t, 3)),
    beatConfidences: tempo.beatConfidence(beats, env, sections),
    beatSource: usable ? "essentia" : "inferred_grid",
    beatPositions: meter ? barPositions(beats, downbeats, meter) : [],
    bpmEstimates: { rhythmExtractor: round(ess.bpm, 2), percival: percival ? round(percival, 2) : null, beatIntervals: fromIntervals ? round(fromIntervals, 2) : null },
    bpmAgreement: compareBpm(ess.bpm, percival),
    onsets: onsets.map((t) => round(t, 3)),
    tempoSections: sections,
    downbeats: downbeats.map((t) => round(t, 3)),
    downbeatConfidence: barConf,
    meter,
  };
}
