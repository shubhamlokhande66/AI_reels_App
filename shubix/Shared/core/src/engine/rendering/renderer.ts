/**
 * Platform-neutral rendering contracts.
 *
 * The shared core owns edit decisions and the serializable render specification.
 * Browser / Android / iOS adapters own decoding, preview surfaces, hardware codecs,
 * memory management and final encoding. Keep this file free of DOM and React Native
 * imports so it can be consumed by every platform.
 */

export type RenderPlatform = "web" | "android" | "ios";

export type RenderCapability =
  | "hardware-decode"
  | "hardware-encode"
  | "alpha-video"
  | "text-overlay"
  | "image-sequence"
  | "speed-ramp"
  | "reverse"
  | "mask"
  | "audio-mix"
  | "hdr";

export interface RenderDimensions {
  width: number;
  height: number;
  /** Frames per second. */
  fps: number;
}

export interface RenderSource {
  id: string;
  uri: string;
  kind: "video" | "image";
  durationMs: number;
  width?: number;
  height?: number;
  rotation?: 0 | 90 | 180 | 270;
}

export interface RenderTrackItem {
  id: string;
  sourceId: string;
  timelineStartMs: number;
  sourceStartMs: number;
  durationMs: number;
  playbackRate: number;
  fit: "cover" | "contain" | "stretch";
  rotation?: number;
  mirror?: boolean;
  muted?: boolean;
  volume?: number;
  transitionIn?: { type: string; durationMs: number };
  effects?: Array<{ type: string; params: Readonly<Record<string, number | string | boolean>> }>;
}

export interface RenderAudioTrack {
  source: string;
  startMs: number;
  durationMs: number;
  sourceStartMs: number;
  volume: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface RenderJobSpec {
  version: 1;
  dimensions: RenderDimensions;
  sources: readonly RenderSource[];
  items: readonly RenderTrackItem[];
  audio?: readonly RenderAudioTrack[];
  output: {
    container: "mp4";
    videoCodec: "h264";
    audioCodec: "aac";
    quality: "draft" | "standard" | "high";
  };
}

export interface RendererCapabilities {
  platform: RenderPlatform;
  capabilities: ReadonlySet<RenderCapability>;
  maxWidth: number;
  maxHeight: number;
  /** Conservative recommended working-set budget, not total device RAM. */
  maxWorkingSetBytes: number;
  /** Maximum concurrent decode operations the adapter recommends. */
  maxConcurrentDecoders: number;
}

export type RenderProgress =
  | { phase: "preparing" | "decoding" | "compositing" | "encoding" | "finalizing"; progress: number }
  | { phase: "completed"; progress: 1; outputUri: string; sizeBytes: number }
  | { phase: "failed"; progress: number; code: string; message: string }
  | { phase: "cancelled"; progress: number };

export interface RenderHandle {
  readonly id: string;
  cancel(): Promise<void>;
}

export interface RendererAdapter {
  readonly platform: RenderPlatform;
  getCapabilities(): Promise<RendererCapabilities>;
  render(
    spec: RenderJobSpec,
    onProgress: (progress: RenderProgress) => void,
  ): Promise<{ uri: string; sizeBytes: number; durationMs: number }>;
  cancel?(): Promise<void>;
}

/**
 * Validate renderer-independent invariants before dispatching work to a platform.
 * Platform adapters must perform their own source/codec/feature checks as well.
 */
export function validateRenderJob(spec: RenderJobSpec): string[] {
  const errors: string[] = [];
  if (spec.version !== 1) errors.push("Unsupported render specification version.");
  if (!Number.isFinite(spec.dimensions.width) || spec.dimensions.width <= 0) errors.push("Output width must be positive.");
  if (!Number.isFinite(spec.dimensions.height) || spec.dimensions.height <= 0) errors.push("Output height must be positive.");
  if (!Number.isFinite(spec.dimensions.fps) || spec.dimensions.fps <= 0 || spec.dimensions.fps > 120) errors.push("Output FPS must be between 0 and 120.");
  if (spec.items.length === 0) errors.push("A render job must contain at least one timeline item.");

  const sourceIds = new Set<string>();
  for (const source of spec.sources) {
    if (!source.id || sourceIds.has(source.id)) errors.push(`Source IDs must be non-empty and unique: ${source.id}`);
    sourceIds.add(source.id);
    if (!source.uri) errors.push(`Source ${source.id} has no URI.`);
    if (!Number.isFinite(source.durationMs) || source.durationMs < 0) errors.push(`Source ${source.id} has an invalid duration.`);
  }

  const itemIds = new Set<string>();
  for (const item of spec.items) {
    if (!item.id || itemIds.has(item.id)) errors.push(`Timeline item IDs must be non-empty and unique: ${item.id}`);
    itemIds.add(item.id);
    if (!sourceIds.has(item.sourceId)) errors.push(`Timeline item ${item.id} references missing source ${item.sourceId}.`);
    if (!Number.isFinite(item.timelineStartMs) || item.timelineStartMs < 0) errors.push(`Timeline item ${item.id} has an invalid timeline start.`);
    if (!Number.isFinite(item.sourceStartMs) || item.sourceStartMs < 0) errors.push(`Timeline item ${item.id} has an invalid source start.`);
    if (!Number.isFinite(item.durationMs) || item.durationMs <= 0) errors.push(`Timeline item ${item.id} must have a positive duration.`);
    if (!Number.isFinite(item.playbackRate) || item.playbackRate <= 0 || item.playbackRate > 16) errors.push(`Timeline item ${item.id} has an unsupported playback rate.`);
  }

  for (const track of spec.audio ?? []) {
    if (!track.source) errors.push("Audio track source is required.");
    if (![track.startMs, track.durationMs, track.sourceStartMs, track.volume].every(Number.isFinite)) errors.push("Audio track timing and volume must be finite numbers.");
    if (track.startMs < 0 || track.durationMs < 0 || track.sourceStartMs < 0) errors.push("Audio track timing cannot be negative.");
    if (track.volume < 0 || track.volume > 4) errors.push("Audio track volume must be between 0 and 4.");
  }

  return errors;
}
