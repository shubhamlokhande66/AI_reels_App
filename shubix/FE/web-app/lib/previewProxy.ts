/**
 * Creates a disposable, low-resolution copy used only by the browser editor preview.
 * The original File is never replaced: Fast Studio's export pipeline reads src.file.
 */
export const PREVIEW_MAX_SIDE = 960;
export const PREVIEW_BITRATE = 2_000_000;
const MIN_FILE_BYTES = 16 * 1024 * 1024;
const MAX_PROXY_FILE_BYTES = 450 * 1024 * 1024;
const MAX_PROXY_DURATION = 300;
const MIN_PREVIEW_BITRATE = 700_000;
const PREVIEW_AUDIO_BITRATE = 96_000;

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
export function previewProxyPlan(facts: PreviewProxyFacts, forceTranscode = false): PreviewProxyPlan | null {
  const { size, width, height, duration } = facts;
  if (![size, width, height, duration].every(Number.isFinite) ||
      size < MIN_FILE_BYTES || size > MAX_PROXY_FILE_BYTES ||
      width <= 0 || height <= 0 || duration <= 0 || duration > MAX_PROXY_DURATION) return null;

  const longSide = Math.max(width, height);
  const bitrate = (size * 8) / duration;
  const highResolution = longSide > PREVIEW_MAX_SIDE;
  const highBitrate = bitrate > 2_500_000 || forceTranscode;
  if (!highResolution && !highBitrate) return null;

  const scale = Math.min(1, PREVIEW_MAX_SIDE / longSide);
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  // Adapt to the source bitrate so even long, high-resolution phone MOVs get a smaller proxy.
  // Include a small audio allowance in the estimate; the original file is always retained for export.
  const targetBitrate = Math.min(PREVIEW_BITRATE, Math.max(MIN_PREVIEW_BITRATE, Math.floor(bitrate * 0.65)));
  const proxySize = ((targetBitrate + PREVIEW_AUDIO_BITRATE) * duration) / 8;
  if (proxySize > size * 0.9) return null;

  return {
    width: even(width),
    height: even(height),
    bitrate: targetBitrate,
    reason: highResolution && highBitrate ? "resolution-and-bitrate" : highResolution ? "resolution" : "bitrate",
  };
}

/**
 * Fallback for MOV codecs that an HTMLVideoElement can play but WebCodecs cannot decode.
 * Captures a downscaled, muted preview stream; the editor builds its soundtrack separately.
 */
async function createElementPreviewProxy(
  file: File,
  plan: PreviewProxyPlan,
  onProgress?: (progress: number) => void,
): Promise<Blob | null> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") return null;
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || typeof canvas.captureStream !== "function") return null;
  const url = URL.createObjectURL(file);
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  try {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MOV preview decode timed out")), 15_000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error("Browser cannot decode this MOV")); };
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > MAX_PROXY_DURATION) return null;
    canvas.width = plan.width;
    canvas.height = plan.height;
    stream = canvas.captureStream(30);
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
      .find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return null;
    const chunks: BlobPart[] = [];
    recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: plan.bitrate });
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder!.onerror = () => reject(new Error("Browser preview recording failed"));
      recorder!.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });
    recorder.start(500);
    let lastProgress = 0;
    const draw = () => {
      if (video.readyState >= 2) {
        const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
        const width = video.videoWidth * scale, height = video.videoHeight * scale;
        context.fillStyle = "#000";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      }
      const progress = Math.min(0.99, video.currentTime / video.duration);
      if (progress - lastProgress >= 0.01) { lastProgress = progress; onProgress?.(progress); }
      if (!video.ended && !video.paused) requestAnimationFrame(draw);
    };
    video.onended = () => { if (recorder?.state === "recording") recorder.stop(); };
    await video.play();
    draw();
    const blob = await stopped;
    onProgress?.(1);
    return blob.size < file.size * 0.9 ? blob : null;
  } finally {
    if (recorder?.state === "recording") recorder.stop();
    stream?.getTracks().forEach(track => track.stop());
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Build a browser-only proxy. Prefer WebCodecs/Mediabunny; fall back to the browser's
 * native video decoder + canvas recorder for MOV formats such as HEVC that WebCodecs
 * cannot decode on this device. The original File is never replaced and remains export source.
 */
export async function createPreviewProxy(
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ blob: Blob; plan: PreviewProxyPlan } | null> {
  if (typeof window === "undefined") return null;
  let input: import("mediabunny").Input | undefined;
  let plan: PreviewProxyPlan | null = null;
  try {
    if (typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined") {
      const mb = await import("mediabunny");
      input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track) {
        plan = previewProxyPlan({
          size: file.size,
          width: await track.getDisplayWidth(),
          height: await track.getDisplayHeight(),
          duration: await input.computeDuration(),
        }, /\\.mov$/i.test(file.name) || /quicktime/i.test(file.type));
        if (plan && await track.canDecode() &&
            await mb.canEncodeVideo("avc", { width: plan.width, height: plan.height, bitrate: plan.bitrate })) {
          const output = new mb.Output({
            format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
            target: new mb.BufferTarget(),
          });
          const conversion = await mb.Conversion.init({
            input, output,
            video: {
              width: plan.width, height: plan.height, fit: "contain",
              codec: "avc", quality: new mb.Quality(plan.bitrate), keyFrameInterval: 1,
            },
            audio: { codec: "aac" },
          });
          if (conversion.isValid) {
            conversion.onProgress = progress => onProgress?.(progress);
            await conversion.execute();
            const buffer = output.target.buffer;
            if (buffer && buffer.byteLength < file.size * 0.9) {
              return { blob: new Blob([buffer], { type: "video/mp4" }), plan };
            }
          }
        }
      }
    }
  } catch (error) {
    console.info("WebCodecs preview proxy failed; trying native browser decoder:", error instanceof Error ? error.message : error);
  } finally {
    try { input?.dispose(); } catch { /* decoder cleanup is best-effort */ }
  }

  // Metadata can also be obtained from the native decoder when the WebCodecs demuxer
  // cannot identify a MOV track. The caller already measured these dimensions.
  if (!plan) {
    try {
      const probe = document.createElement("video");
      const url = URL.createObjectURL(file);
      try {
        probe.src = url;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Video metadata timed out")), 15_000);
          probe.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
          probe.onerror = () => { clearTimeout(timer); reject(new Error("Unsupported video format")); };
        });
        plan = previewProxyPlan({
          size: file.size, width: probe.videoWidth, height: probe.videoHeight, duration: probe.duration,
        }, /\\.mov$/i.test(file.name) || /quicktime/i.test(file.type));
      } finally {
        probe.removeAttribute("src"); probe.load(); URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.info("Native preview metadata unavailable:", error instanceof Error ? error.message : error);
    }
  }
  if (!plan) return null;
  try {
    const blob = await createElementPreviewProxy(file, plan, onProgress);
    return blob ? { blob, plan } : null;
  } catch (error) {
    console.info("Native preview proxy unavailable; keeping original media:", error instanceof Error ? error.message : error);
    return null;
  }
}
