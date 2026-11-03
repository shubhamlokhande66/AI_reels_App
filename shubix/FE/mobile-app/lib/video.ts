import { Paths } from "expo-file-system";
import { clipDuration, type ReelProject } from "@shubix/validations";
import { ShubixVideo } from "../modules/shubix-video";
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


export async function exportReel(p: ReelProject, onProgress: (done: number) => void) {
  if (!ShubixVideo) throw new Error("The video engine is not in this app.");
  const unsupported = p.clips.find((clip) =>
    clip.reverse ||
    (!!clip.transition && !isAndroidTransitionSupported(clip.transition)) ||
    (!!clip.effect && !isAndroidEffectSupported(clip.effect)) ||
    !isAndroidFilterSupported(clip.filter) ||
    (clip.volume ?? 1) > 1
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
  if (unsupported && (unsupported.volume ?? 1) > 1) {
    throw new Error("Android export currently supports source-audio gain up to 100%. Lower this clip volume before exporting.");
  }
  const [width, height] = SIZE[p.settings?.aspect ?? "9:16"] ?? SIZE["9:16"];
  const root = Paths.document.uri.replace(/^file:\/\//, "").replace(/\/$/, "");
  const safeId = p.id.replace(/[^A-Za-z0-9._-]/g, "_") || "reel";
  const output = `${root}/exports/${safeId}-${Date.now()}.mp4`;
  const spec = {
    width, height, output,
    clips: p.clips.map((clip) => ({
      uri: clip.uri, kind: clip.kind, start: clip.start, end: clip.end, speed: clip.speed,
      speedRamp: clip.speedRamp, keyframes: clip.keyframes, muted: clip.muted, volume: clip.volume,
      rotation: clip.rotation, mirror: clip.mirror, flip: clip.flip, fit: clip.fit, filter: clip.filter,
      effects: clip.effect && clip.effect !== "none" ? [{ type: clip.effect, intensity: 0.5 }] : [],
      ...(clip.transition && normalizeAndroidTransition(clip.transition)
        ? { transitionIn: { type: normalizeAndroidTransition(clip.transition)!, duration: Math.min(0.35, Math.max(0.001, clipDuration(clip) / 2)) } }
        : {}),
    })),
    audio: p.audioUri ? { uri: p.audioUri, start: p.settings?.start ?? 0, volume: Math.min(1, Math.max(0, p.settings?.musicVolume ?? 1)), fadeIn: p.settings?.musicFadeIn ?? 0, fadeOut: p.settings?.musicFadeOut ?? 0, ducking: p.settings?.musicDucking ?? false, duckLevel: p.settings?.musicDuckLevel ?? 0.35 } : undefined,
    texts: p.overlays.map(({ text, start, end, color, size }) => ({ text, start, end, color, size })),
  };
  const sub = ShubixVideo.addListener("onProgress", (e) => onProgress(e.progress));
  try { return await ShubixVideo.exportReel(JSON.stringify(spec)); } finally { sub.remove(); }
}
export const cancelExport = () => ShubixVideo?.cancel();


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
