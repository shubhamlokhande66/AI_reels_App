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
  flip?: boolean;
  muted?: boolean;
  volume?: number;
  transitionIn?: { type: string; durationMs: number };
  effects?: readonly RenderEffect[];\n  keyframes?: KeyframeTrack;\n  mask?: RenderMask;
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

export interface RenderTextOverlay {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  color: string;
  size: number;
}


/** Shared, serializable animation primitives used by web and native renderers. */
export type KeyframeEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "step";
export type AnimatedProperty = "x" | "y" | "scale" | "scaleX" | "scaleY" | "rotation" | "opacity" | "anchorX" | "anchorY" | "volume" | "playbackRate" | "blur" | "brightness" | "contrast" | "saturation" | "hue" | "temperature" | "tint";
export interface NumericKeyframe {
  timeMs: number;
  value: number;
  easing?: KeyframeEasing;
  bezier?: readonly [number, number, number, number];
}
export type KeyframeTrack = Partial<Record<AnimatedProperty, readonly NumericKeyframe[]>>;
export type TransitionType = "cut" | "fade" | "dissolve" | "crossfade" | "dip-black" | "dip-white" | "push-left" | "push-right" | "push-up" | "push-down" | "slide-left" | "slide-right" | "slide-up" | "slide-down" | "wipe-left" | "wipe-right" | "wipe-up" | "wipe-down" | "zoom-in" | "zoom-out" | "spin" | "blur" | "flash" | "glitch" | "cube" | "flip-3d" | "whip-pan";
export type EffectType = "blur" | "motion-blur" | "glow" | "vignette" | "grain" | "sharpen" | "chromatic-aberration" | "rgb-split" | "glitch" | "shake" | "wave" | "pixelate" | "mosaic" | "fisheye" | "lens-distortion" | "light-leak" | "film-burn" | "bloom" | "edge-detection" | "duotone" | "lut" | "color-adjust" | "hsl" | "curves" | "posterize" | "threshold";
export type MaskType = "rectangle" | "ellipse" | "linear" | "radial" | "polygon" | "luma" | "image";
export interface RenderMask {
  type: MaskType;
  x: number; y: number; width: number; height: number;
  feather?: number; invert?: boolean; rotation?: number;
  points?: readonly { x: number; y: number }[];
  sourceId?: string;
  keyframes?: KeyframeTrack;
}
export interface RenderEffect {
  id?: string; type: EffectType | string; enabled?: boolean; intensity?: number;
  startMs?: number; endMs?: number;
  params: Readonly<Record<string, number | string | boolean>>;
  keyframes?: KeyframeTrack;
}
export interface RenderLayer {
  id: string; kind: "video" | "image" | "text" | "shape" | "sticker";
  sourceId?: string; startMs: number; durationMs: number; zIndex: number;
  opacity?: number;
  blendMode?: "normal" | "multiply" | "screen" | "overlay" | "soft-light" | "add" | "darken" | "lighten";
  transform?: KeyframeTrack; effects?: readonly RenderEffect[]; mask?: RenderMask;
}
export interface RenderTextStyle {
  fontFamily?: string; fontWeight?: number | "normal" | "bold"; fontStyle?: "normal" | "italic";
  align?: "left" | "center" | "right"; verticalAlign?: "top" | "middle" | "bottom";
  letterSpacing?: number; lineHeight?: number; strokeColor?: string; strokeWidth?: number;
  shadowColor?: string; shadowBlur?: number; shadowX?: number; shadowY?: number;
  backgroundColor?: string; backgroundRadius?: number;
  gradient?: readonly { offset: number; color: string }[];
  animation?: "none" | "fade" | "typewriter" | "word-reveal" | "pop" | "bounce" | "slide-up" | "slide-down" | "slide-left" | "slide-right" | "zoom-in" | "zoom-out" | "blur-in" | "glitch";
  position?: { x: number; y: number; unit: "normalized" | "pixels" };
}

/** Deterministic keyframe sampling; all renderer adapters use the same easing semantics. */
export function sampleKeyframes(frames: readonly NumericKeyframe[] | undefined, timeMs: number, fallback = 0): number {
  if (!frames?.length) return fallback;
  const sorted = [...frames].sort((a, b) => a.timeMs - b.timeMs);
  if (timeMs <= sorted[0].timeMs) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (timeMs >= last.timeMs) return last.value;
  let left = sorted[0], right = last;
  for (let i = 1; i < sorted.length; i++) {
    if (timeMs <= sorted[i].timeMs) { left = sorted[i - 1]; right = sorted[i]; break; }
  }
  const span = right.timeMs - left.timeMs;
  if (span <= 0) return right.value;
  let t = Math.max(0, Math.min(1, (timeMs - left.timeMs) / span));
  const easing = left.easing ?? "linear";
  if (easing === "step") t = 0;
  else if (easing === "ease-in") t *= t;
  else if (easing === "ease-out") t = 1 - (1 - t) * (1 - t);
  else if (easing === "ease-in-out") t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return left.value + (right.value - left.value) * t;
}

export interface RenderJobSpec {
  version: 1;
  dimensions: RenderDimensions;
  sources: readonly RenderSource[];
  items: readonly RenderTrackItem[];
  audio?: readonly RenderAudioTrack[];
  overlays?: readonly RenderTextOverlay[];\n  layers?: readonly RenderLayer[];
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
    if (item.volume !== undefined && (!Number.isFinite(item.volume) || item.volume < 0 || item.volume > 4)) errors.push(`Timeline item ${item.id} has an invalid volume.`);
    const source = spec.sources.find((candidate) => candidate.id === item.sourceId);
    if (source && item.sourceStartMs + item.durationMs * item.playbackRate > source.durationMs + 1) {
      errors.push(`Timeline item ${item.id} exceeds source duration.`);
    }
  }

  for (const track of spec.audio ?? []) {
    if (!track.source) errors.push("Audio track source is required.");
    if (![track.startMs, track.durationMs, track.sourceStartMs, track.volume].every(Number.isFinite)) errors.push("Audio track timing and volume must be finite numbers.");
    if (track.startMs < 0 || track.durationMs < 0 || track.sourceStartMs < 0) errors.push("Audio track timing cannot be negative.");
    if (track.volume < 0 || track.volume > 4) errors.push("Audio track volume must be between 0 and 4.");
  }

  const timelineEndMs = spec.items.reduce((end, item) => Math.max(end, item.timelineStartMs + item.durationMs), 0);
  for (const overlay of spec.overlays ?? []) {
    if (!overlay.id || !overlay.text.trim()) errors.push("Text overlays require an ID and non-empty text.");
    if (!Number.isFinite(overlay.startMs) || !Number.isFinite(overlay.endMs) || overlay.startMs < 0 || overlay.endMs <= overlay.startMs) {
      errors.push(`Text overlay ${overlay.id} has invalid timing.`);
    }
    if (overlay.endMs > timelineEndMs + 1) errors.push(`Text overlay ${overlay.id} extends beyond the Reel duration.`);
    if (!Number.isFinite(overlay.size) || overlay.size < 8 || overlay.size > 240) errors.push(`Text overlay ${overlay.id} has an invalid font size.`);
    if (!overlay.color) errors.push(`Text overlay ${overlay.id} requires a color.`);
  }

  return errors;
}
