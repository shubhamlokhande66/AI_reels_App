/**
 * Creates a disposable, low-resolution copy used only by the browser editor preview.
 * The original File is never replaced: Fast Studio's export pipeline reads src.file.
 */
export const PREVIEW_MAX_SIDE = 1280;
export const PREVIEW_BITRATE = 5_000_000;
const MIN_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PROXY_FILE_BYTES = 450 * 1024 * 1024;
const MAX_PROXY_DURATION = 300;
const REENCODE_BITRATE = 12_000_000;

export interface PreviewProxyFacts {
  size: number;
  width: number;
  height: number;
  duration: number;
}

export interface PreviewProxyPlan {
  width: number;
  height: number;
  bitrate: number;
  reason: "resolution" | "bitrate" | "resolution-and-bitrate";
}

/** Return null for footage that is already light enough for real-time editing. */
export function previewProxyPlan(facts: PreviewProxyFacts): PreviewProxyPlan | null {
  const { size, width, height, duration } = facts;
  if (![size, width, height, duration].every(Number.isFinite) ||
      size < MIN_FILE_BYTES || size > MAX_PROXY_FILE_BYTES ||
      width <= 0 || height <= 0 || duration <= 0 || duration > MAX_PROXY_DURATION) return null;

  const longSide = Math.max(width, height);
  const bitrate = (size * 8) / duration;
  const highResolution = longSide > PREVIEW_MAX_SIDE;
  const highBitrate = bitrate > REENCODE_BITRATE;
  if (!highResolution && !highBitrate) return null;

  const scale = Math.min(1, PREVIEW_MAX_SIDE / longSide);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  const proxySize = (PREVIEW_BITRATE * duration) / 8;
  if (proxySize > size * 0.9) return null;

  return {
    width: even(width),
    height: even(height),
    bitrate: PREVIEW_BITRATE,
    reason: highResolution && highBitrate ? "resolution-and-bitrate" : highResolution ? "resolution" : "bitrate",
  };
}

/**
 * Build a browser-only proxy using WebCodecs via Mediabunny. Failure is non-fatal:
 * callers continue with the original source. Do not use the returned Blob for export.
 */
export async function createPreviewProxy(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ blob: Blob; plan: PreviewProxyPlan } | null> {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return null;
  let input: import("mediabunny").Input | undefined;
  try {
    const mb = await import("mediabunny");
    input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const plan = previewProxyPlan({
      size: file.size,
      width: await track.getDisplayWidth(),
      height: await track.getDisplayHeight(),
      duration: await input.computeDuration(),
    });
    if (!plan || !(await mb.canEncodeVideo("avc", { width: plan.width, height: plan.height, bitrate: plan.bitrate }))) return null;

    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
      target: new mb.BufferTarget(),
    });
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: {
        width: plan.width,
        height: plan.height,
        fit: "contain",
        codec: "avc",
        quality: new mb.Quality(plan.bitrate),
        keyFrameInterval: 1,
      },
      audio: { codec: "aac" },
    });
    if (!conversion.isValid) return null;
    conversion.onProgress = (progress) => onProgress?.(progress);
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength >= file.size * 0.9) return null;
    return { blob: new Blob([buffer], { type: "video/mp4" }), plan };
  } catch (error) {
    console.info("Preview proxy unavailable; keeping original media:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    try { input?.dispose(); } catch { /* decoder cleanup is best-effort */ }
  }
}
