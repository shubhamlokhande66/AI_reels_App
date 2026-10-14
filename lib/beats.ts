import type { ReelPlan } from "@/types/api";

/** A cut this close to a beat/strong accent counts as "on it" — matches the app's own backend quality check. */
export const CUT_TOLERANCE = 0.08;
const ACCENT_MIN_STRENGTH = 0.6;

/** Every beat plus every real strong accent, as one sorted list of times: what "on the beat" means throughout the app. */
export function snapPoints(music: ReelPlan["music"] | undefined): number[] {
  if (!music) return [];
  const beats = music.beats.map((b) => b.t);
  const accents = music.accents.filter((a) => a.strength >= ACCENT_MIN_STRENGTH).map((a) => a.t);
  return Array.from(new Set([...beats, ...accents])).sort((a, b) => a - b);
}

export function nearestOffset(t: number, points: number[]): number {
  if (points.length === 0) return Infinity;
  let best = Infinity;
  for (const p of points) best = Math.min(best, Math.abs(p - t));
  return best;
}

export interface CutCheck {
  t: number;
  offset: number;
  onBeat: boolean;
}

/** Every internal cut (not the Reel's own start/end) checked against the beat map. */
export function checkCuts(cutTimes: number[], music: ReelPlan["music"] | undefined): CutCheck[] {
  const points = snapPoints(music);
  return cutTimes.map((t) => {
    const offset = nearestOffset(t, points);
    return { t, offset, onBeat: offset <= CUT_TOLERANCE };
  });
}
