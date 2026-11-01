import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { settings } from "../core/config";
import { AppError, ValidationFailed } from "../core/errors";
import { probe, renderFfmpeg } from "../core/ffmpeg";
import { sendFile } from "../core/http";

/** A clip this browser cannot open or decode (a camera's ProRes / 4:2:2 10-bit, an old codec): converted here to the
 * Reel editor's format, H.264 8-bit SDR (or VP9 for a browser without H.264), at most 1080 × 1920, 30 fps; HDR is
 * tone-mapped to normal colours. Only for what the browser cannot do itself (the studio converts on the device first).
 * A job: POST sends the file and gets an id at once; GET .../[id] tells the progress; GET .../[id]/file gives the result
 * (no request waits for the conversion, so proxy and CDN time limits never cut it). Results are removed after 15 min. */
export const CONVERT_LIMITS = { bytes: 95 * 1024 * 1024, seconds: 180, running: 2, keepMs: 15 * 60_000 };
type Job = { status: "running" | "done" | "failed"; progress: number; error?: { code: string; message: string }; dir: string; out: string; type: string; at: number };
const jobs = new Map<string, Job>();
let running = 0;

export function convertFilter(stream: { color_transfer?: string; color_primaries?: string }): string {
  const hdr = /arib-std-b67|smpte2084/.test(stream.color_transfer ?? "") || stream.color_primaries === "bt2020";
  const tone = hdr ? "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv," : "";
  // the frame rate first and the size next (the long side at most 1920, even sizes): tone-mapping 1080p instead of 4K
  // frames is four times less work
  return `fps=30,scale='if(gte(iw,ih),min(1920,iw),-2)':'if(gte(iw,ih),-2,min(1920,ih))':flags=bicubic,scale=trunc(iw/2)*2:trunc(ih/2)*2,${tone}format=yuv420p`;
}

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.status !== "running" && now - j.at > CONVERT_LIMITS.keepMs) { fs.rmSync(j.dir, { recursive: true, force: true }); jobs.delete(id); }
}

export async function startConvert(req: Request): Promise<{ id: string }> {
  sweep();
  const len = Number(req.headers.get("content-length") || 0);
  if (!req.body) throw new ValidationFailed("No video was sent.", { code: "CONVERT_EMPTY" });
  if (len > CONVERT_LIMITS.bytes) throw new ValidationFailed(`This video is too big to convert online (at most ${Math.round(CONVERT_LIMITS.bytes / 1048576)} MB). Export it from the camera or phone as MP4 (H.264) and add it again.`, { code: "CONVERT_TOO_BIG" });
  if (running >= CONVERT_LIMITS.running) throw new AppError("Many videos are being converted right now. Please try again in a minute.", { code: "CONVERT_BUSY", status: 503 });
  const webm = new URL(req.url).searchParams.get("to") === "webm";   // a browser without H.264 (some Linux builds)
  const id = crypto.randomUUID(), dir = path.join(settings.scratchPath, "convert", id);
  fs.mkdirSync(dir, { recursive: true });
  const src = path.join(dir, "in"), out = path.join(dir, webm ? "out.webm" : "out.mp4");
  running++;
  let started = false;
  try {
    let got = 0;
    const cap = new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, c) { got += chunk.byteLength; if (got > CONVERT_LIMITS.bytes) c.error(new ValidationFailed("This video is too big to convert online.", { code: "CONVERT_TOO_BIG" })); else c.enqueue(chunk); } });
    await pipeline(Readable.fromWeb(req.body.pipeThrough(cap) as never), fs.createWriteStream(src));
    const info = await probe(src);
    const v = (info.streams ?? []).find((s: { codec_type?: string }) => s.codec_type === "video");
    if (!v) throw new ValidationFailed("This file has no video in it.", { code: "CONVERT_NO_VIDEO" });
    const dur = Number(info.format?.duration || 0);
    if (dur > CONVERT_LIMITS.seconds) throw new ValidationFailed(`This video is too long to convert online (at most ${CONVERT_LIMITS.seconds / 60} min). Trim it or export it as MP4 (H.264) and add it again.`, { code: "CONVERT_TOO_LONG" });
    const hasAudio = (info.streams ?? []).some((s: { codec_type?: string }) => s.codec_type === "audio");
    const job: Job = { status: "running", progress: 0, dir, out, type: webm ? "video/webm" : "video/mp4", at: Date.now() };
    jobs.set(id, job);
    const args = ["-i", src, "-map", "0:v:0", ...(hasAudio ? ["-map", "0:a:0"] : []), "-vf", convertFilter(v),
      ...(webm ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "6", "-row-mt", "1", "-b:v", "8M", "-g", "30"]
        : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high", "-g", "30"]),
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
      ...(hasAudio ? (webm ? ["-c:a", "libopus", "-b:a", "160k", "-ac", "2"] : ["-c:a", "aac", "-b:a", "160k", "-ac", "2"]) : []),
      ...(webm ? [] : ["-movflags", "+faststart"]), out];
    started = true;
    void renderFfmpeg(args, { timeout: 20 * 60, expectedDuration: dur || undefined, onProgress: (f) => { job.progress = Math.max(job.progress, Math.min(0.99, f)); }, errorCode: "CONVERT_FAILED" })
      .then(() => { job.status = "done"; job.progress = 1; fs.rmSync(src, { force: true }); })
      .catch((e: unknown) => { const err = e as { code?: string; message?: string }; job.status = "failed"; job.error = { code: err.code || "CONVERT_FAILED", message: "Shubix could not convert this video. " + (err.message ? String(err.message).split("\n")[0].slice(0, 160) : "") }; fs.rmSync(dir, { recursive: true, force: true }); })
      .finally(() => { running--; job.at = Date.now(); });
    return { id };
  } finally {
    if (!started) { running--; fs.rmSync(dir, { recursive: true, force: true }); }
  }
}

const jobOf = (id: string) => { const j = jobs.get(id); if (!j) throw new AppError("This conversion is no longer here. Add the video again.", { code: "CONVERT_GONE", status: 404 }); return j; };
export function convertStatus(id: string) { const j = jobOf(id); return { status: j.status, progress: +j.progress.toFixed(3), error: j.error ?? null }; }
export function convertFile(req: Request, id: string): Response {
  const j = jobOf(id);
  if (j.status !== "done") throw new AppError("The video is not converted yet.", { code: "CONVERT_NOT_READY", status: 409 });
  return sendFile(req, j.out, j.type, { cache: "no-store" });
}
