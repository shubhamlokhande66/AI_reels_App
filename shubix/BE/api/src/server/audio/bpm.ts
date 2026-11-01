import { round } from "@shubix/core/engine/core/py";
import { diff, mean, median } from "./dsp/util";

/** Tempo helpers (was backend/app/audio/bpm.py). */

export const MIN_BPM = 70, MAX_BPM = 180;

/** Fold half / double-time estimates into a musically sensible range. */
export function foldBpm(bpm: number, lo = MIN_BPM, hi = MAX_BPM): number {
  if (bpm <= 0) return 0;
  while (bpm < lo) bpm *= 2;
  while (bpm > hi) bpm /= 2;
  return bpm;
}

/** [bpm, confidence] from the median beat interval; confidence = how regular the grid is. */
export function bpmFromBeats(beats: ArrayLike<number>): [number, number] {
  if (beats.length < 3) return [0, 0];
  const d = diff(beats);
  const med = median(d);
  if (med <= 0) return [0, 0];
  const regularity = Math.max(0, 1 - (median(Array.from(d, (x) => Math.abs(x - med))) / med) * 4);
  const steady = Array.from(d).filter((x) => x > 0.8 * med && x < 1.2 * med);
  const period = steady.length ? mean(steady) : med;
  return [60 / period, Math.min(regularity, 1)];
}

/** Extend a regular grid backwards to 0 (trackers usually miss the first beats). */
export function backfillBeats(beats: number[], bpm: number, confidence: number, minConfidence = 0.6): number[] {
  if (!beats.length || bpm <= 0 || confidence < minConfidence) return beats;
  const period = 60 / bpm;
  const extra: number[] = [];
  for (let t = beats[0] - period; t >= -0.05; t -= period) extra.push(round(Math.max(t, 0), 3));
  return extra.length ? [...extra.sort((a, b) => a - b), ...beats] : beats;
}
