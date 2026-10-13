import "server-only";
import { execFile } from "node:child_process";
import { settings } from "./config";
import { AppError } from "./errors";

/** FFmpeg / FFprobe: the configured binaries, or the ones on PATH (like backend/app/core/ffmpeg.py). */

export const ffmpegBin = () => settings.ffmpegBin || "ffmpeg";
export const ffprobeBin = () => settings.ffprobeBin || "ffprobe";

export function run(bin: string, args: string[], timeoutMs = 300_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || err.message).trim().split(/\r?\n/).slice(-6).join("\n");
        reject(new AppError(`FFmpeg failed: ${tail}`, { code: "FFMPEG_FAILED", status: 500 }));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const runFfmpeg = (args: string[], timeoutMs?: number) => run(ffmpegBin(), ["-hide_banner", "-loglevel", "error", "-y", ...args], timeoutMs);
