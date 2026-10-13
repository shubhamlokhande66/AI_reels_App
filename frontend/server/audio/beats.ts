import { round } from "@/server/core/py";
import { backfillBeats, bpmFromBeats, foldBpm } from "./bpm";
import { framesToTime, timeToFrames } from "./dsp/spectral";
import { argmax, max, median, percentile } from "./dsp/util";
import type { EssentiaBeats } from "./essentia";
import * as tempo from "./tempo";

/** Beats, tempo and strong beats (was backend/app/audio/beat_detector.py). The beats come from Essentia's
 * RhythmExtractor2013 (multifeature: five onset functions, the beats they agree on; it follows tempo changes itself).
 * Around it: half / double-time mistakes fixed (a skipped beat added only where the music really hits), the opening
 * back-filled, tempo sections, a confidence per beat, and bar starts. */

export interface BeatResult {
  bpm: number;
  confidence: number;
  beats: number[];
  strongBeats: number[];
  onsets: number[];
  tempoSections: tempo.TempoSection[];
  beatConfidences: number[];
  downbeats: number[];
  downbeatConfidence: number;
}

const HALF_TIME_OVER_TYPICAL = 2.0, HALF_TIME_MIN_SHARE = 0.25, HALF_TIME_SEARCH = 3;
const frameOf = (env: Float64Array, t: number) => Math.min(Math.max(timeToFrames(t), 0), env.length - 1);

/** The tracker kept every second beat: a beat is added in a gap only where the music really hits there, at the hit. */
export function fillHalfTime(beats: number[], env: Float64Array): number[] {
  if (beats.length < 2) return beats;
  const peak = (f: number) => max(env, Math.max(f - HALF_TIME_SEARCH, 0), Math.min(f + HALF_TIME_SEARCH + 1, env.length));
  const on = median(beats.map((t) => peak(frameOf(env, t))));
  const need = Math.max(HALF_TIME_OVER_TYPICAL * median(env), HALF_TIME_MIN_SHARE * on);
  const added: number[] = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    const f = timeToFrames((beats[i] + beats[i + 1]) / 2);
    const lo = Math.max(f - HALF_TIME_SEARCH, 0), hi = Math.min(f + HALF_TIME_SEARCH + 1, env.length);
    if (hi > lo && max(env, lo, hi) >= need) added.push(framesToTime(argmax(env, lo, hi)));
  }
  return added.length ? [...beats, ...added].sort((a, b) => a - b) : beats;
}

/** Bar downbeats (best 4-beat phase) plus beats with unusually strong onsets (the fallback before accents.ts). */
function strongBeats(beats: number[], env: Float64Array): number[] {
  if (beats.length < 4) return beats;
  const strength = beats.map((t) => env[frameOf(env, t)]);
  const phase = argmax([0, 1, 2, 3].map((p) => strength.filter((_, i) => i % 4 === p).reduce((a, b) => a + b, 0)));
  const loud = percentile(strength, 75);
  return beats.filter((_, i) => i % 4 === phase || strength[i] >= loud);
}

const uniformGrid = (bpm: number, duration: number) => {
  const period = 60 / bpm;
  return Array.from({ length: Math.trunc(duration / period) + 1 }, (_, i) => round(i * period, 3));
};

export function detectBeats(ess: EssentiaBeats, onsets: number[], env: Float64Array, duration: number): BeatResult {
  let beats = ess.beats.filter((t) => t >= 0 && t <= duration + 0.05);
  const rawTempo = ess.bpm;
  let sections = tempo.localTempo(env, beats, duration, foldBpm(rawTempo) || 120);
  let openingBpm = 0; // the first section's tempo, when the song changes tempo
  if (tempo.changesTempo(sections)) {
    sections = tempo.refine(sections, beats, env);
    openingBpm = sections[0].bpm;
  }
  let [bpmB, confidence] = bpmFromBeats(beats);
  let bpm = foldBpm(bpmB > 0 ? bpmB : rawTempo);
  if (bpmB > 0 && bpm > 0) {
    const ratio = bpmB / bpm;
    if (ratio > 1.5) {
      const step = Math.round(ratio);
      beats = beats.filter((_, i) => i % step === 0); // locked to double time: every 2nd beat
    } else if (ratio < 0.67) {
      const filled = fillHalfTime(beats, env); // locked to half time: the beats it skipped, where they hit
      if (filled.length > beats.length) {
        beats = filled;
        [bpmB, confidence] = bpmFromBeats(beats);
        bpm = foldBpm(bpmB);
      }
    }
  }
  if (beats.length < 4 || bpm <= 0) {
    bpm = foldBpm(rawTempo) || 120;
    beats = uniformGrid(bpm, duration);
    confidence = 0;
  }
  beats = backfillBeats(beats, openingBpm || bpm, confidence);
  const strong = strongBeats(beats, env);
  let final = tempo.localTempo(env, beats, duration, bpm);
  if (!tempo.changesTempo(final)) {
    const [, regular] = tempo.beatBpm(beats, 0, duration);
    const conf = round(final.length ? final.reduce((a, s) => a + s.confidence, 0) / final.length : regular, 2);
    final = [{ start: 0, end: round(duration, 3), bpm: round(bpm, 1), confidence: conf }];
  } else {
    final = tempo.refine(final, beats, env);
  }
  const [bars, barConf] = tempo.downbeats(beats, env);
  return {
    bpm: round(bpm, 2),
    confidence: round(confidence, 3),
    beats: beats.map((t) => round(t, 3)),
    strongBeats: strong.map((t) => round(t, 3)),
    onsets: onsets.map((t) => round(t, 3)),
    tempoSections: final,
    beatConfidences: tempo.beatConfidence(beats, env, final),
    downbeats: bars.map((t) => round(t, 3)),
    downbeatConfidence: barConf,
  };
}
