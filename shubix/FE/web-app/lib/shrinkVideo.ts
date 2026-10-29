/** A clip made smaller in the browser before it is uploaded. A Reel is 1080x1920, so footage beyond 1080p (4K phones)
 * or at a very high bitrate only costs upload time: it is re-encoded (WebCodecs, usually the phone's hardware encoder)
 * to 1080p at a bitrate the final render cannot tell apart. Anything the browser cannot do keeps the original file. */

export const TARGET_SHORT_SIDE = 1080;
export const TARGET_BITRATE = 10_000_000; // 10 Mbit/s: above the final render's own bitrate at 1080p
const MIN_SIZE = 25 * 1024 * 1024; // smaller clips upload quickly anyway
const HIGH_BITRATE = 14_000_000;

export interface ShrinkFacts { size: number; width: number; height: number; duration: number }

/** Should this clip be re-encoded before upload, and to what size? null = upload it as it is. */
export function shrinkPlan(f: ShrinkFacts): { width: number; height: number } | null {
  if (f.size < MIN_SIZE || !f.width || !f.height || !(f.duration > 0)) return null;
  const short = Math.min(f.width, f.height), bitrate = (f.size * 8) / f.duration;
  if (short <= TARGET_SHORT_SIDE && bitrate <= HIGH_BITRATE) return null;
  const scale = Math.min(TARGET_SHORT_SIDE / short, 1);
  const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
  const expected = (TARGET_BITRATE * f.duration) / 8;
  if (expected > f.size * 0.7) return null; // would barely save anything
  return { width: even(f.width), height: even(f.height) };
}

/** The clip to upload: a smaller copy when that helps and the browser can make it, else the original. Never throws. */
export async function shrinkVideo(file: File, onProgress?: (f: number) => void): Promise<File> {
  if (typeof window === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return file;
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return file;
    const plan = shrinkPlan({ size: file.size, width: await track.getDisplayWidth(), height: await track.getDisplayHeight(), duration: await input.computeDuration() });
    if (!plan || !(await track.canDecode()) || !(await mb.canEncodeVideo("avc", { width: plan.width, height: plan.height, bitrate: TARGET_BITRATE }))) return file;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input, output,
      video: { width: plan.width, height: plan.height, fit: "contain", codec: "avc", quality: new mb.Quality(TARGET_BITRATE), keyFrameInterval: 1 },
      audio: { codec: "aac" },
    });
    if (!conversion.isValid) return file;
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();
    const buf = output.target.buffer;
    if (!buf || buf.byteLength >= file.size * 0.9) return file;
    return new File([buf], file.name.replace(/\.[^.]+$/, "") + ".mp4", { type: "video/mp4", lastModified: file.lastModified });
  } catch (e) {
    console.warn("clip kept at full size (the browser could not shrink it):", e);
    return file;
  }
}
