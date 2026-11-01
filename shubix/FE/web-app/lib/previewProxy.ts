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
  /** From probeVideo: frames per second, HDR (HLG/PQ/BT.2020) and 10-bit colour. */
  fps?: number;
  hdr?: boolean;
  tenBit?: boolean;
}

/* Heavy footage: what an iPhone records by default (4K, HEVC 10-bit, HDR, 60 fps, ~55 Mbps). A browser decodes it too
 * slowly for a live preview (the picture freezes, the song stutters) and the export's decoder may fail on it, which
 * drops the export to the real-time recorder (a laggy file). Such a clip gets one edit copy, H.264 8-bit SDR at most
 * 1080 × 1920 and 30 fps, used by the preview, the clip reading and the export alike (any size, even a 2 s clip). */
export const EDIT_MAX_SIDE = 1920;
export const EDIT_BITRATE = 10_000_000;
export const EDIT_FPS = 30;
export function isHeavySource(f: PreviewProxyFacts): boolean {
  const longSide = Math.max(f.width, f.height), bitrate = f.duration > 0 ? (f.size * 8) / f.duration : 0;
  return !!f.hdr || !!f.tenBit || (f.fps || 0) > 31 || (longSide > EDIT_MAX_SIDE && bitrate > 20_000_000);
}

export function isQuickTimeSource(fileName: string, mimeType: string): boolean {
  return /\.mov$/i.test(fileName.trim()) || /^video\/quicktime(?:;|$)/i.test(mimeType.trim());
}

export interface PreviewProxyPlan {
  width: number;
  height: number;
  bitrate: number;
  reason: "resolution" | "bitrate" | "resolution-and-bitrate" | "heavy";
  /** heavy footage: frames per second of the copy, and the export reads the copy too */
  fps?: number;
  forExport?: boolean;
}

/** Return null for footage that is already light enough for real-time editing. */
export function previewProxyPlan(facts: PreviewProxyFacts, forceTranscode = false): PreviewProxyPlan | null {
  const { size, width, height, duration } = facts;
  if (![size, width, height, duration].every(Number.isFinite) || size <= 0 || size > MAX_PROXY_FILE_BYTES ||
      width <= 0 || height <= 0 || duration <= 0 || duration > MAX_PROXY_DURATION) return null;
  if (isHeavySource(facts)) {
    const sc = Math.min(1, EDIT_MAX_SIDE / Math.max(width, height));
    const ev = (value: number) => Math.max(2, Math.round((value * sc) / 2) * 2);
    const src = (size * 8) / duration;
    return { width: ev(width), height: ev(height), bitrate: Math.max(2_000_000, Math.min(EDIT_BITRATE, Math.floor(src * 0.9))), reason: "heavy", fps: EDIT_FPS, forExport: true };
  }
  if (size < MIN_FILE_BYTES ||
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

/** Frame rate, HDR and bit depth of a clip (read from its container, nothing decoded). null when unreadable. */
export async function probeVideo(file: Blob): Promise<{ fps: number; hdr: boolean; tenBit: boolean; codec: string } | null> {
  if (typeof window === "undefined") return null;
  let input: import("mediabunny").Input | undefined;
  try {
    const mb = await import("mediabunny");
    input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const cs = await track.getColorSpace().catch(() => ({} as VideoColorSpaceInit));
    const cfg = await track.getDecoderConfig().catch(() => null);
    const cstr = (cfg && cfg.codec) || "";
    let fps = 0;
    try { const st = await track.computePacketStats(120); fps = st.averagePacketRate || 0; } catch { /* unknown */ }
    return {
      fps,
      hdr: ["hlg", "pq", "arib-std-b67", "smpte2084"].includes(String(cs.transfer || "")) || String(cs.primaries || "") === "bt2020",
      // HEVC Main 10 (hvc1.2 / hev1.2), VP9 profile 2, AV1 10-bit
      tenBit: /^(hvc1|hev1)\.2\./i.test(cstr) || /^vp09\.0[23]\./i.test(cstr) || /^av01\.\d\.\d+\w\.10/i.test(cstr),
      codec: track.codec || "",
    };
  } catch {
    return null;
  } finally {
    try { input?.dispose(); } catch { /* best-effort */ }
  }
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
    return blob.size < file.size * (plan.forExport ? 1.5 : 0.9) ? blob : null;
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
  given?: PreviewProxyPlan | null,
): Promise<{ blob: Blob; plan: PreviewProxyPlan } | null> {
  if (typeof window === "undefined") return null;
  let input: import("mediabunny").Input | undefined;
  let plan: PreviewProxyPlan | null = given || null;
  try {
    if (typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined") {
      const mb = await import("mediabunny");
      input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
      const track = await input.getPrimaryVideoTrack();
      if (track) {
        if (!plan) plan = previewProxyPlan({
          size: file.size,
          width: await track.getDisplayWidth(),
          height: await track.getDisplayHeight(),
          duration: await input.computeDuration(),
        }, isQuickTimeSource(file.name, file.type));
        // H.264 in MP4; a browser without an H.264 encoder makes the edit copy in VP9 / WebM (a heavy clip still needs one)
        const enc = { width: plan?.width || 0, height: plan?.height || 0, bitrate: plan?.bitrate || 0 };
        const vcodec = !plan ? null : await mb.canEncodeVideo("avc", enc) ? "avc" as const
          : plan.forExport && await mb.canEncodeVideo("vp9", enc) ? "vp9" as const : null;
        if (plan && vcodec && await track.canDecode()) {
          const mp4 = vcodec === "avc";
          const acodec = mp4 ? (await mb.canEncodeAudio("aac") ? "aac" as const : await mb.canEncodeAudio("opus") ? "opus" as const : null)
            : await mb.canEncodeAudio("opus") ? "opus" as const : null;
          const output = new mb.Output({
            format: mp4 ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(),
            target: new mb.BufferTarget(),
          });
          const conversion = await mb.Conversion.init({
            input, output,
            video: {
              width: plan.width, height: plan.height, fit: "contain",
              codec: vcodec, quality: new mb.Quality(plan.bitrate), keyFrameInterval: 1,
              ...(plan.fps ? { frameRate: plan.fps } : {}),
            },
            audio: acodec ? { codec: acodec } : { discard: true },
          });
          if (conversion.isValid) {
            conversion.onProgress = progress => onProgress?.(progress);
            await conversion.execute();
            const buffer = output.target.buffer;
            if (buffer && buffer.byteLength < file.size * (plan.forExport ? 1.5 : 0.9)) {
              return { blob: new Blob([buffer], { type: mp4 ? "video/mp4" : "video/webm" }), plan };
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
        }, isQuickTimeSource(file.name, file.type));
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
