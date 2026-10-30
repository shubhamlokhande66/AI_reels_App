import { z } from "zod";

export const mediaKindSchema = z.enum(["video", "image"]);
export const transitionSchema = z.enum(["Cut", "Fade", "Dissolve", "Push", "Wipe", "Zoom", "Flash", "Blur"]);
export const filterSchema = z.enum(["Original", "Golden", "Film", "Noir", "Soft", "Vivid", "Cinematic"]);
export const overlaySchema = z.object({ id: z.string(), text: z.string().max(300), start: z.number().min(0), end: z.number().positive(), color: z.string(), size: z.number().min(8).max(120) });
export const clipSchema = z.object({
  id: z.string(), uri: z.string(), name: z.string(), kind: mediaKindSchema, duration: z.number().positive(),
  sourceDuration: z.number().positive(), start: z.number().min(0), end: z.number().positive(), speed: z.number().min(0.25).max(4),
  reverse: z.boolean(), muted: z.boolean(), volume: z.number().min(0).max(2), filter: z.string(), transition: z.string(),
  rotation: z.number(), mirror: z.boolean(), flip: z.boolean(), fit: z.enum(["cover", "contain"]),
  // the studio's effect during the shot (its name: punch, shake, glow…) when the website's engine made the Reel
  effect: z.string().optional(),
}).refine((clip) => clip.end <= clip.sourceDuration && clip.end > clip.start, { message: "The selected clip range must be inside the original media." });
export const projectSchema = z.object({
  id: z.string(), title: z.string().max(120), kind: z.enum(["music", "talking", "photo", "copy", "story"]), clips: z.array(clipSchema).min(1),
  audioUri: z.string().optional(), audioName: z.string().optional(), templateId: z.string().optional(), overlays: z.array(overlaySchema),
  createdAt: z.string(), updatedAt: z.string(), status: z.enum(["draft", "rendered"]), outputUri: z.string().optional(),
  // the Create flow's choices: how much of the song (seconds, 0 = all), the clip order, the format, a Talking Reel's pauses and music under the voice, and what was asked of Shubix AI
  // the song as the website's engine heard it (its tempo, beats, drops, breaks), and whether that engine made the Reel (its shots: the clips)
  music: z.object({ duration: z.number(), bpm: z.number(), beats: z.number(), drops: z.number(), breaks: z.number() }).optional(), studio: z.boolean().optional(),
  settings: z.object({ start: z.number().min(0), length: z.number(), order: z.enum(["mix", "order"]), aspect: z.enum(["9:16", "4:5", "1:1", "16:9"]), pace: z.enum(["tight", "natural", "relaxed", "off"]), under: z.string(), wish: z.string().max(800),
    // the studio's choices in the editor's tools (as the website's): style, filter, Shubix touch-ups, hook, text style, the clips' sound, background
    mode: z.string(), look: z.string(), touch: z.boolean(), hook: z.string().max(40), tstyle: z.string(), csnd: z.string(), bg: z.string() }).partial().optional(),
});
export type ProjectClip = z.infer<typeof clipSchema>;
export type ReelProject = z.infer<typeof projectSchema>;
export type TimelineTool = "Media" | "Stickers" | "Filters" | "Style" | "Shots" | "Music" | "Text" | "Captions" | "Background" | "Layers" | "Voice" | "Motion";
export type ClipAction = "Transition" | "Effect" | "Speed" | "Split" | "Duplicate" | "Freeze" | "Volume" | "Extract audio" | "Crop" | "Reverse" | "Rotate" | "Mirror" | "Flip" | "Fit canvas" | "Border" | "Adjust" | "Speed curve" | "Stabilize" | "Beauty" | "Fade" | "Mosaic" | "Magnifier" | "Slip" | "Trim" | "Reset" | "Delete";

export function clipDuration(clip: Pick<ProjectClip, "start" | "end" | "speed">) { return Math.max(0, (clip.end - clip.start) / clip.speed); }
export function projectDuration(clips: ProjectClip[]) { return clips.reduce((total, clip) => total + clipDuration(clip), 0); }
export function makeClip(source: { id?: string; uri: string; name?: string | null; kind?: "video" | "image"; duration?: number | null }, id: string): ProjectClip {
  const sourceDuration = source.kind === "image" ? 5 : Math.max(0.5, source.duration || 5);
  return { id, uri: source.uri, name: source.name || "Moment", kind: source.kind || "video", duration: sourceDuration, sourceDuration, start: 0, end: sourceDuration, speed: 1, reverse: false, muted: false, volume: 1, filter: "Original", transition: "Cut", rotation: 0, mirror: false, flip: false, fit: "cover" };
}
export function splitClip(clip: ProjectClip, newId: string): [ProjectClip, ProjectClip] | null {
  const mid = clip.start + (clip.end - clip.start) / 2;
  if (mid - clip.start < 0.2 || clip.end - mid < 0.2) return null;
  return [{ ...clip, end: mid }, { ...clip, id: newId, start: mid, transition: "Cut" }];
}
