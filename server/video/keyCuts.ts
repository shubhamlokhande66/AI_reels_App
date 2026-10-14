import { round } from "@/server/core/py";
import { keyBeats } from "@/server/audio/keyBeats";
import type { AudioAnalysis } from "@/server/models/analysis";
import type { Segment, Timeline } from "@/server/models/timeline";

/** The strict rule of a music Reel: every cut is ON a key beat (or on a beat, when the user chose "every beat").
 * Whatever planned the edit (the AI director, the beat plan, the rules, a revise), this runs last:
 *   - a cut already on a key beat stays exactly there;
 *   - a cut anywhere else moves onto the nearest key beat after the previous cut;
 *   - when no key beat is left for it (two cuts would share one), the two shots become one: no cut is ever put between
 *     key beats.
 * Moving a cut changes where the shot before it ends and where the shot after it starts (the footage shifts with it;
 * a shot that runs past the end of its clip holds its last frame). Returns how many cuts moved or were merged. */

const SAME = 0.01, MIN_GAP = 0.1;

function setStart(s: Segment, t: number) {
  s.sourceStart = round(s.sourceEnd - (s.timelineEnd - t) * s.speed, 3);
  if (s.sourceStart < 0) { s.sourceEnd = round(s.sourceEnd - s.sourceStart, 3); s.sourceStart = 0; }
  s.timelineStart = round(t, 3);
}
function setEnd(s: Segment, t: number) {
  s.sourceEnd = round(s.sourceStart + (t - s.timelineStart) * s.speed, 3);
  s.timelineEnd = round(t, 3);
}

export function cutsOnKeyBeats(tl: Pick<Timeline, "segments" | "audioStart" | "duration">, audio: AudioAnalysis, everyBeat = false): number {
  const segs = tl.segments;
  if (segs.length < 2) return 0;
  const songTimes = everyBeat ? audio.beats : keyBeats(audio).map((k) => k.t);
  const points = songTimes.map((t) => round(t - tl.audioStart, 3)).filter((t) => t > MIN_GAP && t < tl.duration - MIN_GAP);
  if (!points.length) return 0;
  let changed = 0;
  for (let i = 1; i < segs.length; i++) {
    const prev = segs[i - 1], seg = segs[i], cut = seg.timelineStart;
    const after = points.filter((p) => p >= prev.timelineStart + MIN_GAP && p <= seg.timelineEnd - MIN_GAP); // keeps both shots
    if (after.some((p) => Math.abs(p - cut) < SAME)) continue; // already on a key beat
    if (!after.length) {
      // no key beat between the shot before and the end of this one: the two shots become one (the cut is removed)
      setEnd(prev, seg.timelineEnd);
      segs.splice(i, 1);
      i--;
      changed++;
      continue;
    }
    const to = after.reduce((a, p) => (Math.abs(p - cut) < Math.abs(a - cut) ? p : a));
    setEnd(prev, to);
    setStart(seg, to);
    changed++;
  }
  return changed;
}
