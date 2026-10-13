import { fixed, round } from "@/server/core/py";
import type { AudioAnalysis } from "@/server/models/analysis";
import { meanEnergy } from "@/server/models/analysis";
import { KEYFRAME_PROPS, segLength, type Keyframe, type Segment } from "@/server/models/timeline";
import * as kfx from "@/server/video/keyframes";

/** Keyframes and speed ramps for a Reel cut by the beat map, from the music (was backend/app/director/plan_motion.py):
 * a slow push-in in calm shots, punches on strong beats in loud ones, a ramp into / off the drop, slow motion on one
 * isolated hard hit; at most MAX_RAMPS ramps per Reel, and only where the clip has the footage. */

const CALM_ENERGY = 0.45, CALM_MIN = 1.2, PUSH_IN = 1.06, PUNCH = 1.08, PUNCH_DECAY = 0.2, MAX_PUNCHES = 3, EDGE = 0.15, DROP_NEAR = 0.12;
const INTO_DROP_MIN = 0.7, OFF_DROP_MIN = 0.6, SHIFT_MAX = 0.5, SLOW_HIT_MIN = 1.8, HARD_HIT = 0.9, MAX_RAMPS = 3;
const KEEP_OWN = ["beat_flash", "beat_stutter", "shake", "roll", "freeze", "speed_ramp"];
const near = (times: number[], t: number, tol: number) => times.some((x) => Math.abs(x - t) <= tol);

export interface Shot { start: number; end: number; effect: string; wayIn: number }
export interface Motion { keyframes: Keyframe[]; labels: string[]; ramp: string; rampNote: string }

export function decide(shots: Shot[], audio: AudioAnalysis, audioStart: number, fits?: (k: number, frames: Keyframe[]) => boolean): Motion[] {
  const drops = [...audio.drops].sort((a, b) => a - b);
  const strong = [...audio.strongBeats].sort((a, b) => a - b);
  const hard = audio.accents.filter((_, i) => (audio.accentStrengths[i] ?? 0) >= HARD_HIT).sort((a, b) => a - b);
  const period = audio.bpm ? 60 / audio.bpm : 0.5;
  const reach = Math.max(DROP_NEAR, period * 0.6);
  const onDrop = (sh: Shot) => sh.effect === "crash_zoom" || near(drops, audioStart + sh.start + sh.wayIn / 2, reach);
  const out: Motion[] = [];
  let ramps = 0, slowHitUsed = false;
  shots.forEach((sh, k) => {
    const m: Motion = { keyframes: [], labels: [], ramp: "", rampNote: "" };
    out.push(m);
    const len = sh.end - sh.start;
    if (KEEP_OWN.includes(sh.effect) || len < 0.3) return;
    const a = audioStart + sh.start, b = audioStart + sh.end;
    let frames: Keyframe[] = [];
    const loud = meanEnergy(audio, a, b) >= CALM_ENERGY;
    if (!loud && len >= CALM_MIN && ["none", "zoom_in", "zoom_pulse", "ken_burns"].includes(sh.effect)) {
      frames.push(kfx.kf(0, { zoom: 1 }), kfx.kf(round(len, 3), { zoom: PUSH_IN }, "ease_in_out"));
      m.labels.push("Slow push-in");
    }
    if (loud && sh.effect !== "crash_zoom") {
      const hits = strong.filter((h) => a + EDGE < h && h < b - EDGE).slice(0, MAX_PUNCHES).map((h) => h - a);
      if (hits.length) {
        const base = frames.length ? frames : [kfx.kf(0, { zoom: 1 })];
        const track = kfx.tracks(base).zoom ?? [[0, 1, "linear"]];
        frames = [...base];
        for (const h of hits) {
          const z = kfx.valueAt(track, h, 1);
          frames.push(kfx.kf(round(h - 0.001, 4), { zoom: z }, "hold"), kfx.kf(round(h, 4), { zoom: round(z * PUNCH, 4) }, "hold"),
            kfx.kf(round(Math.min(h + PUNCH_DECAY, len), 4), { zoom: round(kfx.valueAt(track, h + PUNCH_DECAY, 1), 4) }, "ease_out"));
        }
        m.labels.push(`Punch on ${hits.length} strong beat${hits.length > 1 ? "s" : ""}`);
      }
    }
    let speed: Keyframe[] = [];
    let kind = "", why = "", label = "";
    const nxt = shots[k + 1];
    if (ramps < MAX_RAMPS && nxt && onDrop(nxt) && !onDrop(sh) && len >= INTO_DROP_MIN) {
      [kind, speed, why, label] = ["into_drop", kfx.rampPreset("into_drop", len), `into the drop at ${fixed(nxt.start, 2)}s`, "Ramp into the drop (0.6x to 2x)"];
    } else if (ramps < MAX_RAMPS && k > 0 && onDrop(sh) && len >= OFF_DROP_MIN) {
      [kind, speed, why, label] = ["out_of_drop", kfx.rampPreset("out_of_drop", len), `off the drop at ${fixed(sh.start, 2)}s`, "Fast off the drop (2x to 1x)"];
    } else if (ramps < MAX_RAMPS && !slowHitUsed && !loud && len >= SLOW_HIT_MIN) {
      const hit = hard.find((h) => a + 0.5 < h && h < b - 0.7);
      if (hit !== undefined) {
        const at = hit - a;
        [kind, speed, why, label] = ["slow_hit", kfx.rampPreset("slow_hit", len, at), `slow motion on the hit at ${fixed(sh.start + at, 2)}s`, `Slow motion on the hit (${fixed(at, 2)}s in, 0.35x)`];
      }
    }
    if (speed.length && (!fits || fits(k, speed))) {
      frames = frames.length ? kfx.merge(frames, speed) : speed;
      ramps++;
      m.ramp = kind;
      m.rampNote = why;
      m.labels.push(label);
      slowHitUsed ||= kind === "slow_hit";
    }
    if (frames.length) [m.keyframes] = kfx.validate(frames, len);
  });
  return out;
}

/** The Reel's shots get their keyframes and ramps (in place). Returns notes for the person. */
export function addMotion(segments: Segment[], audio: AudioAnalysis, audioStart: number, clipSeconds: Record<string, number> = {}): string[] {
  const fits = (k: number, frames: Keyframe[]) => {
    const seg = segments[k];
    const span = kfx.sourceSeconds(frames, segLength(seg));
    const dur = clipSeconds[seg.clipId];
    if (dur === undefined || seg.sourceStart + span <= dur - 0.05) return true;
    const start = dur - 0.05 - span;
    if (start >= 0 && seg.sourceStart - start <= SHIFT_MAX) {
      seg.sourceStart = round(start, 3);
      return true;
    }
    return false;
  };
  const motions = decide(segments.map((s) => ({ start: s.timelineStart, end: s.timelineEnd, effect: s.effect, wayIn: s.transitionIn.duration })), audio, audioStart, fits);
  segments.forEach((seg, i) => {
    const m = motions[i];
    if (!m.keyframes.length) return;
    seg.keyframes = m.keyframes;
    if (kfx.hasSpeed(seg.keyframes)) {
      const span = kfx.sourceSeconds(seg.keyframes, segLength(seg));
      seg.speed = round(span / Math.max(segLength(seg), 1e-6), 4);
      seg.sourceEnd = round(seg.sourceStart + span, 3);
    }
  });
  const pushed = motions.filter((m) => m.labels.some((l) => l.startsWith("Slow push"))).length;
  const punched = motions.filter((m) => m.labels.some((l) => l.startsWith("Punch"))).length;
  const notes: string[] = [];
  if (pushed || punched) notes.push(`Motion from the music: ${pushed} slow push-in${pushed !== 1 ? "s" : ""} in calm shots, punches on the strong beats in ${punched} shot${punched !== 1 ? "s" : ""}.`);
  const ramps = motions.filter((m) => m.ramp).map((m) => m.rampNote);
  if (ramps.length) notes.push(`Speed ramps: ${ramps.join("; ")}.`);
  return notes;
}

/** A keyframe as Pydantic's model_dump(exclude_none=True): only the properties it sets. */
export const compactKeyframe = (k: Keyframe) => Object.fromEntries([["t", k.t], ...KEYFRAME_PROPS.filter((p) => k[p] !== null && k[p] !== undefined).map((p) => [p, k[p]]), ["ease", k.ease]]);

/** The plan table's cut rows (song time) get the motion their shot will have. */
export function annotatePlan(rows: Record<string, unknown>[], audio: AudioAnalysis): void {
  const cuts = rows.filter((r) => r.kind === "cut");
  const motions = decide(cuts.map((r) => ({ start: r.t as number, end: r.end as number, effect: (r.effect as string) ?? "none", wayIn: Number(r.tdur || 0) })), audio, 0);
  cuts.forEach((r, i) => {
    r.motion = motions[i].labels;
    r.ramp = motions[i].ramp;
    r.keyframes = motions[i].keyframes.map(compactKeyframe);
  });
}
