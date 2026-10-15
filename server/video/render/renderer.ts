import "server-only";
import fs from "node:fs";
import { moveFileAsync } from "@/server/storage/local";
import path from "node:path";
import { FFmpegError, InsufficientStorage, RenderTimeout, ValidationFailed } from "@/server/core/errors";
import { probe, renderFfmpeg } from "@/server/core/ffmpeg";
import { fixed } from "@/server/core/py";
import type { Segment, Timeline, VoiceTrack, Watermark } from "@/server/models/timeline";
import type { EditingStyle } from "@/server/styles";
import { buildSegmentCommand, measureShake, outLength, planSegments, type RenderConfig, type SegmentPlan, type SourceClip } from "./cutter";
import { buildAudioGraph, encoderArgs, getTransition, gradeFilter, originalAudioGraph, STEREO, xfadeName, xfadeTransitions } from "./parts";
import { synthTrack } from "./sfx";

/** Timeline -> a real MP4 (were video/renderer.py and composer.py): every shot cut to an intermediate, then joined
 * with transitions, fades, watermark, music / voice / sound-effects mix and the final H.264 + AAC encode. */

const SEGMENT_SHARE = 0.7, CHUNK_AT = 24, CHUNK_SIZE = 16, CHUNK_SHARE = 0.15, MIN_FREE_BYTES = 512 * 1024 * 1024;
const NORM = (fps: number) => `settb=AVTB,setpts=PTS-STARTPTS,fps=${fps},format=yuv420p,setsar=1`;

export interface RenderResult { path: string; duration: number; width: number; height: number; size: number }

/** Joins [0:v]..[n-1:v] into [vjoin]: (graph, joined length). `xfade` = this FFmpeg's transitions (null = use names as given). */
export function buildVideoGraph(segments: Segment[], plans: SegmentPlan[], cfg: RenderConfig, xfade: Set<string> | null = null): [string, number] {
  const parts = segments.map((_, i) => `[${i}:v]${NORM(cfg.fps)}[s${i}]`);
  let cur = "[s0]", len = outLength(plans[0]);
  for (let i = 1; i < segments.length; i++) {
    const t = segments[i].transitionIn, spec = getTransition(t.type), label = `[j${i}]`;
    if (spec.kind === "xfade" && t.duration > 0) {
      parts.push(`${cur}[s${i}]xfade=transition=${xfadeName(spec.xfade!, xfade)}:duration=${fixed(t.duration, 3)}:offset=${fixed(len - t.duration, 3)},settb=AVTB,fps=${cfg.fps}${label}`);
      len += outLength(plans[i]) - t.duration;
    } else {
      parts.push(`${cur}[s${i}]concat=n=2:v=1:a=0,settb=AVTB,fps=${cfg.fps}${label}`);
      len += outLength(plans[i]);
    }
    cur = label;
  }
  parts.push(`${cur}null[vjoin]`);
  return [parts.join(";"), len];
}

function chunkCommand(segments: Segment[], plans: SegmentPlan[], files: string[], out: string, cfg: RenderConfig, withAudio: boolean, xfade: Set<string> | null): [string[], number] {
  const [g0, length] = buildVideoGraph(segments, plans, cfg, xfade);
  let graph = g0;
  graph += ";[vjoin]format=yuv420p[v]";
  const args = files.flatMap((f) => ["-i", f]);
  if (withAudio) graph += `;${originalAudioGraph(segments)};[orig]${STEREO}[a]`;
  args.push("-filter_complex", graph, "-map", "[v]", ...(withAudio ? ["-map", "[a]"] : ["-an"]), "-t", fixed(length, 3), "-c:v", "libx264", "-crf", "12", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-r", String(cfg.fps));
  if (withAudio) args.push("-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2");
  args.push(out);
  return [args, length];
}

const WM: Record<string, [string, string]> = { br: ["W-w-{mx}", "H-h-{my}"], bl: ["{mx}", "H-h-{my}"], tr: ["W-w-{mx}", "{mt}"], tl: ["{mx}", "{mt}"], center: ["(W-w)/2", "(H-h)/2"] };
function watermarkFilter(idx: number, wm: Watermark, cfg: RenderConfig): string {
  const fill = (s: string) => s.replace("{mx}", String(Math.trunc(cfg.width * 0.04))).replace("{my}", String(Math.trunc(cfg.height * 0.16))).replace("{mt}", String(Math.trunc(cfg.height * 0.07)));
  const [x, y] = WM[wm.position].map(fill);
  const w = Math.max(Math.floor(Math.trunc(cfg.width * wm.scale) / 2) * 2, 8);
  return `[${idx}:v]format=rgba,scale=${w}:-2,colorchannelmixer=aa=${fixed(wm.opacity, 2)}[wm];[vp][wm]overlay=x=${x}:y=${y}:shortest=1${wm.showFrom ? `:enable='gte(t,${fixed(wm.showFrom, 3)})'` : ""}[v]`; // showFrom: the logo only on the closing seconds
}

export interface ComposeIn {
  segments: Segment[]; plans: SegmentPlan[]; files: string[]; audioPath: string | null; audioStart: number; duration: number; style: EditingStyle;
  cfg: RenderConfig; out: string; videoPost?: string[]; volume?: number; fadeIn?: number | null; fadeOut?: number | null; voice?: VoiceTrack | null;
  voicePath?: string | null; watermark?: Watermark | null; watermarkPath?: string | null; sfxPath?: string | null; xfade?: Set<string> | null;
}

export function buildComposeCommand(c: ComposeIn): string[] {
  let [graph] = buildVideoGraph(c.segments, c.plans, c.cfg, c.xfade ?? null);
  const post = [...(c.videoPost ?? [])];
  if (c.style.fadeInOut > 0) {
    const f = Math.min(c.style.fadeInOut, c.duration / 4);
    post.push(`fade=t=in:st=0:d=${fixed(f, 3)}`, `fade=t=out:st=${fixed(c.duration - f, 3)}:d=${fixed(f, 3)}`);
  }
  post.push("format=yuv420p");
  const args = c.files.flatMap((f) => ["-i", f]);
  let idx = c.files.length;
  if (c.watermark && c.watermarkPath) {
    args.push("-loop", "1", "-i", c.watermarkPath);
    graph += `;[vjoin]${post.join(",")}[vp];${watermarkFilter(idx, c.watermark, c.cfg)}`;
    idx++;
  } else graph += `;[vjoin]${post.join(",")}[v]`;
  const mode = c.cfg.audioMode;
  let musicIdx: number | null = null, voiceIdx: number | null = null, sfxIdx: number | null = null;
  if (["music", "voice_music"].includes(mode) && c.audioPath) { args.push("-ss", fixed(c.audioStart, 3), "-t", fixed(c.duration + 0.5, 3), "-i", c.audioPath); musicIdx = idx++; }
  if (["voice", "voice_music"].includes(mode) && c.voice && c.voicePath) { args.push("-i", c.voicePath); voiceIdx = idx++; }
  if (c.sfxPath && mode !== "none") { args.push("-i", c.sfxPath); sfxIdx = idx++; }
  const agraph = buildAudioGraph({ mode, musicIdx, voiceIdx, segments: c.segments, duration: c.duration, style: c.style, lufs: c.cfg.targetLufs, voice: c.voice ?? null,
    musicVolume: c.volume ?? 1, fadeIn: c.fadeIn ?? null, fadeOut: c.fadeOut ?? null, sfxIdx });
  if (agraph) graph += ";" + agraph;
  args.push("-filter_complex", graph, "-map", "[v]", ...(agraph ? ["-map", "[a]"] : ["-an"]), "-t", fixed(c.duration, 3), ...encoderArgs(c.cfg.encoder, c.cfg.finalCrf, c.cfg.finalPreset),
    "-pix_fmt", "yuv420p", "-r", String(c.cfg.fps), "-maxrate", c.cfg.maxBitrate, "-bufsize", "24M");
  if (agraph) args.push("-c:a", "aac", "-b:a", c.cfg.audioBitrate, "-ar", "48000", "-ac", "2");
  args.push("-movflags", "+faststart", c.out);
  return args;
}

const estimateDiskNeed = (t: Timeline, cfg: RenderConfig) => Math.trunc(((t.duration * cfg.width * cfg.height * cfg.fps * 0.35) / 8) * 1.3) + 50 * 1024 * 1024;

export interface RenderIn {
  timeline: Timeline; sources: Map<string, SourceClip>; audioPath: string | null; outPath: string; workDir: string; style: EditingStyle; cfg: RenderConfig;
  progress?: (f: number) => void; timeout?: number; videoPost?: string[]; voicePath?: string | null; watermarkPath?: string | null; signal?: AbortSignal;
}

export async function renderTimeline(r: RenderIn): Promise<RenderResult> {
  const { timeline: tl, sources, cfg } = r;
  if (!tl.segments.length) throw new ValidationFailed("The timeline has no segments to render.", { code: "EMPTY_TIMELINE" });
  const missing = [...new Set(tl.segments.map((s) => s.clipId))].filter((id) => !sources.has(id));
  if (missing.length) throw new ValidationFailed(`Missing source clips: ${JSON.stringify(missing.sort())}`, { code: "MISSING_SOURCE" });
  fs.mkdirSync(r.workDir, { recursive: true });
  fs.mkdirSync(path.dirname(r.outPath), { recursive: true });
  const need = estimateDiskNeed(tl, cfg) + MIN_FREE_BYTES;
  const free = (() => { try { const s = fs.statfsSync(r.workDir); return s.bavail * s.bsize; } catch { return Infinity; } })();
  if (free < need) throw new InsufficientStorage("Not enough free disk space to render.", { details: { neededBytes: need, freeBytes: free } });
  let last = 0;
  const report = (f: number) => { last = Math.max(last, Math.min(Math.max(f, 0), 1)); r.progress?.(last); };
  const timeout = r.timeout ?? 900, deadline = Date.now() + timeout * 1000;
  const remaining = () => { const left = (deadline - Date.now()) / 1000; if (left <= 0) throw new RenderTimeout(`Rendering exceeded the ${Math.trunc(timeout)}s time limit.`); return left; };
  const hits = ["music", "voice_music"].includes(cfg.audioMode) ? tl.musicHits.map((h) => h - tl.audioStart) : [];
  const plans = planSegments(tl.segments, hits);
  const n = tl.segments.length, grade = gradeFilter(tl.colorGrade, r.style.gradeFilter), chunked = n > CHUNK_AT;
  const xfade = await xfadeTransitions(); // a transition this FFmpeg lacks becomes the closest one it has
  const cutShare = SEGMENT_SHARE - (chunked ? CHUNK_SHARE : 0);
  try {
    let files: string[] = [];
    for (const [i, seg] of tl.segments.entries()) {
      const out = path.join(r.workDir, `seg_${String(i).padStart(3, "0")}.mp4`), src = sources.get(seg.clipId)!;
      const transforms = await measureShake(seg, src, plans[i], cfg, out, remaining(), r.signal);
      await renderFfmpeg(buildSegmentCommand(seg, src, out, plans[i], cfg, grade, transforms), { timeout: remaining(), expectedDuration: outLength(plans[i]), signal: r.signal });
      files.push(out);
      report((cutShare * (i + 1)) / n);
    }
    let segs = tl.segments, cplans = plans;
    if (chunked) {
      const outFiles: string[] = [], supSegs: Segment[] = [], supPlans: SegmentPlan[] = [];
      let t = 0;
      const bounds = Array.from({ length: Math.ceil(n / CHUNK_SIZE) }, (_, k) => [k * CHUNK_SIZE, Math.min((k + 1) * CHUNK_SIZE, n)]);
      for (const [k, [a, b]] of bounds.entries()) {
        const out = path.join(r.workDir, `chunk_${String(k).padStart(3, "0")}.mp4`);
        const [cmd, length] = chunkCommand(tl.segments.slice(a, b), plans.slice(a, b), files.slice(a, b), out, cfg, cfg.audioMode === "original", xfade);
        await renderFfmpeg(cmd, { timeout: remaining(), expectedDuration: length, signal: r.signal });
        for (const f of files.slice(a, b)) fs.rmSync(f, { force: true });
        const lastPlan = plans[b - 1], plan: SegmentPlan = { length: Number((length - lastPlan.tail).toFixed(4)), tail: lastPlan.tail, ramp: lastPlan.ramp, hits: [] };
        supPlans.push(plan);
        supSegs.push({ ...tl.segments[a], clipId: `chunk${k}`, video: `chunk ${k + 1}`, sourceStart: 0, sourceEnd: length, timelineStart: t, timelineEnd: t + plan.length, transitionIn: tl.segments[a].transitionIn });
        t += plan.length;
        outFiles.push(out);
        report(cutShare + (CHUNK_SHARE * (k + 1)) / bounds.length);
      }
      files = outFiles; segs = supSegs; cplans = supPlans;
    }
    const finalFrom = cutShare + (chunked ? CHUNK_SHARE : 0), tmpOut = path.join(r.workDir, "final.mp4");
    const sfxPath = tl.sfx.length && cfg.audioMode !== "none" ? synthTrack(tl.sfx, tl.duration, path.join(r.workDir, "sfx.wav")) : null;
    const compose = (c: RenderConfig) => renderFfmpeg(buildComposeCommand({
      segments: segs, plans: cplans, files, audioPath: r.audioPath, audioStart: tl.audioStart, duration: tl.duration, style: r.style, cfg: c, out: tmpOut,
      videoPost: r.videoPost, volume: tl.musicVolume, fadeIn: tl.musicFadeIn, fadeOut: tl.musicFadeOut, voice: tl.voice, voicePath: r.voicePath,
      watermark: tl.watermark, watermarkPath: r.watermarkPath, sfxPath, xfade,
    }), { timeout: remaining(), expectedDuration: tl.duration, onProgress: (f) => report(finalFrom + (1 - finalFrom) * f), signal: r.signal });
    try {
      await compose(cfg);
    } catch (e) {
      if (!(e instanceof FFmpegError) || cfg.encoder === "libx264") throw e;
      console.warn(`hardware encoder ${cfg.encoder} failed; retrying with the CPU encoder`);
      await compose({ ...cfg, encoder: "libx264" });
    }
    await moveFileAsync(tmpOut, r.outPath);
  } finally {
    fs.rmSync(r.workDir, { recursive: true, force: true }); // never leave intermediates behind
  }
  const info = await probe(r.outPath);
  const v = (info.streams ?? []).find((s) => s.codec_type === "video")!;
  report(1);
  return { path: r.outPath, duration: Number(info.format?.duration ?? 0), width: Number(v.width), height: Number(v.height), size: fs.statSync(r.outPath).size };
}
