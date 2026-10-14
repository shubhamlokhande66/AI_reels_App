import { z } from "zod";

/** Project settings and the create / update requests (was backend/app/schemas/project.py) - the same fields, defaults,
 * ranges and choices. Unknown fields are ignored, like Pydantic. */

export const MIN_DURATION = 5;
export const MAX_DURATION = 600;

const CaptionStyle = z.enum(["minimal", "bold", "karaoke", "highlight", "luxury"]);
const Pace = z.enum(["auto", "calm", "balanced", "fast"]);
const Sequence = z.enum(["mixed", "steps", "talk"]);
const OrderMode = z.enum(["auto", "manual"]);
const AudioMode = z.enum(["music", "voice_music", "voice", "original", "none"]);
const Language = z.enum(["en", "hi", "mr", "hinglish"]);
const MinClip = z.union([z.literal(0.25), z.literal(0.35), z.literal(0.4), z.literal(0.6)]);
const optNum = (s: z.ZodNumber) => s.nullable().default(null);

export const CustomStyleParams = z.object({
  cutBeatsHigh: optNum(z.number().int().min(1).max(16)),
  cutBeatsLow: optNum(z.number().int().min(1).max(16)),
  minSegment: optNum(z.number().min(0.2).max(10)),
  maxSegment: optNum(z.number().min(0.5).max(15)),
  transitions: z.record(z.string(), z.number()).nullable().default(null),
  transitionDuration: optNum(z.number().min(0.05).max(1.5)),
  effects: z.record(z.string(), z.number()).nullable().default(null),
  slowMotionChance: optNum(z.number().min(0).max(1)),
});

export const ProjectSettings = z.object({
  duration: z.number().int().min(MIN_DURATION).max(MAX_DURATION).default(15),
  audioStart: z.number().min(0).max(36000).nullable().default(null),
  style: z.string().default("fast_trending"),
  pace: Pace.default("balanced"),
  teaser: z.boolean().default(true),
  stepLabels: z.boolean().default(true),
  orderMode: OrderMode.default("auto"),
  sequence: Sequence.default("mixed"),
  exportPreset: z.string().default("instagram_reel"),
  audioMode: AudioMode.default("music"),
  reelType: z.enum(["edit", "product", "story"]).default("edit"),
  productStyle: z.string().default("luxury_jewelry"),
  hookText: z.string().max(80).default(""),
  taglineText: z.string().max(80).default(""),
  ctaText: z.string().max(80).default(""),
  loop: z.boolean().default(false),
  language: Language.default("en"),
  voiceProfileId: z.string().nullable().default(null),
  brandId: z.string().nullable().default(null),
  brief: z.string().max(1000).default(""),
  objective: z.string().max(60).default(""),
  audience: z.string().max(60).default(""),
  concept: z.enum(["auto", "viral", "cinematic", "premium"]).default("auto"),
  captions: z.boolean().default(false),
  captionStyle: CaptionStyle.default("minimal"),
  ai: z.boolean().default(false),
  aiDirector: z.boolean().default(true),
  beatPlan: z.boolean().default(false),
  cutEveryBeat: z.boolean().default(false),
  platform: z.enum(["none", "instagram"]).default("none"), // instagram = edit, check and write copy for how Instagram ranks Reels (server/platforms)
  hardHitsOnly: z.boolean().default(false), // cut only on hard hits (drops, comebacks, dropouts, major beats); normal beats ignored
  minClip: MinClip.default(0.35),
  autoReview: z.boolean().default(true),
  soundEffects: z.boolean().default(false),
  deleteMediaAfterRender: z.boolean().default(false),
  trendId: z.string().nullable().default(null),
  reference: z.string().max(40).default("auto"),
  customStyle: CustomStyleParams.nullable().default(null),
});
export type ProjectSettings = z.infer<typeof ProjectSettings>;

const CONTROL = /[\x00-\x1f\x7f]/g;
const Name = z.string().min(1).max(120).transform((v, ctx) => {
  const clean = v.replace(CONTROL, "").trim();
  if (!clean) ctx.addIssue({ code: "custom", message: "Value error, Project name must not be empty." });
  return clean;
});

export const ProjectCreate = z.object({ name: Name, settings: ProjectSettings.prefault({}) });

/** PATCH: only the fields sent are changed (an explicit null clears a nullable field). */
export const ProjectUpdate = z.object({
  name: Name.nullable(),
  duration: z.number().int().min(MIN_DURATION).max(MAX_DURATION).nullable(),
  audioStart: z.number().min(0).max(36000).nullable(),
  style: z.string().nullable(),
  pace: Pace.nullable(),
  sequence: Sequence.nullable(),
  teaser: z.boolean().nullable(),
  stepLabels: z.boolean().nullable(),
  orderMode: OrderMode.nullable(),
  exportPreset: z.string().nullable(),
  brief: z.string().max(1000).nullable(),
  audioMode: AudioMode.nullable(),
  productStyle: z.string().nullable(),
  hookText: z.string().max(80).nullable(),
  taglineText: z.string().max(80).nullable(),
  ctaText: z.string().max(80).nullable(),
  loop: z.boolean().nullable(),
  language: Language.nullable(),
  voiceProfileId: z.string().nullable(),
  brandId: z.string().nullable(),
  captions: z.boolean().nullable(),
  captionStyle: CaptionStyle.nullable(),
  ai: z.boolean().nullable(),
  aiDirector: z.boolean().nullable(),
  beatPlan: z.boolean().nullable(),
  cutEveryBeat: z.boolean().nullable(),
  platform: z.enum(["none", "instagram"]).nullable(),
  hardHitsOnly: z.boolean().nullable(),
  minClip: MinClip.nullable(),
  autoReview: z.boolean().nullable(),
  soundEffects: z.boolean().nullable(),
  trendId: z.string().nullable(),
  reference: z.string().max(40).nullable(),
  deleteMediaAfterRender: z.boolean().nullable(),
  customStyle: CustomStyleParams.nullable(),
}).partial();
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;
