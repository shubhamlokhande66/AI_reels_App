import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { AppError } from "@/server/core/errors";
import { findBinary } from "@/server/core/ffmpeg";

/** Any FFmpeg-readable audio as mono samples at `sr` (16-bit PCM, scaled x / 32768), the first `maxSeconds` seconds.
 * downmix "ffmpeg": FFmpeg's own mono mix; "mean": the plain average of the two channels (what Beat This! was
 * trained on: (L + R) / 2). */
export function decode(file: string, sr: number, maxSeconds = 600, downmix: "ffmpeg" | "mean" = "ffmpeg"): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-i", path.resolve(file), "-vn", "-ac", downmix === "mean" ? "2" : "1", "-ar", String(sr), "-t", String(maxSeconds), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"];
    const p = spawn(findBinary("ffmpeg"), args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.stderr.on("data", (c: Buffer) => { err += c.toString(); });
    const timer = setTimeout(() => p.kill(), 120_000);
    p.on("error", reject);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new AppError(`The audio could not be decoded: ${err.trim().split("\n").pop() ?? ""}`, { code: "AUDIO_DECODE_FAILED", status: 422 }));
      const buf = Buffer.concat(chunks);
      const n = Math.floor(buf.length / 2);
      if (downmix === "mean") {
        const y = new Float32Array(n >> 1);
        for (let i = 0; i < y.length; i++) y[i] = (buf.readInt16LE(4 * i) + buf.readInt16LE(4 * i + 2)) / 65536;
        return resolve(y);
      }
      const y = new Float32Array(n);
      for (let i = 0; i < n; i++) y[i] = buf.readInt16LE(2 * i) / 32768;
      resolve(y);
    });
  });
}

/** The checks Python made on a decoded song (less than a second, or silent, is not a song). */
export function checkAudio(y: Float32Array, sr: number) {
  if (y.length < sr) throw new AppError("The audio contains less than one second of sound.", { code: "CORRUPTED_MEDIA" });
  let peak = 0;
  for (const v of y) if (Math.abs(v) > peak) peak = Math.abs(v);
  if (peak < 1e-4) throw new AppError("The audio track is silent.", { code: "SILENT_AUDIO" });
}
