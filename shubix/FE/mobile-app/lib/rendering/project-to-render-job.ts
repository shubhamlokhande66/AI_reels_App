import {
  clipDuration,
  projectDuration,
  type ReelProject,
} from "@shubix/validations";
import type { RenderJobSpec, RenderTrackItem } from "@shubix/core/engine/rendering";
import { UnsupportedAndroidRenderFeature } from "./android-renderer.adapter";

const SIZE: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "4:5": [1080, 1350],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
};

/**
 * Converts the persisted editor project into the versioned, platform-neutral
 * renderer contract. No rendering or native APIs are used here.
 *
 * Unsupported editing semantics are rejected instead of being silently dropped.
 */
export function createRenderJobFromProject(project: ReelProject): RenderJobSpec {
  if (project.clips.length === 0) {
    throw new UnsupportedAndroidRenderFeature("Add at least one clip before exporting.");
  }

  const [width, height] = SIZE[project.settings?.aspect ?? "9:16"] ?? SIZE["9:16"];
  const sources = new Map<string, RenderJobSpec["sources"][number]>();
  const items: RenderTrackItem[] = [];
  let timelineStartMs = 0;

  for (const clip of project.clips) {
    if (clip.reverse) {
      throw new UnsupportedAndroidRenderFeature("Reverse playback is not supported by the current Android renderer.");
    }

    sources.set(clip.id, {
      id: clip.id,
      uri: clip.uri,
      kind: clip.kind,
      durationMs: clip.sourceDuration * 1000,
    });

    if (clip.speedRamp?.length) {
      throw new UnsupportedAndroidRenderFeature("Variable speed ramps are not yet supported by the shared Android RenderJob adapter. Use the native editor export path.");
    }
    if (clip.keyframes?.length) {
      throw new UnsupportedAndroidRenderFeature("Shot keyframes are not yet supported by the shared Android RenderJob adapter. Use the native editor export path.");
    }
    const durationMs = clipDuration(clip) * 1000;
    const effects: NonNullable<RenderTrackItem["effects"]> = [];
    if (clip.filter && clip.filter !== "Original") {
      effects.push({ type: "filter", params: { name: clip.filter } });
    }
    if (clip.effect && clip.effect !== "none") {
      const effectType = clip.effect === "blurpulse" ? "blur" : clip.effect;
      effects.push({ type: effectType, intensity: 0.5, params: {} });
    }

    items.push({
      id: clip.id,
      sourceId: clip.id,
      timelineStartMs,
      sourceStartMs: clip.start * 1000,
      durationMs,
      playbackRate: clip.kind === "image" ? 1 : clip.speed,
      fit: clip.fit,
      rotation: clip.rotation,
      mirror: clip.mirror,
      flip: clip.flip,
      muted: clip.muted,
      volume: clip.volume,
      ...(clip.transition && clip.transition !== "Cut" && clip.transition !== "hard"
        ? { transitionIn: { type: clip.transition === "fadein" ? "fade" : clip.transition, durationMs: 250 } }
        : {}),
      effects,
    });
    timelineStartMs += durationMs;
  }

  const durationMs = projectDuration(project.clips) * 1000;
  const audio = project.audioUri
    ? [{
        source: project.audioUri,
        startMs: 0,
        durationMs,
        sourceStartMs: (project.settings?.start ?? 0) * 1000,
        volume: project.settings?.musicVolume ?? 1,
        fadeInMs: (project.settings?.musicFadeIn ?? 0) * 1000,
        fadeOutMs: (project.settings?.musicFadeOut ?? 0) * 1000,
        ducking: project.settings?.musicDucking ?? false,
        duckLevel: project.settings?.musicDuckLevel ?? 0.35,
      }]
    : undefined;

  const overlays = project.overlays.map((overlay) => ({
    id: overlay.id,
    text: overlay.text,
    startMs: overlay.start * 1000,
    endMs: overlay.end * 1000,
    color: overlay.color,
    size: overlay.size,
  }));

  const job: RenderJobSpec = {
    version: 1,
    dimensions: { width, height, fps: 30 },
    sources: [...sources.values()],
    items,
    ...(audio ? { audio } : {}),
    overlays,
    output: {
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      quality: "high",
    },
  };

  return job;
}
