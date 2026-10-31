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
  // Shot-level transform keyframes shared by the native preview and Studio renderer.
  keyframes: z.array(z.object({ t: z.number().min(0), x: z.number(), y: z.number(), s: z.number().positive(), r: z.number(), o: z.number().min(0).max(1), ez: z.string().optional(), bezier: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() })).optional(),
  // Optional source-time variable speed curve (1 = normal speed); renderers can subdivide it into constant-rate segments.
  speedRamp: z.array(z.object({ time: z.number().min(0), speed: z.number().min(0.25).max(4), easing: z.enum(["linear", "hold", "in", "out", "inOut", "inQuad", "outCubic", "outBack", "outExpo", "bezier"]).optional() })).optional(),
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
    mode: z.string(), look: z.string(), touch: z.boolean(), hook: z.string().max(40), tstyle: z.string(), csnd: z.string(), bg: z.string(), musicVolume: z.number().min(0).max(1), musicFadeIn: z.number().min(0).max(10), musicFadeOut: z.number().min(0).max(10), musicDucking: z.boolean(), musicDuckLevel: z.number().min(0.1).max(1) }).partial().optional(),
});
export type ProjectClip = z.infer<typeof clipSchema>;
export type ReelProject = z.infer<typeof projectSchema>;
export type TimelineTool = "Media" | "Stickers" | "Filters" | "Style" | "Shots" | "Music" | "Text" | "Captions" | "Background" | "Layers" | "Voice" | "Motion";
export type ClipAction = "Transition" | "Effect" | "Speed" | "Split" | "Duplicate" | "Freeze" | "Volume" | "Extract audio" | "Crop" | "Reverse" | "Rotate" | "Mirror" | "Flip" | "Fit canvas" | "Border" | "Adjust" | "Speed curve" | "Stabilize" | "Beauty" | "Fade" | "Mosaic" | "Magnifier" | "Slip" | "Trim" | "Reset" | "Delete";

export function clipDuration(clip: Pick<ProjectClip, "start" | "end" | "speed"> & Partial<Pick<ProjectClip, "speedRamp">>) {
  const sourceDuration = Math.max(0, clip.end - clip.start);
  const points = clip.speedRamp?.filter((point) => Number.isFinite(point.time) && Number.isFinite(point.speed))
    .map((point) => ({ time: Math.min(sourceDuration, Math.max(0, point.time)), speed: Math.min(4, Math.max(0.25, point.speed)), easing: point.easing ?? "linear" }))
    .sort((a, b) => a.time - b.time) ?? [];
  if (points.length < 2 || sourceDuration <= 0) return sourceDuration / clip.speed;
  const unique: typeof points = [];
  for (const point of points) {
    if (unique.length && Math.abs(unique[unique.length - 1].time - point.time) < 0.001) unique[unique.length - 1] = point;
    else unique.push(point);
  }
  if (unique[0].time > 0) unique.unshift({ time: 0, speed: unique[0].speed });
  if (unique[unique.length - 1].time < sourceDuration) unique.push({ time: sourceDuration, speed: unique[unique.length - 1].speed });
  // Match the native renderer's <=200ms constant-rate slices and integrate 1 / playback-rate.
  let outputDuration = 0;
  for (let index = 0; index < unique.length - 1; index++) {
    const left = unique[index], right = unique[index + 1];
    const span = right.time - left.time;
    const slices = Math.max(1, Math.ceil(span / 0.2));
    for (let slice = 0; slice < slices; slice++) {
      const midpoint = (slice + 0.5) / slices;
      let eased = midpoint;
      switch (right.easing) {
        case "hold": eased = 0; break;
        case "in": case "inQuad": eased = midpoint * midpoint; break;
        case "out": eased = 1 - (1 - midpoint) * (1 - midpoint); break;
        case "inOut": eased = midpoint < 0.5 ? 2 * midpoint * midpoint : 1 - Math.pow(-2 * midpoint + 2, 2) / 2; break;
        case "outCubic": eased = 1 - Math.pow(1 - midpoint, 3); break;
        case "outExpo": eased = midpoint >= 1 ? 1 : 1 - Math.pow(2, -10 * midpoint); break;
        case "outBack": { const c1 = 1.70158, c3 = c1 + 1; eased = 1 + c3 * Math.pow(midpoint - 1, 3) + c1 * Math.pow(midpoint - 1, 2); break; }
        case "bezier": {
          let lo = 0, hi = 1, t = midpoint;
          for (let step = 0; step < 18; step++) {
            const u = 1 - t, x = 3 * u * u * t * 0.25 + 3 * u * t * t * 0.25 + t * t * t;
            if (Math.abs(x - midpoint) < 1e-5) break;
            if (x < midpoint) lo = t; else hi = t;
            t = (lo + hi) / 2;
          }
          const u = 1 - t; eased = 3 * u * u * t * 0.1 + 3 * u * t * t + t * t * t; break;
        }
      }
      const speed = left.speed + (right.speed - left.speed) * eased;
      outputDuration += (span / slices) / Math.max(0.25, speed);
    }
  }
  return outputDuration;
}
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
