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
  effects?: readonly RenderEffect[];
  keyframes?: KeyframeTrack;
  mask?: RenderMask;
}

export interface RenderAudioTrack {
  source: string;
  startMs: number;
  durationMs: number;
  sourceStartMs: number;
  volume: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  ducking?: boolean;
  duckLevel?: number;
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
/** Solve a cubic Bezier timing curve (x controls time, y controls progress). */
export function cubicBezierProgress(progress: number, curve: readonly [number, number, number, number]): number {
  const x = Math.max(0, Math.min(1, progress));
  const [x1, y1, x2, y2] = curve;
  const cubic = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0, high = 1, t = x;
  for (let i = 0; i < 16; i++) {
    const estimate = cubic(t, x1, x2);
    if (Math.abs(estimate - x) < 0.00001) break;
    if (estimate < x) low = t; else high = t;
    t = (low + high) / 2;
  }
  return cubic(t, y1, y2);
}

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
  if (left.bezier) t = cubicBezierProgress(t, left.bezier);
  else if (easing === "step") t = 0;
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
  overlays?: readonly RenderTextOverlay[];
  layers?: readonly RenderLayer[];
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
    if (track.fadeInMs !== undefined && (!Number.isFinite(track.fadeInMs) || track.fadeInMs < 0 || track.fadeInMs > 10000)) errors.push("Audio fade-in must be between 0 and 10000ms.");
    if (track.fadeOutMs !== undefined && (!Number.isFinite(track.fadeOutMs) || track.fadeOutMs < 0 || track.fadeOutMs > 10000)) errors.push("Audio fade-out must be between 0 and 10000ms.");
    if (track.duckLevel !== undefined && (!Number.isFinite(track.duckLevel) || track.duckLevel < 0 || track.duckLevel > 1)) errors.push("Audio duck level must be between 0 and 1.");
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

  const validateKeyframes = (owner: string, track: KeyframeTrack | undefined, maxTimeMs: number) => {
    if (!track) return;
    for (const [property, frames] of Object.entries(track)) {
      if (!Array.isArray(frames)) { errors.push(`${owner} has an invalid ${property} keyframe track.`); continue; }
      let previous = -Infinity;
      for (const frame of frames) {
        if (!Number.isFinite(frame.timeMs) || frame.timeMs < 0 || frame.timeMs > maxTimeMs) errors.push(`${owner} has a keyframe outside its duration.`);
        if (frame.timeMs <= previous) errors.push(`${owner} keyframes for ${property} must have strictly increasing times.`);
        if (!Number.isFinite(frame.value)) errors.push(`${owner} has a non-finite keyframe value.`);
        if (frame.bezier && (frame.bezier.length !== 4 || frame.bezier.some((v) => !Number.isFinite(v) || v < 0 || v > 1))) errors.push(`${owner} has invalid cubic-bezier controls.`);
        previous = frame.timeMs;
      }
    }
  };
  for (const item of spec.items) {
    validateKeyframes(`Timeline item ${item.id}`, item.keyframes, item.durationMs);
    if (item.mask) {
      const mask = item.mask;
      if (![mask.x, mask.y, mask.width, mask.height].every(Number.isFinite) || mask.width < 0 || mask.height < 0) errors.push(`Timeline item ${item.id} has invalid mask geometry.`);
      if (mask.feather !== undefined && (!Number.isFinite(mask.feather) || mask.feather < 0 || mask.feather > 1)) errors.push(`Timeline item ${item.id} has invalid mask feathering.`);
      if (mask.points?.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) errors.push(`Timeline item ${item.id} has invalid polygon mask points.`);
      validateKeyframes(`Mask on ${item.id}`, mask.keyframes, item.durationMs);
    }
    for (const effect of item.effects ?? []) {
      if (effect.intensity !== undefined && (!Number.isFinite(effect.intensity) || effect.intensity < 0 || effect.intensity > 1)) errors.push(`Effect ${effect.type} on ${item.id} has invalid intensity.`);
      if (effect.startMs !== undefined && (!Number.isFinite(effect.startMs) || effect.startMs < 0 || effect.startMs > item.durationMs)) errors.push(`Effect ${effect.type} on ${item.id} has invalid start time.`);
      if (effect.endMs !== undefined && (!Number.isFinite(effect.endMs) || effect.endMs < (effect.startMs ?? 0) || effect.endMs > item.durationMs)) errors.push(`Effect ${effect.type} on ${item.id} has invalid end time.`);
      validateKeyframes(`Effect ${effect.type} on ${item.id}`, effect.keyframes, item.durationMs);
    }
  }
  for (const track of spec.audio ?? []) validateKeyframes("Audio track", track.keyframes, track.durationMs);
  for (const overlay of spec.overlays ?? []) {
    validateKeyframes(`Text overlay ${overlay.id}`, overlay.transform, overlay.endMs - overlay.startMs);
    for (const effect of overlay.effects ?? []) validateKeyframes(`Text effect ${effect.type}`, effect.keyframes, overlay.endMs - overlay.startMs);
  }
  const layerIds = new Set<string>();
  for (const layer of spec.layers ?? []) {
    if (!layer.id || layerIds.has(layer.id)) errors.push(`Layer IDs must be non-empty and unique: ${layer.id}`);
    layerIds.add(layer.id);
    if (!Number.isFinite(layer.startMs) || layer.startMs < 0 || !Number.isFinite(layer.durationMs) || layer.durationMs <= 0) errors.push(`Layer ${layer.id} has invalid timing.`);
    if (layer.opacity !== undefined && (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1)) errors.push(`Layer ${layer.id} has invalid opacity.`);
    validateKeyframes(`Layer ${layer.id}`, layer.transform, layer.durationMs);
    if (layer.mask) validateKeyframes(`Layer mask ${layer.id}`, layer.mask.keyframes, layer.durationMs);
  }

  return errors;
}
