import { z } from "zod";
import { ValidationFailed } from "@/server/core/errors";
import { clone, fixed, g, newId, round } from "@/server/core/py";
import {
  Caption, CropSpec, EFFECT_TYPES, GRADES, Keyframe, Segment, TextOverlay, TRANSITION_TYPES, VoiceTrack, Watermark, segLength,
  type CaptionWord, type Timeline,
} from "@/server/models/timeline";
import * as kfx from "@/server/video/keyframes";
import { normalize as tidyOverlays } from "@/server/video/overlays";

/** Editing operations on the EDL (was backend/app/video/timeline_ops.py). Pure functions: no I/O, no FFmpeg. Every edit
 * - by hand in the editor, the quality auto-fix or the AI - is one of these; they are validated, ripple the timeline
 * (segments stay contiguous) and never touch source media. After each batch the timeline is normalised. */

export const MIN_SEGMENT = 0.25;
export const MIN_SPEED = 0.25, MAX_SPEED = 4.0;
export const MAX_TRANSITION_SHARE = 0.45;
export const LOOK_NAMES = ["glow", "black_white", "vignette", "sharpen"] as const;

export class EditError extends ValidationFailed {
  constructor(message: string, opts: { code?: string; details?: unknown } = {}) {
    super(message, { code: opts.code ?? "EDIT_INVALID", details: opts.details });
  }
}

export interface OpContext {
  clipDurations: Record<string, number>;
  clipNames: Record<string, string>;
  audioDuration: number | null;
}

// ---------------------------------------------------------------- operation schemas (camelCase on the wire)
const n = z.number();
const id = z.string();
const nullNum = n.nullable().default(null);
export const Operation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trim"), segmentId: id, sourceStart: nullNum, sourceEnd: nullNum }),
  z.object({ type: z.literal("set_length"), segmentId: id, length: n }),
  z.object({ type: z.literal("move"), segmentId: id, toIndex: z.number().int() }),
  z.object({ type: z.literal("split"), segmentId: id, at: n }),
  z.object({ type: z.literal("delete"), segmentId: id }),
  z.object({ type: z.literal("duplicate"), segmentId: id }),
  z.object({ type: z.literal("insert"), clipId: id, sourceStart: n.min(0).default(0), length: n.gt(0).max(60).default(3), index: z.number().int().nullable().default(null) }),
  z.object({ type: z.literal("replace"), segmentId: id, clipId: id, sourceStart: n.default(0) }),
  z.object({ type: z.literal("set_speed"), segmentId: id, speed: n }),
  z.object({ type: z.literal("set_transition"), segmentId: id, transition: z.string(), duration: nullNum }),
  z.object({ type: z.literal("set_effect"), segmentId: id, effect: z.string() }),
  z.object({ type: z.literal("set_keyframes"), segmentId: id, keyframes: z.array(Keyframe).default([]) }),
  z.object({ type: z.literal("set_looks"), segmentId: id, looks: z.array(z.string()).default([]) }),
  z.object({ type: z.literal("set_crop"), segmentId: id, crop: CropSpec }),
  z.object({ type: z.literal("set_music"), volume: n.min(0).max(2).nullable().default(null), fadeIn: n.min(0).max(10).nullable().default(null), fadeOut: n.min(0).max(10).nullable().default(null), audioStart: n.min(0).nullable().default(null) }),
  z.object({ type: z.literal("add_caption"), start: n, end: n, text: z.string().min(1).max(200) }),
  z.object({ type: z.literal("update_caption"), captionId: id, start: nullNum, end: nullNum, text: z.string().min(1).max(200).nullable().default(null) }),
  z.object({ type: z.literal("delete_caption"), captionId: id }),
  z.object({ type: z.literal("set_caption_style"), style: z.enum(["minimal", "bold", "karaoke", "highlight", "luxury"]) }),
  z.object({ type: z.literal("fit_duration"), target: n.min(1).max(600) }),
  z.object({ type: z.literal("set_voice"), voice: VoiceTrack }),
  z.object({ type: z.literal("clear_voice") }),
  z.object({ type: z.literal("set_voice_mix"), volume: n.min(0).max(2).nullable().default(null), duckMusic: z.boolean().nullable().default(null), start: n.min(0).max(10).nullable().default(null) }),
  z.object({ type: z.literal("replace_captions"), captions: z.array(z.object({ start: n, end: n, text: z.string().min(1).max(200) })).max(300) }),
  z.object({ type: z.literal("fit_to_voice"), tail: n.min(0).max(5).default(0.8) }),
  z.object({ type: z.literal("set_watermark"), watermark: Watermark }),
  z.object({ type: z.literal("clear_watermark") }),
  z.object({ type: z.literal("set_caption_look"), font: z.string().max(60).nullable().default(null), color: z.string().regex(/^(#[0-9A-Fa-f]{6})?$/).nullable().default(null) }),
  z.object({ type: z.literal("set_overlays"), overlays: z.array(TextOverlay).max(30).default([]) }),
  z.object({ type: z.literal("set_grade"), grade: z.string().nullable().default(null) }),
  z.object({ type: z.literal("set_lock"), segmentId: id, locked: z.boolean().default(true) }),
]);
export type Operation = z.infer<typeof Operation>;
type Op<T extends Operation["type"]> = Extract<Operation, { type: T }>;

// ---------------------------------------------------------------- helpers
function index(tl: Timeline, segmentId: string): number {
  const i = tl.segments.findIndex((s) => s.id === segmentId);
  if (i < 0) throw new EditError("That shot no longer exists.", { code: "SEGMENT_NOT_FOUND" });
  return i;
}

/** Make segments contiguous from 0, keeping each shot's length. */
export function relayout(tl: Timeline): void {
  let t = 0;
  for (const s of tl.segments) {
    const length = Math.max(s.timelineEnd - s.timelineStart, 0);
    s.timelineStart = round(t, 3);
    s.timelineEnd = round(t + length, 3);
    t += length;
  }
  tl.duration = round(t, 3);
}

const applyLength = (seg: Segment, length: number) => {
  seg.timelineEnd = seg.timelineStart + length;
};

/** The source range from length and speed, kept inside the clip. */
function fitSource(seg: Segment, clipDur: number | undefined): void {
  let span = segLength(seg) * seg.speed;
  let start = Math.max(seg.sourceStart, 0);
  if (clipDur) {
    if (span > clipDur) {
      span = clipDur;
      applyLength(seg, span / seg.speed);
    }
    start = Math.min(start, clipDur - span);
  }
  seg.sourceStart = round(Math.max(start, 0), 3);
  seg.sourceEnd = round(seg.sourceStart + span, 3);
}

function wordsFor(text: string, start: number, end: number): CaptionWord[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const step = (end - start) / parts.length;
  return parts.map((p, i) => ({ text: p, start: round(start + i * step, 3), end: round(start + (i + 1) * step, 3) }));
}

const newCaption = (start: number, end: number, text: string): Caption => Caption.parse({ start, end, text, words: wordsFor(text, start, end) });

/** Leave the timeline valid: contiguous, in-range sources, sane transitions, clamped captions. */
export function normalize(tl: Timeline, ctx: OpContext): Timeline {
  for (const s of tl.segments) {
    s.speed = Math.min(Math.max(s.speed, MIN_SPEED), MAX_SPEED);
    fitSource(s, ctx.clipDurations[s.clipId]);
  }
  relayout(tl);
  tl.segments.forEach((s, i) => {
    const t = s.transitionIn;
    if (i === 0 || t.type === "cut" || !TRANSITION_TYPES.includes(t.type)) {
      s.transitionIn = { type: "cut", duration: 0 };
      return;
    }
    const limit = MAX_TRANSITION_SHARE * Math.min(segLength(tl.segments[i - 1]), segLength(s));
    const dur = Math.min(t.duration || 0.3, limit);
    s.transitionIn = dur >= 0.06 ? { type: t.type, duration: round(dur, 3) } : { type: "cut", duration: 0 };
  });
  const caps: Caption[] = [];
  const sorted = tl.captions.map((c, i) => [c, i] as const).sort((a, b) => a[0].start - b[0].start || a[1] - b[1]).map(([c]) => c);
  for (const c of sorted) {
    const start = Math.max(c.start, 0), end = Math.min(c.end, tl.duration);
    if (end - start < 0.1 || !c.text.trim()) continue;
    const words = c.words.length && c.start === start && c.end === end ? c.words : wordsFor(c.text, start, end);
    caps.push({ id: c.id, start: round(start, 3), end: round(end, 3), text: c.text.trim(), words });
  }
  for (let i = 0; i + 1 < caps.length; i++) if (caps[i].end > caps[i + 1].start) caps[i].end = caps[i + 1].start;
  tl.captions = caps.filter((c) => c.end - c.start >= 0.1);
  if (ctx.audioDuration && tl.audioStart + tl.duration > ctx.audioDuration) tl.audioStart = round(Math.max(ctx.audioDuration - tl.duration, 0), 3);
  return tl;
}

// ---------------------------------------------------------------- operations
const tooShort = () => new EditError(`A shot must be at least ${g(MIN_SEGMENT)}s long.`, { code: "SEGMENT_TOO_SHORT" });

/** Shorten or lengthen the Reel to `target` s while keeping every shot watchable. */
export function fitToDuration(tl: Timeline, target: number, ctx: OpContext): void {
  relayout(tl);
  if (Math.abs(tl.duration - target) < 0.02) return;
  if (tl.duration > target) {
    let done = false;
    const tries = tl.segments.length; // Python: for _ in range(len(segments)) - fixed at the start
    for (let k = 0; k < tries; k++) {
      const excess = tl.duration - target;
      const room = tl.segments.map((s) => Math.max(segLength(s) - MIN_SEGMENT * 2, 0));
      const total = room.reduce((a, b) => a + b, 0);
      if (total >= excess - 1e-6) {
        tl.segments.forEach((s, i) => applyLength(s, segLength(s) - (excess * room[i]) / total));
        done = true;
        break;
      }
      if (tl.segments.length === 1) {
        applyLength(tl.segments[0], Math.max(target, MIN_SEGMENT));
        done = true;
        break;
      }
      let shortest = 0;
      tl.segments.forEach((s, i) => { if (segLength(s) < segLength(tl.segments[shortest])) shortest = i; });
      tl.segments.splice(shortest, 1);
      relayout(tl);
    }
    if (!done) throw new EditError("Could not fit the Reel to that duration.", { code: "FIT_FAILED" });
  } else {
    const need = target - tl.duration;
    const room = tl.segments.map((s) => {
      const clip = ctx.clipDurations[s.clipId];
      return Math.max(clip ? (clip - s.sourceStart) / s.speed - segLength(s) : 0, 0);
    });
    const total = room.reduce((a, b) => a + b, 0);
    if (total < need - 1e-6) throw new EditError("There is not enough footage to make the Reel that long; add clips or lower the duration.", { code: "NOT_ENOUGH_FOOTAGE" });
    tl.segments.forEach((s, i) => applyLength(s, segLength(s) + (need * room[i]) / total));
  }
  relayout(tl);
}

function shiftVoice(v: NonNullable<Timeline["voice"]>, newStart: number) {
  const d = newStart - v.start;
  v.start = newStart;
  for (const ln of v.lines) {
    ln.start = round(ln.start + d, 3);
    ln.end = round(ln.end + d, 3);
  }
}

const HANDLERS: { [T in Operation["type"]]: (tl: Timeline, op: Op<T>, ctx: OpContext) => void } = {
  trim(tl, op, ctx) {
    const s = tl.segments[index(tl, op.segmentId)];
    const start = op.sourceStart ?? s.sourceStart, end = op.sourceEnd ?? s.sourceEnd;
    if (end - start < MIN_SEGMENT * s.speed) throw tooShort();
    const clip = ctx.clipDurations[s.clipId];
    if (start < 0 || (clip && end > clip + 1e-6)) throw new EditError("The trim is outside the clip.", { code: "TRIM_OUT_OF_RANGE" });
    s.sourceStart = start;
    applyLength(s, (end - start) / s.speed);
  },
  set_length(tl, op, ctx) {
    const s = tl.segments[index(tl, op.segmentId)];
    if (op.length < MIN_SEGMENT) throw tooShort();
    const clip = ctx.clipDurations[s.clipId];
    if (clip && op.length * s.speed > clip + 1e-6) throw new EditError("The clip does not have enough footage for that length.", { code: "NOT_ENOUGH_FOOTAGE" });
    applyLength(s, op.length);
  },
  move(tl, op) {
    const i = index(tl, op.segmentId);
    if (!(op.toIndex >= 0 && op.toIndex < tl.segments.length)) throw new EditError("That position does not exist.", { code: "INDEX_OUT_OF_RANGE" });
    const [s] = tl.segments.splice(i, 1);
    tl.segments.splice(op.toIndex, 0, s);
  },
  split(tl, op) {
    const i = index(tl, op.segmentId);
    const s = tl.segments[i];
    if (!(s.timelineStart + MIN_SEGMENT <= op.at && op.at <= s.timelineEnd - MIN_SEGMENT)) throw new EditError("Split inside the shot, at least 0.25s from either end.", { code: "SPLIT_OUT_OF_RANGE" });
    const mid = s.sourceStart + (op.at - s.timelineStart) * s.speed;
    const second: Segment = { ...clone(s), id: newId(), sourceStart: mid, sourceEnd: s.sourceEnd, timelineStart: op.at, timelineEnd: s.timelineEnd, transitionIn: { type: "cut", duration: 0 }, effect: "none" };
    s.sourceEnd = mid;
    s.timelineEnd = op.at;
    tl.segments.splice(i + 1, 0, second);
  },
  delete(tl, op) {
    const i = index(tl, op.segmentId);
    if (tl.segments.length === 1) throw new EditError("A Reel needs at least one shot.", { code: "LAST_SEGMENT" });
    tl.segments.splice(i, 1);
  },
  duplicate(tl, op) {
    const i = index(tl, op.segmentId);
    tl.segments.splice(i + 1, 0, { ...clone(tl.segments[i]), id: newId(), transitionIn: { type: "cut", duration: 0 } });
  },
  insert(tl, op, ctx) {
    const dur = ctx.clipDurations[op.clipId];
    if (Object.keys(ctx.clipDurations).length && dur === undefined) throw new EditError("That clip is not part of this project.", { code: "CLIP_NOT_FOUND" });
    const start = Math.min(op.sourceStart, Math.max((dur || op.sourceStart + op.length) - 0.3, 0));
    const end = dur ? Math.min(start + op.length, dur) : start + op.length;
    if (end - start < 0.2) throw new EditError("That part of the clip is too short to add.", { code: "SEGMENT_TOO_SHORT" });
    const seg = Segment.parse({ clipId: op.clipId, video: ctx.clipNames[op.clipId] ?? "clip", sourceStart: round(start, 3), sourceEnd: round(end, 3), timelineStart: 0, timelineEnd: round(end - start, 3) });
    const at = op.index === null ? tl.segments.length : Math.max(0, Math.min(op.index, tl.segments.length));
    tl.segments.splice(at, 0, seg);
  },
  replace(tl, op, ctx) {
    const s = tl.segments[index(tl, op.segmentId)];
    if (Object.keys(ctx.clipDurations).length && !(op.clipId in ctx.clipDurations)) throw new EditError("That clip is not part of this project.", { code: "CLIP_NOT_FOUND" });
    s.clipId = op.clipId;
    s.video = ctx.clipNames[op.clipId] ?? s.video;
    s.sourceStart = op.sourceStart;
    s.focusX = s.focusY = 0.5;
    s.focusSource = "center";
    s.crop = CropSpec.parse({});
  },
  set_speed(tl, op) {
    const s = tl.segments[index(tl, op.segmentId)];
    if (!(op.speed >= MIN_SPEED && op.speed <= MAX_SPEED)) throw new EditError(`Speed must be between ${g(MIN_SPEED)}x and ${g(MAX_SPEED)}x.`, { code: "SPEED_OUT_OF_RANGE" });
    s.speed = op.speed;
  },
  set_transition(tl, op) {
    const i = index(tl, op.segmentId);
    if (!TRANSITION_TYPES.includes(op.transition)) throw new EditError(`Unknown transition '${op.transition}'.`, { code: "UNKNOWN_TRANSITION", details: { available: [...TRANSITION_TYPES] } });
    if (i === 0 && op.transition !== "cut") throw new EditError("The first shot cannot have an incoming transition.", { code: "FIRST_SEGMENT_TRANSITION" });
    tl.segments[i].transitionIn = { type: op.transition, duration: op.duration || 0.3 };
  },
  set_effect(tl, op) {
    if (!EFFECT_TYPES.includes(op.effect)) throw new EditError(`Unknown effect '${op.effect}'.`, { code: "UNKNOWN_EFFECT", details: { available: [...EFFECT_TYPES] } });
    tl.segments[index(tl, op.segmentId)].effect = op.effect;
  },
  set_keyframes(tl, op, ctx) {
    const seg = tl.segments[index(tl, op.segmentId)];
    [seg.keyframes] = kfx.validate(op.keyframes, segLength(seg));
    if (kfx.hasSpeed(seg.keyframes)) {
      const span = kfx.sourceSeconds(seg.keyframes, segLength(seg));
      const clip = ctx.clipDurations[seg.clipId];
      if (clip !== undefined && seg.sourceStart + span > clip) {
        throw new EditError(`This speed ramp needs ${fixed(span, 1)}s of footage but the clip has ${fixed(clip - seg.sourceStart, 1)}s from here.`, { code: "RAMP_TOO_LONG", details: { needed: round(span, 3) } });
      }
      seg.speed = round(span / Math.max(segLength(seg), 1e-6), 4);
      seg.sourceEnd = round(seg.sourceStart + span, 3);
    }
  },
  set_looks(tl, op) {
    const bad = op.looks.filter((x) => !(LOOK_NAMES as readonly string[]).includes(x));
    if (bad.length) throw new EditError(`Unknown look '${bad[0]}'.`, { code: "UNKNOWN_LOOK", details: { available: [...LOOK_NAMES] } });
    tl.segments[index(tl, op.segmentId)].looks = [...new Set(op.looks)];
  },
  set_crop(tl, op) {
    tl.segments[index(tl, op.segmentId)].crop = op.crop;
  },
  set_music(tl, op) {
    if (op.volume !== null) tl.musicVolume = op.volume;
    if (op.fadeIn !== null) tl.musicFadeIn = op.fadeIn;
    if (op.fadeOut !== null) tl.musicFadeOut = op.fadeOut;
    if (op.audioStart !== null) tl.audioStart = op.audioStart;
  },
  add_caption(tl, op) {
    if (op.end - op.start < 0.1) throw new EditError("A caption must last at least 0.1s.", { code: "CAPTION_TOO_SHORT" });
    tl.captions.push(newCaption(op.start, op.end, op.text.trim()));
    tl.captions[tl.captions.length - 1].words = wordsFor(op.text, op.start, op.end);
  },
  update_caption(tl, op) {
    const c = tl.captions.find((x) => x.id === op.captionId);
    if (!c) throw new EditError("That caption no longer exists.", { code: "CAPTION_NOT_FOUND" });
    c.start = op.start ?? c.start;
    c.end = op.end ?? c.end;
    if (op.text !== null) c.text = op.text.trim();
    c.words = wordsFor(c.text, c.start, c.end);
  },
  delete_caption(tl, op) {
    const before = tl.captions.length;
    tl.captions = tl.captions.filter((c) => c.id !== op.captionId);
    if (tl.captions.length === before) throw new EditError("That caption no longer exists.", { code: "CAPTION_NOT_FOUND" });
  },
  set_caption_style(tl, op) {
    tl.captionStyle = op.style;
  },
  fit_duration(tl, op, ctx) {
    fitToDuration(tl, op.target, ctx);
  },
  set_voice(tl, op) {
    tl.voice = op.voice;
  },
  clear_voice(tl) {
    tl.voice = null;
  },
  set_voice_mix(tl, op) {
    if (!tl.voice) throw new EditError("There is no voice-over to adjust.", { code: "NO_VOICE" });
    if (op.volume !== null) tl.voice.volume = op.volume;
    if (op.duckMusic !== null) tl.voice.duckMusic = op.duckMusic;
    if (op.start !== null) shiftVoice(tl.voice, op.start);
  },
  replace_captions(tl, op) {
    tl.captions = op.captions.filter((c) => c.end - c.start >= 0.1 && c.text.trim()).map((c) => ({ ...newCaption(c.start, c.end, c.text.trim()), words: wordsFor(c.text, c.start, c.end) }));
  },
  fit_to_voice(tl, op, ctx) {
    if (!tl.voice) throw new EditError("There is no voice-over to fit the Reel to.", { code: "NO_VOICE" });
    fitToDuration(tl, round(tl.voice.start + tl.voice.duration + op.tail, 3), ctx);
  },
  set_watermark(tl, op) {
    tl.watermark = op.watermark;
  },
  clear_watermark(tl) {
    tl.watermark = null;
  },
  set_caption_look(tl, op) {
    if (op.font !== null) tl.captionFont = op.font.trim() || null;
    if (op.color !== null) tl.captionColor = op.color || null;
  },
  set_overlays(tl, op) {
    [tl.overlays] = tidyOverlays(op.overlays, tl.duration);
  },
  set_grade(tl, op) {
    if (op.grade !== null && !GRADES.includes(op.grade)) throw new EditError(`Unknown colour grade '${op.grade}'.`, { code: "UNKNOWN_GRADE", details: { available: [...GRADES] } });
    tl.colorGrade = op.grade;
  },
  set_lock(tl, op) {
    tl.segments[index(tl, op.segmentId)].locked = op.locked;
  },
};

// Hand edits that change a shot itself: the shot is locked so automatic changes never undo the person's choice.
const MANUAL_SHOT_OPS = new Set(["trim", "set_length", "move", "split", "duplicate", "replace", "set_speed", "set_transition", "set_effect", "set_crop"]);

/** Lock every shot the person edited by hand (both halves of a split; the copy of a duplicate). */
export function markManual(tl: Timeline, ops: Operation[]): Timeline {
  const touched = new Set(ops.filter((o) => MANUAL_SHOT_OPS.has(o.type)).map((o) => (o as { segmentId: string }).segmentId));
  if (!touched.size) return tl;
  const splits = new Set(ops.filter((o) => o.type === "split" || o.type === "duplicate").map((o) => (o as { segmentId: string }).segmentId));
  tl.segments.forEach((s, i) => {
    if (!touched.has(s.id)) return;
    s.locked = true;
    if (splits.has(s.id) && i + 1 < tl.segments.length) tl.segments[i + 1].locked = true;
  });
  return tl;
}

/** Apply `ops` in order to a copy of the timeline. All-or-nothing: any invalid op throws. */
export function applyOperations(timeline: Timeline, ops: Operation[], ctx: OpContext): Timeline {
  const tl = clone(timeline);
  for (const op of ops) {
    (HANDLERS[op.type] as (tl: Timeline, op: Operation, ctx: OpContext) => void)(tl, op, ctx);
    relayout(tl);
  }
  return normalize(tl, ctx);
}

/** Request ops checked against the schema; a bad one is the same 422 Pydantic gave. */
export function parseOps(raw: unknown): Operation[] {
  const r = z.array(Operation).safeParse(raw);
  if (!r.success) throw new ValidationFailed("Request validation failed.", { details: r.error.issues.map((i) => ({ loc: ["body", "ops", ...i.path.map(String)], msg: i.message })) });
  return r.data;
}

export const DESCRIBE: Record<string, string> = {
  trim: "Trim", set_length: "Change length", move: "Move shot", split: "Split shot", delete: "Delete shot", duplicate: "Duplicate shot", insert: "Add clip",
  replace: "Replace clip", set_speed: "Change speed", set_transition: "Change transition", set_effect: "Change effect", set_crop: "Change framing",
  set_music: "Adjust music", add_caption: "Add caption", update_caption: "Edit caption", delete_caption: "Delete caption", set_caption_style: "Caption style",
  fit_duration: "Fit to duration",
};

export const describe = (ops: Operation[]) => [...new Set(ops.map((o) => DESCRIBE[o.type] ?? o.type))].join(", ");
