import { AppError, UnsupportedMedia } from "@/server/core/errors";
import type { ProbeInfo } from "@/server/core/ffmpeg";
import { round } from "@/server/core/py";

/** What an upload's ffprobe says (was video/analyzer.parse_video_probe and media_service._audio_facts). */

export interface VideoMetadata {
  duration: number; width: number; height: number; fps: number; codec: string; hasAudio: boolean; rotation: number;
  bitRate: number | null; orientation: "square" | "landscape" | "portrait";
}

const pyMod = (a: number, n: number) => ((a % n) + n) % n;

export function parseVideoProbe(info: ProbeInfo): VideoMetadata {
  const streams = info.streams ?? [];
  const stream = streams.find((s) => s.codec_type === "video") as Record<string, unknown> | undefined;
  if (!stream) throw new UnsupportedMedia("This file has no video stream.", { code: "NO_VIDEO_STREAM" });
  const fmt = info.format ?? {};
  const duration = Number(fmt.duration || stream.duration || 0);
  if (duration < 0.2) throw new UnsupportedMedia("The video is too short or has no readable duration.");
  let w = Math.trunc(Number(stream.width || 0));
  let h = Math.trunc(Number(stream.height || 0));
  let rotation = 0;
  for (const sd of (stream.side_data_list as Record<string, unknown>[] | undefined) ?? []) if ("rotation" in sd) rotation = pyMod(round(Number(sd.rotation)), 360);
  if (!rotation) rotation = pyMod(Math.trunc(Number((stream.tags as Record<string, unknown> | undefined)?.rotate || 0)), 360);
  if (rotation === 90 || rotation === 270) [w, h] = [h, w];
  if (w <= 0 || h <= 0) throw new AppError("The video has invalid dimensions.", { code: "CORRUPTED_MEDIA" });
  const [num, den = "1"] = String(stream.avg_frame_rate || stream.r_frame_rate || "0/1").split("/");
  const fNum = Number(num), fDen = Number(den || 1);
  const fps = Number.isFinite(fNum) && Number.isFinite(fDen) && fDen ? fNum / fDen : 0;
  const br = fmt.bit_rate;
  const orientation = Math.abs(w - h) / Math.max(w, h) < 0.05 ? "square" : w > h ? "landscape" : "portrait";
  return {
    duration: round(duration, 3), width: w, height: h, fps: round(fps, 3), codec: String(stream.codec_name ?? ""),
    hasAudio: streams.some((s) => s.codec_type === "audio"), rotation, bitRate: br && /^\d+$/.test(String(br)) ? Number(br) : null, orientation,
  };
}

export function videoFacts(info: ProbeInfo) {
  const m = parseVideoProbe(info);
  return { duration: m.duration, width: m.width, height: m.height, fps: m.fps };
}

export function audioFacts(info: ProbeInfo) {
  if (!(info.streams ?? []).some((s) => s.codec_type === "audio")) throw new UnsupportedMedia("This file has no audio stream.", { code: "NO_AUDIO_STREAM" });
  const duration = Number(info.format?.duration || 0);
  if (duration < 1.0) throw new UnsupportedMedia("The audio is too short (minimum 1 second).");
  return { duration: round(duration, 3) };
}
