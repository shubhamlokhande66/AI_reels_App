import { Paths } from "expo-file-system";
import type { ReelProject } from "@shubix/validations";
import { ShubixVideo } from "../modules/shubix-video";

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
    clips: p.clips.map(({ uri, kind, start, end, speed, speedRamp, keyframes, muted, volume, rotation, mirror, flip, fit, filter }) => ({ uri, kind, start, end, speed, speedRamp, keyframes, muted, volume, rotation, mirror, flip, fit, filter })),
    audio: p.audioUri ? { uri: p.audioUri, start: p.settings?.start ?? 0, volume: Math.min(1, Math.max(0, p.settings?.musicVolume ?? 1)), fadeIn: p.settings?.musicFadeIn ?? 0, fadeOut: p.settings?.musicFadeOut ?? 0, ducking: p.settings?.musicDucking ?? false, duckLevel: p.settings?.musicDuckLevel ?? 0.35 } : undefined,
    texts: p.overlays.map(({ text, start, end, color, size }) => ({ text, start, end, color, size })),
  };
  const sub = ShubixVideo.addListener("onProgress", (e) => onProgress(e.progress));
  try { return await ShubixVideo.exportReel(JSON.stringify(spec)); } finally { sub.remove(); }
}
export const cancelExport = () => ShubixVideo?.cancel();
