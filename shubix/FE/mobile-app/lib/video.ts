import { Paths } from "expo-file-system";
import { clipDuration, type ProjectClip, type ReelProject } from "@mobile/validations";
import { ShubixVideo } from "../modules/shubix-video";
import { ADJ_FRAG, BEAUTY_FRAG, GRADE_FRAG, KEY_FRAG, MAIN_FRAG, PASS_VERT, PIC_FRAG, PIC_FX, TR_DUR } from "@mobile/core/lib/shaders";
import {
  createAndroidRendererAdapter,
  createRenderJobFromProject,
  type ShubixVideoNativeModule,
} from "./rendering";
import {
  isAndroidEffectSupported,
  isAndroidFilterSupported,
  isAndroidTransitionSupported,
  normalizeAndroidTransition,
} from "./rendering/native-capabilities";

/** The Reel as an MP4, made on this phone by its video engine (modules/shubix-video). `ready`: the engine is in this
 * app (a development or Play Store build; Expo Go has not). */
export const videoEngine = { ready: !!ShubixVideo };
const SIZE: Record<string, [number, number]> = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080], "3:4": [1080, 1440], "4:3": [1440, 1080], "2:1": [1920, 960], "2.35:1": [1920, 816] };
/** Shared capability checks used by editor UI and export validation. */
export const isNativeTransitionSupported = isAndroidTransitionSupported;
export const isNativeEffectSupported = isAndroidEffectSupported;


// the studio's beat effects: the native export draws them with the studio's own shader (BeatFx, StudioTransitions.kt)
const LAYER_BLENDS = new Set(["source-over", "multiply", "screen", "overlay", "lighter", "darken", "lighten", "soft-light", "hard-light", "color-dodge", "color-burn", "difference", "exclusion"]);
const BEAT_FX = new Set(["boxgrow", "grid", "strips", "circle", "heartbeat", "starbeat", "frame", "mirror", "kaleido", "triple", "vhs", "strobe", "rgbpulse", "blurpulse"]);
/** What the native export cannot make yet for this Reel, so it stays on the studio's export (docs/native-engine.md). */
export function nativeExportGaps(p: ReelProject, layers: NativeLayerRow[]): string[] {
  const gaps = new Set<string>();
  for (const l of layers) {
    if (!l.native) gaps.add("a layer whose file is not on the phone");
    if (l.blend && !LAYER_BLENDS.has(l.blend)) gaps.add(`the ${l.blend} blend`);
  }
  for (const c of p.clips) {
    if (c.effect && c.effect !== "none" && !BEAT_FX.has(c.effect) && !isAndroidEffectSupported(c.effect)) gaps.add(`the ${c.effect} effect`);
    if (c.transition && !isAndroidTransitionSupported(c.transition) && !TR_DUR[c.transition]) gaps.add(`the ${c.transition} transition`);
    if (!isAndroidFilterSupported(c.filter)) gaps.add(`the ${c.filter} filter`);
  }
  return [...gaps];
}
export type NativeLayerRow = { native?: unknown; blend?: string };

/** `studio`: the studio's finished sound (engine.exportMix), which replaces the clips' sound and the song, and its plan: watermark, quality, frame rate. */
export async function exportReel(p: ReelProject, onProgress: (done: number) => void, studio?: { mix: string | null; layers?: NativeLayerRow[]; plan: { watermark: boolean; fps: number; bitrate: number; scale: number; stabs?: unknown[]; beats?: number[][]; follow?: (number[][] | null)[] } }) {
  const mix = studio?.mix;
  if (!ShubixVideo) throw new Error("The video engine is not in this app.");
  // a Studio Reel never stops here: what the native engine lacks is named by nativeExportGaps, and such a Reel stays on the studio's export
  const unsupported = studio ? undefined : p.clips.find((clip) =>
    clip.reverse ||
    (!!clip.transition && !isAndroidTransitionSupported(clip.transition)) ||
    (!!clip.effect && !isAndroidEffectSupported(clip.effect)) ||
    !isAndroidFilterSupported(clip.filter) ||
    (!mix && (clip.volume ?? 1) > 1)
  );
  if (unsupported?.reverse) throw new Error("Reverse playback is not supported by the current Android native export engine yet.");
  if (unsupported?.transition && !isAndroidTransitionSupported(unsupported.transition)) {
    throw new Error(`The ${unsupported.transition} transition is not supported by the current Android export engine yet. Choose Cut before exporting.`);
  }
  if (unsupported?.effect && unsupported.effect !== "none" && !isAndroidEffectSupported(unsupported.effect)) {
    throw new Error(`The ${unsupported.effect} effect is not supported by the current Android export engine yet.`);
  }
  if (unsupported && !isAndroidFilterSupported(unsupported.filter)) {
    throw new Error(`The ${unsupported.filter} filter is not supported by the current Android export engine yet.`);
  }
  if (unsupported && !mix && (unsupported.volume ?? 1) > 1) {
    throw new Error("Android export currently supports source-audio gain up to 100%. Lower this clip volume before exporting.");
  }
  const [baseW, baseH] = SIZE[p.settings?.aspect ?? "9:16"] ?? SIZE["9:16"], scale = studio?.plan.scale ?? 1;
  const width = Math.round(baseW * scale / 2) * 2, height = Math.round(baseH * scale / 2) * 2;
  const root = Paths.document.uri.replace(/^file:\/\//, "").replace(/\/$/, "");
  const safeId = p.id.replace(/[^A-Za-z0-9._-]/g, "_") || "reel";
  const output = `${root}/exports/${safeId}-${Date.now()}.mp4`;
  // a clip played backwards: its own reversed file (a Studio Reel only: its sound comes from the mix)
  const clips = studio ? await Promise.all(p.clips.map(async (c) => c.reverse && c.kind !== "image" ? { ...c, uri: await ShubixVideo!.reverseCopy(c.uri, c.start, c.end), start: 0, end: c.end - c.start, reverse: false } : c)) : p.clips;
  if (studio) for (const [i, c] of clips.entries()) clips[i] = { ...c, filter: isAndroidFilterSupported(c.filter) ? c.filter : "Original", effect: c.effect && !BEAT_FX.has(c.effect) && !isAndroidEffectSupported(c.effect) ? undefined : c.effect };
  const made = nativeSpec({ ...p, clips }, width, height);
  const spec = { ...made, output, ...(studio ? {
    watermark: studio.plan.watermark, fps: studio.plan.fps, bitrate: Math.round(studio.plan.bitrate),
    clips: withStudio(made.clips, studio, p),
    layers: (studio.layers ?? []).map((l, i) => l.native && { ...(l.native as object), ...(studio.plan.follow?.[i] ? { followPath: studio.plan.follow[i] } : {}) }).filter(Boolean),
  } : {}), ...(mix ? {
    clips: withStudio(made.clips, studio!, p).map((c) => ({ ...c, muted: true, volume: 1 })),
    audio: { uri: mix.startsWith("file:") ? mix : `file://${mix}`, start: 0, volume: 1, fadeIn: 0, fadeOut: 0, ducking: false, duckLevel: 0.35 },
  } : {}) };
  const sub = ShubixVideo.addListener("onProgress", (e) => onProgress(e.progress));
  try { return await ShubixVideo.exportReel(JSON.stringify(spec)); } finally { sub.remove(); }
}
/** each shot's steadying path and beat effect, from the studio's plan */
function withStudio<C>(clips: C[], studio: { plan: { stabs?: unknown[]; beats?: number[][] } }, p: ReelProject) {
  return clips.map((c, i) => {
    const fx = p.clips[i]?.effect;
    return { ...c, ...(studio.plan.stabs?.[i] ? { stabPath: studio.plan.stabs[i] } : {}), ...(fx && BEAT_FX.has(fx) ? { effects: [], beatFx: { id: fx, beats: studio.plan.beats?.[i] ?? [] } } : {}) };
  });
}
export const cancelExport = () => ShubixVideo?.cancel();
/** a clip that comes in with one of the studio's transitions (the first clip only with a fade in) */
const studioTr = (c: ProjectClip | undefined, i: number) => !!c && !!TR_DUR[c.transition] && (i > 0 || c.transition === "fadein");
/** the Reel for the phone's video engine (modules/shubix-video): what the export writes and the live preview plays */
function nativeSpec(p: ReelProject, width: number, height: number, preview = false) {
  return {
    width, height,
    // the studio's own shader text for its GPU passes (one copy for both engines: Shared/core/src/lib/shaders.ts)
    shaders: { vert: PASS_VERT, pic: PIC_FRAG, grade: GRADE_FRAG, adj: ADJ_FRAG, key: KEY_FRAG, main: MAIN_FRAG, beauty: BEAUTY_FRAG },
    clips: p.clips.map((clip, i) => ({
      uri: clip.uri, kind: clip.kind, start: clip.start, end: clip.end, speed: clip.speed,
      speedRamp: clip.speedRamp, keyframes: clip.keyframes, muted: clip.muted, volume: clip.volume,
      rotation: clip.rotation, mirror: clip.mirror, flip: clip.flip, fit: clip.fit, filter: clip.filter,
      effects: clip.effect && clip.effect !== "none" && !PIC_FX[clip.effect] && (!preview || isAndroidEffectSupported(clip.effect)) ? [{ type: clip.effect, intensity: 0.5 }] : [],
      ...(clip.effect && PIC_FX[clip.effect] ? { pic: { kind: PIC_FX[clip.effect], amt: 1 } } : {}),
      // the studio's settings of this shot (Adjust and its keyframes; Curves / HSL as the grade pass)
      ...(clip.cs ? { cs: clip.cs, ...(clip.cs.cv || clip.cs.hsl ? { grade: { cv: clip.cs.cv ?? null, hsl: clip.cs.hsl ?? null } } : {}) } : {}),
      // the studio's own transition (all 44, StudioTransitions.kt); the clip before it keeps its last frame for it
      ...(studioTr(clip, i) ? { tr: { id: clip.transition, dur: Math.min(TR_DUR[clip.transition], clipDuration(clip) / 2) } } : {}),
      ...(studioTr(p.clips[i + 1], i + 1) ? { keep: true } : {}),
      ...(!studioTr(clip, i) && clip.transition && normalizeAndroidTransition(clip.transition)
        ? { transitionIn: { type: normalizeAndroidTransition(clip.transition)!, duration: Math.min(0.35, Math.max(0.001, clipDuration(clip) / 2)) } }
        : {}),
    })),
    audio: p.audioUri ? { uri: p.audioUri, start: p.settings?.start ?? 0, volume: Math.min(1, Math.max(0, p.settings?.musicVolume ?? 1)), fadeIn: p.settings?.musicFadeIn ?? 0, fadeOut: p.settings?.musicFadeOut ?? 0, ducking: p.settings?.musicDucking ?? false, duckLevel: p.settings?.musicDuckLevel ?? 0.35 } : undefined,
    // every setting of a text (style, font, entrance, exit, loop, place, keyframes), drawn as the studio does (StudioTexts.kt)
    studioTexts: true,
    texts: p.overlays.map((o) => ({ ...o, size: Math.min(120, Math.max(8, o.size ?? 36)) })),
  };
}
/** a shot's keyframes and speed ramp as the phone's engine accepts them (finite, increasing; keyframes within the
 * shot's length, the ramp within its source): one bad key must not stop the Reel from playing. */
function fitTimes(c: ProjectClip) {
  const rising = <T,>(list: T[] | undefined, at: (x: T) => unknown, len: number) => { let last = -1; return list?.filter((x) => { const t = at(x); if (typeof t !== "number" || !Number.isFinite(t) || t < 0 || t > len || t <= last) return false; last = t; return true; }); };
  return { keyframes: rising(c.keyframes, (k) => (k as { t?: unknown }).t, clipDuration(c)), speedRamp: rising(c.speedRamp, (k) => (k as { time?: unknown }).time, Math.max(0, c.end - c.start))?.filter((k) => Number((k as { speed?: unknown }).speed) > 0) };
}
/** the player's spec: the export's, half size (smooth on any phone), without what the phone's engine cannot draw yet
 * (it is left out, never an error: the export still checks it); null when the engine is not in this app */
export function previewSpec(p: ReelProject, layers: { native?: unknown }[] = []): string | null {
  if (!ShubixVideo || !p.clips.length) return null;
  const [w, h] = SIZE[p.settings?.aspect ?? "9:16"] ?? SIZE["9:16"], k = 540 / Math.min(w, h);
  const spec = nativeSpec({ ...p, clips: p.clips.map((c) => ({ ...c, ...fitTimes(c), reverse: false, filter: isAndroidFilterSupported(c.filter) ? c.filter : "Original", volume: Math.min(1, c.volume ?? 1) })),
    overlays: p.overlays.filter((o) => o.text?.trim() && o.end > o.start).slice(0, 40).map((o) => ({ ...o, text: o.text.slice(0, 300), size: Math.min(120, Math.max(8, o.size ?? 36)) })) }, Math.round(w * k / 2) * 2, Math.round(h * k / 2) * 2, true);
  return JSON.stringify({ ...spec, layers: layers.map((l) => l.native).filter(Boolean) });
}



/**
 * Opt-in export path using the shared versioned RenderJob contract.
 * Keep the legacy exportReel path until Android feature parity and device
 * benchmarks are complete; callers can migrate deliberately.
 */
export async function exportReelWithSharedRenderer(
  project: ReelProject,
  onProgress: (done: number) => void,
) {
  if (!ShubixVideo) throw new Error("The native Android video engine is not installed in this build.");

  const job = createRenderJobFromProject(project);
  const renderer = createAndroidRendererAdapter({
    nativeModule: ShubixVideo as unknown as ShubixVideoNativeModule,
    createOutputPath: async () => {
      const root = Paths.document.uri.replace(/^file:\/\//, "").replace(/\/$/, "");
      const safeId = project.id.replace(/[^A-Za-z0-9._-]/g, "_");
      return `${root}/exports/${safeId}-shared-${Date.now()}.mp4`;
    },
    // Conservative starting budget; replace with measured device-class budgets
    // after profiling low-, mid- and high-tier Android hardware.
    maxWorkingSetBytes: 256 * 1024 * 1024,
    maxConcurrentDecoders: 1,
  });

  const result = await renderer.render(job, (event) => {
    if (event.phase === "failed") return;
    onProgress(event.progress);
  });
  return { uri: result.uri, size: result.sizeBytes, duration: result.durationMs / 1000 };
}


/** Whether the current Media3 adapter can reproduce this project without dropping edits. */
export function canUseSharedAndroidRenderer(project: ReelProject): boolean {
  if (!ShubixVideo || project.clips.length === 0) return false;
  if (project.clips.some((clip) =>
    clip.reverse ||
    (!!clip.transition && !isAndroidTransitionSupported(clip.transition)) ||
    (!!clip.effect && !isAndroidEffectSupported(clip.effect)) ||
    (clip.volume ?? 1) > 1 ||
    !!clip.speedRamp?.length ||
    !!clip.keyframes?.length ||
    !isAndroidFilterSupported(clip.filter) ||
    (clip.kind === "image" && clip.speed !== 1)
  )) return false;
  return true;
}
