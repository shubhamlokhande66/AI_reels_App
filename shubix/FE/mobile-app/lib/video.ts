import { Paths } from "expo-file-system";
import type { ReelProject } from "@shubix/validations";
import { ShubixVideo } from "../modules/shubix-video";
import {
  createAndroidRendererAdapter,
  createRenderJobFromProject,
  type ShubixVideoNativeModule,
} from "./rendering";

/** The Reel as an MP4, made on this phone by its video engine (modules/shubix-video). `ready`: the engine is in this
 * app (a development or Play Store build; Expo Go has not). */
export const videoEngine = { ready: !!ShubixVideo };
const SIZE: Record<string, [number, number]> = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] };

export async function exportReel(p: ReelProject, onProgress: (done: number) => void) {
  if (!ShubixVideo) throw new Error("The video engine is not in this app.");
  const [width, height] = SIZE[p.settings?.aspect ?? "9:16"];
  const output = `${Paths.document.uri.replace(/^file:\/\//, "")}exports/${p.id}-${Date.now()}.mp4`;
  const spec = {
    width, height, output,
    clips: p.clips.map(({ uri, kind, start, end, speed, muted, rotation, mirror, flip, fit, filter }) => ({ uri, kind, start, end, speed, muted, rotation, mirror, flip, fit, filter })),
    audio: p.audioUri ? { uri: p.audioUri, start: p.settings?.start ?? 0 } : undefined,
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
