import type {
  RenderJobSpec,
  RendererAdapter,
  RendererCapabilities,
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

  const assertSupported = (job: RenderJobSpec) => {
    if (job.output.container !== "mp4" || job.output.videoCodec !== "h264" || job.output.audioCodec !== "aac") {
      throw new UnsupportedAndroidRenderFeature("Android Media3 currently exports MP4 with H.264 video and AAC audio only.");
    }
    if (job.audio && job.audio.length > 1) {
      throw new UnsupportedAndroidRenderFeature("Android Media3 adapter currently supports one music track.");
    }
    const audio = job.audio?.[0];
    if (audio && (audio.startMs !== 0 || audio.volume !== 1 || audio.fadeInMs || audio.fadeOutMs)) {
      throw new UnsupportedAndroidRenderFeature("Android Media3 adapter currently supports one music track starting at zero without fades or custom volume.");
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
      for (const effect of item.effects ?? []) {
        if (effect.type !== "filter" || typeof effect.params.name !== "string" || !SUPPORTED_FILTERS.has(effect.params.name)) {
          throw new UnsupportedAndroidRenderFeature(`Effect ${effect.type} is not supported by the current Android renderer.`);
        }
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
        capabilities: new Set(["image-sequence", "audio-mix"]),
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
      const subscription = nativeModule.addListener("onProgress", ({ progress }) => {
        const normalized = Math.max(0, Math.min(1, progress));
        onProgress({ phase: "encoding", progress: normalized });
      });
      try {
        const output = await options.createOutputPath();
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
            flip: false,
            fit: item.fit === "contain" ? "contain" : "cover",
            filter: typeof filter === "string" ? filter : "Original",
            muted: item.muted ?? false,
          };
        });
        const audio = job.audio?.[0];
        const nativeSpec = {
          width: job.dimensions.width,
          height: job.dimensions.height,
          clips,
          ...(audio ? { audio: { uri: audio.source, start: audio.sourceStartMs / 1000 } } : {}),
          output,
        };
        onProgress({ phase: "preparing", progress: 0 });
        const result = await nativeModule.exportReel(JSON.stringify(nativeSpec));
        onProgress({ phase: "completed", progress: 1, outputUri: result.uri, sizeBytes: result.size });
        return { uri: result.uri, sizeBytes: result.size, durationMs: result.duration * 1000 };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Android render failed.";
        onProgress({ phase: "failed", progress: 0, code: error instanceof UnsupportedAndroidRenderFeature ? error.code : "ANDROID_RENDER_FAILED", message });
        throw error;
      } finally {
        subscription.remove();
        active = false;
      }
    },
    async cancel() {
      if (active) await nativeModule.cancel();
    },
  };
}
