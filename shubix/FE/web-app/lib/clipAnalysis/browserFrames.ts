import type { FrameSpec, VideoMetadata } from "@shubix/core/engine/video/clipAnalysisCore";

/** A clip's frames decoded by the browser (WebCodecs, through mediabunny), cut and scaled like the server's FFmpeg frames
 * (server/video/frames.ts): frame n is the one shown at n / fps, the real picture cropped out of any padding, scaled
 * to width x height, as BGR bytes, or grey bytes as the video's own luma (16-235, like FFmpeg's gray from YUV). */

export interface BrowserClip {
  meta: VideoMetadata;
  readFrames(spec: FrameSpec): AsyncIterable<{ n: number; data: Uint8Array }>;
  dispose(): void;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

function toBgr(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array((rgba.length / 4) * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i + 2]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i]; }
  return out;
}

function toLuma(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = Math.round(16 + (219 / 255) * (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]));
  return out;
}

/** The clip opened for analysis, or null when this browser cannot decode it (then the server analyses it). */
export async function openClip(file: Blob): Promise<BrowserClip | null> {
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track || !(await track.canDecode())) {
    input.dispose();
    return null;
  }
  const [duration, width, height, stats, audio, first] = await Promise.all([
    input.computeDuration(), track.getDisplayWidth(), track.getDisplayHeight(), track.computePacketStats(120), input.getPrimaryAudioTrack(), track.getFirstTimestamp(),
  ]);
  const fps = stats.averagePacketRate || 30;
  const meta: VideoMetadata = {
    duration: round3(duration), width, height, fps: round3(fps), codec: track.codec ?? "", hasAudio: !!audio, rotation: track.rotation,
    bitRate: duration > 0 ? Math.round((file.size * 8) / duration) : null,
    orientation: Math.abs(width - height) / Math.max(width, height) < 0.05 ? "square" : width > height ? "landscape" : "portrait",
  };

  async function* readFrames(spec: FrameSpec): AsyncIterable<{ n: number; data: Uint8Array }> {
    let crop: { left: number; top: number; width: number; height: number } | undefined;
    if (spec.rect) {
      const [x0, y0, x1, y1] = spec.rect, left = Math.trunc(x0 * spec.srcW), top = Math.trunc(y0 * spec.srcH);
      crop = { left, top, width: Math.trunc(x1 * spec.srcW) - left, height: Math.trunc(y1 * spec.srcH) - top };
    }
    const sink = new mb.CanvasSink(track!, { width: spec.width, height: spec.height, fit: "fill", crop, poolSize: 2 });
    const total = Math.max(Math.trunc(meta.duration * fps), 1);
    const ns = spec.frames ? [...spec.frames].sort((a, b) => a - b) : Array.from({ length: Math.ceil(total / spec.step) }, (_, k) => k * spec.step);
    let i = 0;
    for await (const wc of sink.canvasesAtTimestamps(ns.map((n) => first + n / fps + 1e-4))) {
      const n = ns[i++];
      if (!wc) continue;
      const ctx = wc.canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
      const rgba = ctx.getImageData(0, 0, spec.width, spec.height).data;
      yield { n, data: spec.gray ? toLuma(rgba) : toBgr(rgba) };
    }
  }

  return { meta, readFrames, dispose: () => input.dispose() };
}
