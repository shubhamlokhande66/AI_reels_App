import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { settings } from "./config";
import { AppError } from "./errors";

/** FFmpeg / FFprobe (was backend/app/core/ffmpeg.py): the configured binary, or the one on PATH, or winget's install. */

const resolved = new Map<string, string>();

function onPath(name: string): string | null {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const p = path.join(dir, exe);
    if (dir && fs.existsSync(p)) return p;
  }
  return null;
}

function winget(name: string): string | null {
  const base = process.env.LOCALAPPDATA;
  const root = base && path.join(base, "Microsoft", "WinGet", "Packages");
  if (!root || !fs.existsSync(root)) return null;
  for (const pkg of fs.readdirSync(root).filter((d) => d.startsWith("Gyan.FFmpeg"))) {
    const stack = [path.join(root, pkg)];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.name === `${name}.exe` && path.basename(dir) === "bin") return p;
      }
    }
  }
  return null;
}

export function findBinary(name: "ffmpeg" | "ffprobe"): string {
  const hit = resolved.get(name);
  if (hit) return hit;
  const configured = name === "ffmpeg" ? settings.ffmpegBin : settings.ffprobeBin;
  const candidate = configured || onPath(name) || winget(name);
  if (!candidate) throw new AppError(`${name} was not found. Install FFmpeg and add it to PATH, or set ${name.toUpperCase()}_BIN.`, { code: "FFMPEG_NOT_FOUND", status: 500 });
  resolved.set(name, candidate);
  return candidate;
}

export function ffmpegAvailable(): boolean {
  try {
    findBinary("ffmpeg");
    findBinary("ffprobe");
    return true;
  } catch {
    return false;
  }
}

export function run(bin: string, args: string[], timeoutMs = 300_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || err.message).trim().split(/\r?\n/).slice(-6).join("\n");
        reject(new AppError(`FFmpeg failed: ${tail}`, { code: "FFMPEG_RENDER_FAILED", status: 500, details: tail }));
      } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export const runFfmpeg = (args: string[], timeoutMs?: number) => run(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...args], timeoutMs);

export interface ProbeInfo {
  streams?: Record<string, unknown>[];
  format?: Record<string, unknown>;
}

/** ffprobe's JSON; an unreadable file is CORRUPTED_MEDIA. */
export async function probe(file: string): Promise<ProbeInfo> {
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-i", path.resolve(file)];
  let stdout: string;
  try {
    stdout = await new Promise<string>((resolve, reject) =>
      execFile(findBinary("ffprobe"), args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, out, stderr) =>
        err ? reject(Object.assign(err, { stderrText: String(stderr) })) : resolve(String(out))),
    );
  } catch (e) {
    const err = e as { killed?: boolean; stderrText?: string };
    if (err.killed) throw new AppError("Timed out reading media metadata.", { code: "PROBE_TIMEOUT" });
    throw new AppError("The file could not be read as media. It may be corrupted or unsupported.", { code: "CORRUPTED_MEDIA", details: (err.stderrText ?? "").slice(-500) });
  }
  try {
    return JSON.parse(stdout || "{}");
  } catch {
    throw new AppError("ffprobe returned unreadable output.", { code: "CORRUPTED_MEDIA" });
  }
}
