import { z } from "zod";
import { newId } from "@/server/core/py";
import REGISTRY from "@/server/video/registry.json";

/** The Timeline (the Edit Decision List): the single, editable source of truth for a Reel - the same shape and
 * defaults as the Python model (backend/app/models/timeline.py). Field names are the camelCase ones stored in MongoDB
 * and sent to the app. `parseTimeline` fills defaults like Pydantic did. */

export const TRANSITION_TYPES: readonly string[] = REGISTRY.transitions;
export const EFFECT_TYPES: readonly string[] = REGISTRY.effects;
export const GRADES: readonly string[] = REGISTRY.grades;

export const EASES = ["linear", "ease_in", "ease_out", "ease_in_out", "hold"] as const;
export const KEYFRAME_PROPS = ["zoom", "x", "y", "rotation", "opacity", "blur", "brightness", "speed"] as const;
export type KeyframeProp = (typeof KEYFRAME_PROPS)[number];

const num = z.number();
const opt = num.nullable().optional().transform((v) => (v === undefined ? null : v));

export const Keyframe = z.object({
  t: num, zoom: opt, x: opt, y: opt, rotation: opt, opacity: opt, blur: opt, brightness: opt, speed: opt,
  ease: z.enum(EASES).default("linear"),
});
export type Keyframe = z.infer<typeof Keyframe>;

export const Transition = z.object({ type: z.string().default("cut"), duration: num.default(0) });
export type Transition = z.infer<typeof Transition>;

export const CropSpec = z.object({
  framing: z.enum(["auto", "fill", "fit"]).default("auto"),
  focusX: num.min(0).max(1).nullable().default(null),
  focusY: num.min(0).max(1).nullable().default(null),
});
export type CropSpec = z.infer<typeof CropSpec>;

export const Segment = z.object({
  id: z.string().default(newId),
  clipId: z.string(),
  video: z.string(),
  sourceStart: num,
  sourceEnd: num,
  timelineStart: num,
  timelineEnd: num,
  speed: num.default(1),
  effect: z.string().default("none"),
  keyframes: z.array(Keyframe).default([]),
  looks: z.array(z.string()).default([]),
  focusX: num.default(0.5),
  focusY: num.default(0.5),
  focusSource: z.string().default("center"),
  crop: CropSpec.prefault({}),
  volume: num.default(1),
  transitionIn: Transition.prefault({}),
  caption: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  locked: z.boolean().default(false),
});
export type Segment = z.infer<typeof Segment>;
export const segLength = (s: Pick<Segment, "timelineStart" | "timelineEnd">) => s.timelineEnd - s.timelineStart;

export const CaptionWord = z.object({ text: z.string(), start: num, end: num });
export type CaptionWord = z.infer<typeof CaptionWord>;
export const Caption = z.object({ id: z.string().default(newId), start: num, end: num, text: z.string(), words: z.array(CaptionWord).default([]) });
export type Caption = z.infer<typeof Caption>;

export const VoiceLine = z.object({ text: z.string(), start: num, end: num });
export const VoiceTrack = z.object({
  fileKey: z.string(), duration: num, start: num.default(0.3), volume: num.min(0).max(2).default(1), duckMusic: z.boolean().default(true),
  lines: z.array(VoiceLine).default([]), profileName: z.string().default(""), language: z.string().default("en"),
});
export type VoiceTrack = z.infer<typeof VoiceTrack>;

export const Watermark = z.object({
  logoKey: z.string(), position: z.enum(["br", "bl", "tr", "tl", "center"]).default("br"),
  opacity: num.min(0.05).max(1).default(0.85), scale: num.min(0.04).max(0.6).default(0.16),
  // null = on every frame; a time = the logo appears only from that second on (Instagram recommends fewer Reels with a logo
  // on screen, so a Reel made for Instagram shows the brand only on its closing seconds)
  showFrom: num.min(0).nullable().default(null),
});
export type Watermark = z.infer<typeof Watermark>;

export const OVERLAY_MAX_CHARS = 66; // your own text is kept whole: up to 3 lines of about 22 characters
export const OVERLAY_MAX_WORDS = 12;
export const AI_TEXT_MAX_WORDS = 7; // text the AI writes itself stays short (a hook is read in a second)
export const TextOverlay = z.object({
  id: z.string().default(newId),
  text: z.string().max(OVERLAY_MAX_CHARS),
  start: num.min(0),
  end: num.min(0),
  role: z.enum(["hook", "benefit", "product", "emotion", "cta", "text"]).default("text"),
  position: z.enum(["top", "center", "bottom"]).default("top"),
  animation: z.enum(["fade", "slide_up", "scale", "type_on", "blur_sharp", "mask_reveal"]).default("fade"),
  size: z.enum(["small", "medium", "large"]).default("medium"),
});
export type TextOverlay = z.infer<typeof TextOverlay>;

export const SoundEffect = z.object({ type: z.enum(["whoosh", "impact", "riser", "pop"]), at: num.min(0), volume: num.min(0).max(1).default(0.6) });
export type SoundEffect = z.infer<typeof SoundEffect>;

export const AIInfo = z.object({
  provider: z.string(), model: z.string().default(""), local: z.boolean().default(true), tasks: z.array(z.string()).default([]),
  director: z.boolean().default(false), fallbackUsed: z.boolean().default(false),
});

export const EDL_VERSION = "2.0";

export const Timeline = z.object({
  edlVersion: z.string().default(EDL_VERSION),
  duration: num,
  bpm: num.default(0),
  audioStart: num.default(0),
  style: z.string().default("fast_trending"),
  segments: z.array(Segment),
  captions: z.array(Caption).default([]),
  captionStyle: z.string().default("minimal"),
  musicVolume: num.default(1),
  musicFadeIn: num.nullable().default(null),
  musicFadeOut: num.nullable().default(null),
  pictureFade: num.nullable().default(null),
  voice: VoiceTrack.nullable().default(null),
  watermark: Watermark.nullable().default(null),
  captionFont: z.string().nullable().default(null),
  captionColor: z.string().nullable().default(null),
  colorGrade: z.string().nullable().default(null),
  overlays: z.array(TextOverlay).default([]),
  musicHits: z.array(num).default([]),
  sfx: z.array(SoundEffect).default([]),
  ai: AIInfo.nullable().default(null),
  brief: z.record(z.string(), z.unknown()).nullable().default(null),
  creativePlan: z.record(z.string(), z.unknown()).nullable().default(null),
  warnings: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type Timeline = z.infer<typeof Timeline>;

/** A stored or sent timeline with every default filled in (throws a ZodError on a broken one). */
export const parseTimeline = (doc: unknown): Timeline => Timeline.parse(doc);

/** Timelines saved before segments had ids: every segment / caption gets a stable one (in place, like ensure_ids). */
export function ensureIds<T extends { segments?: { id?: string }[]; captions?: { id?: string }[] }>(doc: T): T {
  for (const s of doc.segments ?? []) s.id ??= newId();
  for (const c of doc.captions ?? []) c.id ??= newId();
  return doc;
}
