import "server-only";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { inBucket, moveFileAsync } from "@/server/storage/local";
import { settings } from "./config";
import { AppError, FFmpegError, RenderTimeout } from "./errors";

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

/** The copy shipped as an npm package (ffmpeg-static / ffprobe-static, Linux x64): for a host with no FFmpeg installed
 * (Vercel). Read at run time from its folder (next.config.ts puts it into the functions that use it). */
function bundled(name: "ffmpeg" | "ffprobe"): string | null {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const p = name === "ffmpeg" ? path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    : path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  return fs.existsSync(p) ? p : null;
}

export function findBinary(name: "ffmpeg" | "ffprobe"): string {
  const hit = resolved.get(name);
  if (hit) return hit;
  const configured = name === "ffmpeg" ? settings.ffmpegBin : settings.ffprobeBin;
  const candidate = configured || onPath(name) || winget(name) || bundled(name);
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

/** The output file (the last argument) on the local disk while FFmpeg writes it, moved into the bucket when it is done
 * (a mounted bucket is slow at, or cannot do, the seeking writes of an MP4 with +faststart). [args, finish, cleanup]. */
function viaScratch(args: string[]): [string[], () => Promise<void>, () => void] {
  const out = args[args.length - 1];
  if (!out || out.startsWith("-") || out.startsWith("pipe:") || !inBucket(out)) return [args, async () => {}, () => {}];
  const tmp = path.join(settings.scratchPath, "ffmpeg", `${crypto.randomUUID()}${path.extname(out)}`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  return [[...args.slice(0, -1), tmp], () => moveFileAsync(tmp, out), () => fs.rmSync(tmp, { force: true })];
}

export async function runFfmpeg(args: string[], timeoutMs?: number) {
  const [a, finish, cleanup] = viaScratch(args);
  try {
    const r = await run(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", ...a], timeoutMs);
    await finish();
    return r;
  } catch (e) { cleanup(); throw e; }
}

export interface RenderRun {
  /** seconds; default RENDER_TIMEOUT_SECONDS */
  timeout?: number;
  /** seconds of output expected: progress is reported as a share of it */
  expectedDuration?: number;
  onProgress?: (fraction: number) => void;
  errorCode?: string;
  /** stops the run (a cancelled job) */
  signal?: AbortSignal;
}

/** A render step (was core/ffmpeg.run_ffmpeg): an argument list (never a shell string), a hard timeout, progress from
 * FFmpeg's -progress output, and a failure turned into a clear error code (disk full, codec, corrupted source). */
export async function renderFfmpeg(args: string[], opts: RenderRun = {}): Promise<void> {
  const [a, finish, cleanup] = viaScratch(args);
  try { await renderFfmpegRaw(a, opts); await finish(); } catch (e) { cleanup(); throw e; }
}
function renderFfmpegRaw(args: string[], opts: RenderRun = {}): Promise<void> {
  const timeout = opts.timeout ?? settings.renderTimeoutSeconds;
  const cmd = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error"];
  if (settings.ffmpegThreads) cmd.push("-threads", String(settings.ffmpegThreads));
  cmd.push("-progress", "pipe:1", "-nostats", ...args);
  return new Promise((resolve, reject) => {
    const p = spawn(findBinary("ffmpeg"), cmd, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const tail: string[] = [];
    let timedOut = false, out = "";
    const timer = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, Math.max(timeout, 1) * 1000);
    const abort = () => p.kill("SIGKILL");
    opts.signal?.addEventListener("abort", abort);
    p.stderr.setEncoding("utf8").on("data", (d: string) => {
      for (const line of d.split(/\r?\n/)) if (line.trim()) tail.push(line.trimEnd());
      if (tail.length > 40) tail.splice(0, tail.length - 40);
    });
    p.stdout.setEncoding("utf8").on("data", (d: string) => {
      out += d;
      const lines = out.split("\n");
      out = lines.pop() ?? "";
      if (!opts.onProgress || !opts.expectedDuration) return;
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line.trim());
        if (m) opts.onProgress(Math.max(0, Math.min(Number(m[1]) / 1e6 / opts.expectedDuration, 1)));
      }
    });
    p.on("error", (e) => { clearTimeout(timer); reject(new FFmpegError(`FFmpeg could not start: ${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", abort);
      if (timedOut) return reject(new RenderTimeout(`Rendering exceeded the ${Math.trunc(timeout)}s time limit.`, { details: tail.join("\n") }));
      if (opts.signal?.aborted) return reject(new AppError("The job was cancelled.", { code: "JOB_CANCELLED", status: 409 }));
      if (code === 0) return resolve();
      const details = tail.join("\n") || `ffmpeg exited with code ${code} without any message (crash)`;
      const low = details.toLowerCase();
      let errCode = opts.errorCode ?? "FFMPEG_RENDER_FAILED", message = "Video rendering failed.";
      if (low.includes("no space left")) [errCode, message] = ["INSUFFICIENT_DISK_SPACE", "Not enough disk space to render."];
      else if (low.includes("unknown encoder") || low.includes("unsupported codec") || (low.includes("decoder") && low.includes("not found"))) [errCode, message] = ["UNSUPPORTED_CODEC", "A video or audio codec is not supported."];
      else if (low.includes("invalid data found") || low.includes("moov atom not found")) [errCode, message] = ["CORRUPTED_MEDIA", "A source file appears to be corrupted."];
      reject(new FFmpegError(message, { code: errCode, details: details.slice(-1500) }));
    });
  });
}

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
