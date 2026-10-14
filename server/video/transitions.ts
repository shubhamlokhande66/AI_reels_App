import { round } from "@/server/core/py";
import { scoreBeats } from "@/server/audio/keyBeats";
import { meanEnergy, type AudioAnalysis } from "@/server/models/analysis";
import { segLength, type Segment, type Timeline } from "@/server/models/timeline";
import { getTransition } from "./render/parts";
import { resolveTransition } from "./render/text";

/** Every cut gets a transition. Whatever chose the edit (the AI director, the beat plan, the rules, the user's revise),
 * each shot after the first is entered with a real transition:
 *   - a name the renderer knows is kept;
 *   - a name it does not know ("fade_in", "crossfade", "whip", ...) is mapped to the closest one it does;
 *   - "cut", a missing name, or one it cannot map gets a transition chosen from the music at that moment
 *     (a flash on a drop, a zoom at a new part of the song, a quick slide / zoom in loud music, a dissolve in calm music);
 *   - never the same transition twice in a row; the length always fits both shots.
 * Shots the user locked are left as they are. */

export type Moment = "drop" | "section" | "loud" | "calm";
export const PALETTE: Record<Moment, string[]> = {
  drop: ["flash", "zoom"],
  section: ["zoom", "smooth_left", "dissolve"],
  loud: ["zoom", "smooth_left", "cover_up", "smooth_right", "slide_left"],
  calm: ["dissolve", "smooth_up", "blur", "fade_grays"],
};
const SECONDS: Record<string, number> = { flash: 0.18, zoom: 0.3, dissolve: 0.45, blur: 0.35, fade: 0.5, fade_grays: 0.45, speed_ramp: 0.3 };
const DEFAULT_SECONDS = 0.3, MIN_SECONDS = 0.12, SHARE = 0.4, LOUD = 0.6;

/** The transition (and its length) for a cut at a moment of this kind, never `avoid`. */
export function chooseTransition(moment: Moment, avoid: string | null = null, k = 0): { type: string; duration: number } {
  const options = PALETTE[moment].filter((t) => t !== avoid);
  const type = options[k % options.length];
  return { type, duration: SECONDS[type] ?? DEFAULT_SECONDS };
}

/** What the music does at a Reel time (for choosing a transition). */
export function momentAt(audio: AudioAnalysis | null, audioStart: number, t: number): Moment {
  if (!audio) return "calm";
  const song = audioStart + t;
  const beat = scoreBeats(audio).find((b) => Math.abs(b.t - song) <= 0.08);
  if (beat?.why === "drop") return "drop";
  if (beat?.why === "section") return "section";
  return meanEnergy(audio, Math.max(song - 1, 0), song + 1) >= LOUD ? "loud" : "calm";
}

/** Gives every cut of the timeline a transition (see above). Returns how many shots were changed. */
export function ensureTransitions(tl: Pick<Timeline, "segments" | "audioStart">, audio: AudioAnalysis | null = null): number {
  let changed = 0, prev: string | null = null;
  tl.segments.forEach((s: Segment, i: number) => {
    if (i === 0) return; // the first shot has nothing to come from
    if (s.locked) { prev = s.transitionIn.type; return; }
    const before = JSON.stringify(s.transitionIn);
    const [named] = resolveTransition(s.transitionIn.type || "cut");
    let type = named, duration = s.transitionIn.duration;
    if (type === "cut" || type === prev) {
      const pick = chooseTransition(momentAt(audio, tl.audioStart ?? 0, s.timelineStart), prev, i);
      type = pick.type;
      duration = pick.duration;
    }
    if (getTransition(type).kind === "ramp") duration = Math.max(duration, 0);
    else {
      const fits = SHARE * Math.min(segLength(s), segLength(tl.segments[i - 1]));
      duration = round(Math.max(Math.min(duration > 0 ? duration : SECONDS[type] ?? DEFAULT_SECONDS, fits), Math.min(MIN_SECONDS, fits)), 3);
    }
    s.transitionIn = { type, duration };
    if (JSON.stringify(s.transitionIn) !== before) changed++;
    prev = type;
  });
  return changed;
}
