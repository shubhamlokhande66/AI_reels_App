import { round } from "@shubix/core/engine/core/py";
import type { AudioAnalysis } from "../models/analysis";

/** Key beats: the beats an editor cuts on. Only detected beats are scored (nothing is added or moved); the score comes
 * from measured evidence, strongest first:
 *   drop     - a measured sudden energy rise within half a beat                       1.0
 *   section  - the start of a new part of the song (verse, chorus, ...)             0.9
 *   bar      - a bar start, only when the bar phase was established (meter set)      0.75
 *   hit      - how hard the kick / snare attack on this beat is, ranked against the beats around it (top quarter of
 *              the neighbourhood = a key beat), so quiet intros and loud choruses both get their own key beats.
 * A beat with score >= KEY_SCORE is a key beat. */

export interface ScoredBeat { t: number; score: number; why: "drop" | "section" | "bar" | "hit" | "beat" }
export const KEY_SCORE = 0.6;
const HIT_BEFORE = 0.07, HIT_AFTER = 0.05, RANK_BEATS = 8, HIT_WEIGHT = 0.8;

const cache = new WeakMap<AudioAnalysis, ScoredBeat[]>();

/** Every detected beat of the song with its score (cached per analysis). */
export function scoreBeats(a: AudioAnalysis): ScoredBeat[] {
  const known = cache.get(a);
  if (known) return known;
  const beats = [...a.beats].sort((x, y) => x - y);
  const gaps = beats.slice(1).map((t, i) => t - beats[i]).sort((x, y) => x - y);
  const period = gaps.length ? gaps[gaps.length >> 1] : a.bpm > 0 ? 60 / a.bpm : 0.5;
  const drops = (a.dropTimes?.length ? a.dropTimes : a.drops) ?? [];
  const sections = a.songSections.slice(1).map((s) => s.start);
  const downs = a.meter ? a.downbeats : [];
  const near = (xs: number[], t: number, tol: number) => xs.some((x) => Math.abs(x - t) <= tol);
  // the attack on each beat: the strongest low / mid band transient just around it
  const percussive = (a.transients ?? []).filter((x) => x.band !== "high");
  const hits = beats.map((b) => percussive.reduce((m, x) => (b - HIT_BEFORE <= x.t && x.t <= b + HIT_AFTER ? Math.max(m, x.strength) : m), 0));
  const out = beats.map((t, i): ScoredBeat => {
    if (near(drops, t, period / 2)) return { t, score: 1, why: "drop" };
    if (near(sections, t, period / 2)) return { t, score: 0.9, why: "section" };
    if (near(downs, t, 0.03)) return { t, score: 0.75, why: "bar" };
    if (hits[i] <= 0) return { t, score: 0, why: "beat" };
    const around = hits.slice(Math.max(0, i - RANK_BEATS), i + RANK_BEATS + 1);
    const rank = around.filter((h) => h < hits[i]).length / Math.max(around.length - 1, 1); // 0 = weakest nearby, 1 = strongest
    const score = round(HIT_WEIGHT * rank, 3);
    return { t, score, why: score >= KEY_SCORE ? "hit" : "beat" };
  });
  cache.set(a, out);
  return out;
}

/** Key beats between start and end (song seconds). */
export const keyBeats = (a: AudioAnalysis, start = 0, end = a.duration) => scoreBeats(a).filter((b) => b.score >= KEY_SCORE && start <= b.t && b.t <= end);

/** The score of the beat at t (0 when no beat is within tol). */
export function beatScore(a: AudioAnalysis, t: number, tol = 0.06): number {
  let best = 0;
  for (const b of scoreBeats(a)) if (Math.abs(b.t - t) <= tol) best = Math.max(best, b.score);
  return best;
}
