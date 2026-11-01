/**
 * Editing copies of the person's clips, made in the browser (the original File is never changed).
 *  - preview proxy: a light, low-resolution copy for the editor's live preview of big but ordinary footage
 *    (the export still reads the original);
 *  - edit copy: for footage a browser cannot play or decode smoothly, whatever the camera (iPhone 4K HDR / Cinematic /
 *    slo-mo, Android 60 fps / 8K / HDR10+, GoPro, drones, mirrorless 10-bit 4:2:2, screen recordings with a varying frame
 *    rate). H.264 8-bit SDR, at most 1080 × 1920, 30 frames a second at an even pace: the preview, the clip reading and
 *    the export all read it, so every Reel plays without lag.
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
  /** From probeVideo: frames per second, HDR (HLG/PQ/BT.2020), 10-bit colour, 4:2:2 colour, a varying frame rate. */
  fps?: number;
  hdr?: boolean;
  tenBit?: boolean;
  chroma422?: boolean;
  vfr?: boolean;
}

export const EDIT_MAX_SIDE = 1920;
export const EDIT_BITRATE = 10_000_000;
export const EDIT_FPS = 30;
/** an edit copy may be this long / this big (a 20-minute 4K file still gets one; its bitrate is lowered to fit memory) */
const EDIT_MAX_DURATION = 20 * 60;
const EDIT_MAX_FILE_BYTES = 8 * 1024 * 1024 * 1024;
const EDIT_MAX_COPY_BYTES = 400 * 1024 * 1024;

/** Footage too heavy for a smooth live preview and a reliable export (see the top of this file). */
export function isHeavySource(f: PreviewProxyFacts): boolean {
  const longSide = Math.max(f.width, f.height), bitrate = f.duration > 0 ? (f.size * 8) / f.duration : 0;
  return !!f.hdr || !!f.tenBit || !!f.chroma422 || !!f.vfr || (f.fps || 0) > 31 ||
    longSide > 2 * EDIT_MAX_SIDE || (longSide > EDIT_MAX_SIDE && bitrate > 20_000_000);
}

export function isQuickTimeSource(fileName: string, mimeType: string): boolean {
  return /\.mov$/i.test(fileName.trim()) || /^video\/quicktime(?:;|$)/i.test(mimeType.trim());
}

export interface PreviewProxyPlan {
  width: number;
  height: number;
  bitrate: number;
  reason: "resolution" | "bitrate" | "resolution-and-bitrate" | "heavy";
  /** an edit copy: frames per second of the copy, and the export reads the copy too */
  fps?: number;
  forExport?: boolean;
}

/** The edit copy's size and bitrate (any input that has a picture; null only for unusable facts or a huge file). */
export function editCopyPlan(facts: PreviewProxyFacts): PreviewProxyPlan | null {
  const { size, width, height, duration } = facts;
  if (![size, width, height, duration].every(Number.isFinite) || size <= 0 || size > EDIT_MAX_FILE_BYTES ||
      width <= 0 || height <= 0 || duration <= 0 || duration > EDIT_MAX_DURATION) return null;
  const sc = Math.min(1, EDIT_MAX_SIDE / Math.max(width, height));
  const ev = (value: number) => Math.max(2, Math.round((value * sc) / 2) * 2);
  const src = (size * 8) / duration, fit = Math.floor((EDIT_MAX_COPY_BYTES * 8) / duration);
  const bitrate = Math.max(1_500_000, Math.min(EDIT_BITRATE, Math.floor(src * 0.9), fit));
  return { width: ev(width), height: ev(height), bitrate, reason: "heavy", fps: EDIT_FPS, forExport: true };
}

/** Return null for footage that is already light enough for real-time editing. */
export function previewProxyPlan(facts: PreviewProxyFacts, forceTranscode = false): PreviewProxyPlan | null {
  const { size, width, height, duration } = facts;
  if (![size, width, height, duration].every(Number.isFinite) || size <= 0 ||
      width <= 0 || height <= 0 || duration <= 0) return null;
  if (isHeavySource(facts)) return editCopyPlan(facts);
  if (size < MIN_FILE_BYTES || size > MAX_PROXY_FILE_BYTES || duration > MAX_PROXY_DURATION) return null;

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

export interface VideoFacts { fps: number; hdr: boolean; tenBit: boolean; chroma422: boolean; vfr: boolean; codec: string; decodes: boolean; width: number; height: number; duration: number }

/** The frame gaps of a clip (sorted presentation times) say whether its frame rate varies: screen recordings, WhatsApp
 * and many Android phones in low light. A varying pace makes frames missing in the export (a freeze). */
export function variesFrameRate(times: number[]): boolean {
  if (times.length < 20) return false;
  const t = [...times].sort((a, b) => a - b), d: number[] = [];
  for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g > 1e-4) d.push(g); }
  if (d.length < 15) return false;
  const med = [...d].sort((a, b) => a - b)[d.length >> 1];
  const off = d.filter(g => g > med * 1.6 || g < med * 0.6).length / d.length;
  return off > 0.12 || Math.max(...d) > Math.max(0.25, med * 6);
}

/** What a clip is, read from its container (nothing decoded): frame rate and its pace, HDR, bit depth, colour sampling,
 * whether this browser's decoder takes it. null when the container is not readable here. */
export async function probeVideo(file: Blob): Promise<VideoFacts | null> {
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
    const times: number[] = [];
    try {
      const ps = new mb.EncodedPacketSink(track);
      let p = await ps.getFirstPacket({ metadataOnly: true });
      while (p && times.length < 240) { times.push(p.timestamp); p = await ps.getNextPacket(p, { metadataOnly: true }); }
    } catch { /* no packet list: pace unknown */ }
    const decodes = typeof VideoDecoder !== "undefined" && await track.canDecode().catch(() => false);
    return {
      fps,
      hdr: ["hlg", "pq", "arib-std-b67", "smpte2084"].includes(String(cs.transfer || "")) || String(cs.primaries || "") === "bt2020",
      // HEVC Main 10 (hvc1.2 / hev1.2), VP9 profile 2/3, AV1 10-bit, H.264 High 10 (avc1.6E)
      tenBit: /^(hvc1|hev1)\.2\./i.test(cstr) || /^vp09\.0[23]\./i.test(cstr) || /^av01\.\d\.\d+\w\.10/i.test(cstr) || /^avc1\.6e/i.test(cstr),
      // camera footage: H.264 High 4:2:2 (avc1.7A), HEVC range extensions (hvc1.4), ProRes; most browsers cannot decode it
      chroma422: /^avc1\.7a/i.test(cstr) || /^(hvc1|hev1)\.4\./i.test(cstr) || /^(apch|apcn|apcs|apco|ap4h|ap4x)/i.test(cstr),
      vfr: variesFrameRate(times),
      codec: track.codec || cstr || "",
      decodes,
      width: await track.getDisplayWidth(), height: await track.getDisplayHeight(),
      duration: await input.computeDuration().catch(() => 0),
    };
  } catch {
    return null;
  } finally {
    try { input?.dispose(); } catch { /* best-effort */ }
  }
}

const loadVideo = (video: HTMLVideoElement, ms = 15_000) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("The browser took too long to open this video")), ms);
  video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
  video.onerror = () => { clearTimeout(timer); reject(new Error("The browser cannot open this video format")); };
});

/** The browser's own player (it can play some formats WebCodecs cannot decode) feeding an encoder, each frame stamped
 * with the time the player gives it (requestVideoFrameCallback): the copy keeps the real timing even when this device
 * drops frames while playing, and it is played at half speed for fast footage so no frame is missed. */
async function playerToEncoder(file: File, plan: PreviewProxyPlan, onProgress?: (p: number) => void): Promise<Blob | null> {
  if (typeof VideoEncoder === "undefined" || typeof HTMLVideoElement === "undefined" || !("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return null;
  const mb = await import("mediabunny");
  const enc = { width: plan.width, height: plan.height, bitrate: plan.bitrate };
  const vcodec = await mb.canEncodeVideo("avc", enc) ? "avc" as const : await mb.canEncodeVideo("vp9", enc) ? "vp9" as const : null;
  if (!vcodec) return null;
  const video = document.createElement("video"), canvas = document.createElement("canvas");
  const g = canvas.getContext("2d", { alpha: false }); if (!g) return null;
  canvas.width = plan.width; canvas.height = plan.height;
  const url = URL.createObjectURL(file);
  try {
    video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;
    await loadVideo(video);
    const dur = video.duration; if (!Number.isFinite(dur) || dur <= 0) return null;
    const mp4 = vcodec === "avc";
    const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat({ fastStart: "in-memory" }) : new mb.WebMOutputFormat(), target: new mb.BufferTarget() });
    const vs = new mb.VideoSampleSource({ codec: vcodec, bitrate: plan.bitrate, keyFrameInterval: 1 });
    const fps = plan.fps || EDIT_FPS, step = 1 / fps;
    output.addVideoTrack(vs, { frameRate: fps });
    await output.start();
    let slot = 0, chain: Promise<unknown> = Promise.resolve(), failed: unknown = null, lastFrame = performance.now();
    const draw = () => {
      const s = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight), w = video.videoWidth * s, h = video.videoHeight * s;
      g.fillStyle = "#000"; g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    // every 1/30 s slot up to this frame's time gets this picture (an even pace whatever the source's)
    const emit = (upTo: number) => {
      while (slot * step <= upTo + 1e-6 && slot * step < dur) {
        const sample = new mb.VideoSample(canvas, { timestamp: slot * step, duration: step });
        chain = chain.then(() => vs.add(sample)).catch(e => { failed = e; }).finally(() => sample.close());
        slot++;
      }
    };
    await new Promise<void>((resolve, reject) => {
      const watch = setInterval(() => { if (performance.now() - lastFrame > 15_000) { clearInterval(watch); reject(new Error("The browser stopped playing this video")); } }, 1000);
      const onFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        lastFrame = performance.now();
        if (video.videoWidth) { draw(); emit(meta.mediaTime); }
        onProgress?.(Math.min(0.99, meta.mediaTime / dur));
        if (!video.ended) video.requestVideoFrameCallback(onFrame);
      };
      video.onended = () => { clearInterval(watch); resolve(); };
      video.onerror = () => { clearInterval(watch); reject(new Error("The browser could not play this video to the end")); };
      video.requestVideoFrameCallback(onFrame);
      video.playbackRate = dur <= 120 ? 0.5 : 1;
      video.play().catch(e => { clearInterval(watch); reject(e); });
    });
    if (video.videoWidth) { draw(); emit(dur); }
    await chain;
    if (failed) throw failed;
    if (!slot) return null;
    await output.finalize();
    onProgress?.(1);
    const buf = output.target.buffer;
    return buf ? new Blob([buf], { type: mp4 ? "video/mp4" : "video/webm" }) : null;
  } finally {
    video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
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
  if (typeof document === "undefined") return null;
  // frame-timed first (exact timing); the real-time recorder below only where there is no WebCodecs encoder
  try { const b = await playerToEncoder(file, plan, onProgress); if (b) return b; }
  catch (error) { console.info("Player-to-encoder copy failed:", error instanceof Error ? error.message : error); }
  if (typeof MediaRecorder === "undefined") return null;
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
    await loadVideo(video);
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > (plan.forExport ? EDIT_MAX_DURATION : MAX_PROXY_DURATION)) return null;
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
 * Build a browser-only copy. Prefer WebCodecs/Mediabunny; fall back to the browser's own player feeding an encoder
 * for formats (HEVC, some MOV) that WebCodecs cannot decode on this device. The original File is never replaced.
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
        await loadVideo(probe);
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

/** An edit copy for a clip the browser's player cannot open at all (it may still decode it with WebCodecs). */
export async function createEditCopy(file: File, facts: VideoFacts | null, onProgress?: (p: number) => void): Promise<{ blob: Blob; plan: PreviewProxyPlan } | null> {
  if (!facts || !facts.width || !facts.height || !facts.duration) return null;
  const plan = editCopyPlan({ size: file.size, width: facts.width, height: facts.height, duration: facts.duration });
  return plan ? createPreviewProxy(file, onProgress, plan) : null;
}

export const SERVER_CONVERT_MAX_BYTES = 95 * 1024 * 1024;
type ConvertError = Error & { code?: string; status?: number };
const convertError = (message: string, code: string, status?: number): ConvertError => Object.assign(new Error(message), { code, status });
async function readError(r: Response | Blob, status: number): Promise<ConvertError> {
  let msg = "Shubix could not convert this video.", code = "CONVERT_FAILED";
  try { const j = JSON.parse(await r.text()); msg = (j.error && (j.error.message || j.error)) || j.message || msg; code = (j.error && j.error.code) || j.code || code; } catch { /* not JSON */ }
  if (status === 401) code = "UNAUTHORIZED";
  return convertError(String(msg), code, status);
}
/** The last resort, for what this browser cannot decode at all (camera ProRes / 4:2:2, old codecs): Shubix converts it
 * (signed in, at most 95 MB). The file is sent (the first 50%), converted as a job whose progress is asked every 2 s
 * (to 95%), then the result is fetched. */
export async function convertOnServer(file: File, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<Blob> {
  if (file.size > SERVER_CONVERT_MAX_BYTES) throw convertError("too big", "CONVERT_TOO_BIG");
  // what this browser's player takes: H.264 MP4 (nearly all), else VP9 WebM
  const h264 = typeof document !== "undefined" && !!document.createElement("video").canPlayType('video/mp4; codecs="avc1.640028"');
  const id = await new Promise<string>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/studio/convert" + (h264 ? "" : "?to=webm"));
    x.withCredentials = true;
    x.responseType = "blob";
    x.setRequestHeader("Content-Type", "application/octet-stream");
    x.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(0.5 * e.loaded / e.total); };
    x.onload = async () => {
      if (x.status === 200) { try { resolve(JSON.parse(await (x.response as Blob).text()).id); } catch { reject(convertError("Shubix could not start converting this video.", "CONVERT_FAILED", 200)); } return; }
      reject(await readError(x.response as Blob, x.status));
    };
    x.onerror = () => reject(convertError("No connection: the video could not be sent for converting.", "OFFLINE"));
    signal?.addEventListener("abort", () => { x.abort(); reject(convertError("cancelled", "CANCELLED")); });
    x.send(file);
  });
  const base = "/api/studio/convert/" + encodeURIComponent(id);
  for (let misses = 0; ;) {
    if (signal?.aborted) throw convertError("cancelled", "CANCELLED");
    await new Promise(r => setTimeout(r, 2000));
    let st: { status: string; progress: number; error?: { code: string; message: string } | null };
    try {
      const r = await fetch(base, { credentials: "same-origin", cache: "no-store", signal });
      if (!r.ok) throw await readError(r, r.status);
      st = await r.json(); misses = 0;
    } catch (e) {
      const err = e as ConvertError;
      if (err.status && err.status < 500) throw err;
      if (++misses >= 8) throw convertError("No connection while the video was being converted.", "OFFLINE");   // ~16 s offline
      continue;
    }
    if (st.status === "failed") throw convertError(st.error?.message || "Shubix could not convert this video.", st.error?.code || "CONVERT_FAILED");
    onProgress?.(0.5 + 0.45 * (st.progress || 0));
    if (st.status === "done") break;
  }
  const r = await fetch(base + "/file", { credentials: "same-origin", signal });
  if (!r.ok) throw await readError(r, r.status);
  const blob = await r.blob();
  onProgress?.(1);
  return blob;
}
