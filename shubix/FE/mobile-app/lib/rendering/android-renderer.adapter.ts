import {
  validateRenderJob,
  type RenderJobSpec,
  type RendererAdapter,
  type RendererCapabilities,
} from "@shubix/core/engine/rendering";

export interface ShubixVideoNativeModule {
  exportReel(spec: string): Promise<{ uri: string; size: number; duration: number }>;
  cancel(): Promise<void>;
  addListener(event: "onProgress", listener: (event: { progress: number }) => void): { remove(): void };
}

export interface AndroidRendererOptions {
  nativeModule: ShubixVideoNativeModule;
  /** Return an absolute writable path in app cache/documents. */
  createOutputPath: () => Promise<string>;
  /** Conservative budget supplied by the device profiler; do not equate this to total RAM. */
  maxWorkingSetBytes: number;
  maxConcurrentDecoders?: number;
}

export class UnsupportedAndroidRenderFeature extends Error {
  readonly code = "UNSUPPORTED_RENDER_FEATURE";
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedAndroidRenderFeature";
  }
}

const SUPPORTED_FILTERS = new Set(["Noir", "Golden", "Film", "Soft", "Vivid", "Cinematic"]);
const SUPPORTED_RENDER_EFFECTS = new Set(["blur", "brightness", "contrast", "saturation", "hue"]);

/**
 * Adapter for the currently shipped Media3 module.
 *
 * Important: this adapter intentionally rejects timeline features the Kotlin module
 * does not currently implement (transitions, multiple audio tracks, arbitrary effects,
 * gaps, fades, etc.). It must never silently discard part of an edit.
 */
export function createAndroidRendererAdapter(options: AndroidRendererOptions): RendererAdapter {
  const { nativeModule } = options;
  let active = false;
  let cancelRequested = false;
  let nativeStarted = false;

  const assertSupported = (job: RenderJobSpec) => {
    const validationErrors = validateRenderJob(job);
    if (validationErrors.length) {
      throw new UnsupportedAndroidRenderFeature(validationErrors.join(" "));
    }
    if (job.output.container !== "mp4" || job.output.videoCodec !== "h264" || job.output.audioCodec !== "aac") {
      throw new UnsupportedAndroidRenderFeature("Android Media3 currently exports MP4 with H.264 video and AAC audio only.");
    }
    if (job.audio && job.audio.length > 1) {
      throw new UnsupportedAndroidRenderFeature("Android Media3 adapter currently supports one music track.");
    }
    const audio = job.audio?.[0];
    if (audio && audio.startMs !== 0) {
      throw new UnsupportedAndroidRenderFeature("Android Media3 currently requires the music track to start at the beginning of the Reel.");
    }
    if (audio && audio.volume > 1) {
      throw new UnsupportedAndroidRenderFeature("Android Media3 music gain is currently limited to 100% to avoid clipping.");
    }

    const sourceById = new Map(job.sources.map((source) => [source.id, source]));
    let expectedTimelineStart = 0;
    for (const item of job.items) {
      const source = sourceById.get(item.sourceId);
      if (!source) throw new UnsupportedAndroidRenderFeature(`Missing source for timeline item ${item.id}.`);
      if (Math.abs(item.timelineStartMs - expectedTimelineStart) > 1) {
        throw new UnsupportedAndroidRenderFeature("Android Media3 adapter currently requires a continuous, gap-free timeline.");
      }
      expectedTimelineStart = item.timelineStartMs + item.durationMs;
      if (item.transitionIn && item.transitionIn.durationMs > 0) {
        throw new UnsupportedAndroidRenderFeature(`Transition ${item.transitionIn.type} is not implemented by the current Android renderer.`);
      }
      if (item.fit === "stretch") {
        throw new UnsupportedAndroidRenderFeature("Stretch fit is not supported by the current Android renderer.");
      }
      if (item.volume !== undefined && item.volume > 1) {
        throw new UnsupportedAndroidRenderFeature(`Clip ${item.id} audio gain above 100% is not supported by the current Android renderer.`);
      }
      for (const effect of item.effects ?? []) {
        if (effect.enabled === false) continue;
        if (effect.type === "filter" && typeof effect.params.name === "string" && SUPPORTED_FILTERS.has(effect.params.name)) continue;
        if (!SUPPORTED_RENDER_EFFECTS.has(effect.type)) throw new UnsupportedAndroidRenderFeature(`Effect ${effect.type} is not supported by Android export yet.`);
        const intensity = effect.intensity ?? (typeof effect.params.amount === "number" ? effect.params.amount : 0.5);
        if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) throw new UnsupportedAndroidRenderFeature(`Effect ${effect.type} requires an intensity from 0 to 1.`);
        if (effect.startMs !== undefined || effect.endMs !== undefined || effect.keyframes) throw new UnsupportedAndroidRenderFeature(`Time-ranged or animated ${effect.type} effects are not supported by this Android export path yet.`);
      }
      if (source.kind === "image" && item.playbackRate !== 1) {
        throw new UnsupportedAndroidRenderFeature("Image playback speed must be 1x.");
      }
      if (source.kind === "video" && item.sourceStartMs + item.durationMs * item.playbackRate > source.durationMs + 1) {
        throw new UnsupportedAndroidRenderFeature(`Timeline item ${item.id} reads beyond its source duration.`);
      }
    }
  };

  return {
    platform: "android",
    async getCapabilities(): Promise<RendererCapabilities> {
      return {
        platform: "android",
        // These describe features implemented by the current adapter, not guarantees
        // about a particular device's codec hardware.
        capabilities: new Set(["image-sequence", "audio-mix", "text-overlay"]),
        maxWidth: 3840,
        maxHeight: 2160,
        maxWorkingSetBytes: options.maxWorkingSetBytes,
        maxConcurrentDecoders: Math.max(1, Math.min(2, options.maxConcurrentDecoders ?? 1)),
      };
    },
    async render(job, onProgress) {
      if (active) throw new Error("An Android render is already running.");
      assertSupported(job);
      active = true;
      cancelRequested = false;
      nativeStarted = false;
      let subscription: { remove(): void } | undefined;
      try {
        subscription = nativeModule.addListener("onProgress", ({ progress }) => {
          const normalized = Math.max(0, Math.min(1, progress));
          onProgress({ phase: "encoding", progress: normalized });
        });
        const output = await options.createOutputPath();
        if (cancelRequested) {
          onProgress({ phase: "cancelled", progress: 0 });
          const cancelled = new Error("Export was cancelled.");
          Object.assign(cancelled, { code: "E_EXPORT_CANCELLED" });
          throw cancelled;
        }
        const sourceById = new Map(job.sources.map((source) => [source.id, source]));
        const clips = job.items.map((item) => {
          const source = sourceById.get(item.sourceId)!;
          const filter = item.effects?.find((effect) => effect.type === "filter")?.params.name;
          return {
            uri: source.uri,
            kind: source.kind,
            start: source.kind === "image" ? 0 : item.sourceStartMs / 1000,
            end: source.kind === "image"
              ? item.durationMs / 1000
              : (item.sourceStartMs + item.durationMs * item.playbackRate) / 1000,
            speed: source.kind === "image" ? 1 : item.playbackRate,
            rotation: item.rotation ?? source.rotation ?? 0,
            mirror: item.mirror ?? false,
            flip: item.flip ?? false,
            fit: item.fit === "contain" ? "contain" : "cover",
            filter: typeof filter === "string" ? filter : "Original",
            muted: item.muted ?? false,
            volume: item.volume ?? 1,
            effects: (item.effects ?? []).filter((effect) => effect.enabled !== false && effect.type !== "filter").map((effect) => ({
              type: effect.type,
              intensity: effect.intensity ?? (typeof effect.params.amount === "number" ? effect.params.amount : 0.5),
            })),
          };
        });
        const audio = job.audio?.[0];
        const nativeSpec = {
          width: job.dimensions.width,
          height: job.dimensions.height,
          clips,
          ...(audio ? { audio: {
            uri: audio.source,
            start: audio.sourceStartMs / 1000,
            volume: audio.volume,
            fadeIn: (audio.fadeInMs ?? 0) / 1000,
            fadeOut: (audio.fadeOutMs ?? 0) / 1000,
            ducking: audio.ducking ?? false,
            duckLevel: audio.duckLevel ?? 0.35,
          } } : {}),
          texts: (job.overlays ?? []).map((overlay) => ({
            text: overlay.text,
            start: overlay.startMs / 1000,
            end: overlay.endMs / 1000,
            color: overlay.color,
            size: overlay.size,
          })),
          output,
        };
        onProgress({ phase: "preparing", progress: 0 });
        nativeStarted = true;
        const result = await nativeModule.exportReel(JSON.stringify(nativeSpec));
        onProgress({ phase: "completed", progress: 1, outputUri: result.uri, sizeBytes: result.size });
        return { uri: result.uri, sizeBytes: result.size, durationMs: result.duration * 1000 };
      } catch (error) {
        const nativeCode = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code ?? "")
          : "";
        if (nativeCode === "E_EXPORT_CANCELLED") {
          onProgress({ phase: "cancelled", progress: 0 });
        } else {
          const message = error instanceof Error ? error.message : "Android render failed.";
          onProgress({ phase: "failed", progress: 0, code: error instanceof UnsupportedAndroidRenderFeature ? error.code : nativeCode || "ANDROID_RENDER_FAILED", message });
        }
        throw error;
      } finally {
        subscription?.remove();
        active = false;
        nativeStarted = false;
        cancelRequested = false;
      }
    },
    async cancel() {
      if (!active) return;
      cancelRequested = true;
      if (nativeStarted) await nativeModule.cancel();
    },
  };
}
