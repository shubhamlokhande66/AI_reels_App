import "server-only";
import path from "node:path";
import { RenderTimeout } from "@/server/core/errors";
import { renderFfmpeg } from "@/server/core/ffmpeg";
import { fixed, round } from "@/server/core/py";
import type { Segment } from "@/server/models/timeline";
import * as kf from "@/server/video/keyframes";
import { atempoChain, computeCrop, getTransition, isOverlapping, pyf, RAMP_FACTOR, RAMP_SECONDS } from "./parts";

/** One timeline segment cut out of its source and normalised to the output (was video/cutter.py): cropped to 9:16 (or
 * fitted over a blurred backdrop), speed-adjusted, zoom / pan / look effects, constant frame rate. */

const ZOOM_AMOUNT = 0.08, PUNCH_AMOUNT = 0.1, PUNCH_SECONDS = 0.25, PULSE_AMOUNT = 0.035, PULSE_PERIOD = 0.6, PAN_SCALE = 1.14, MOTION_SCALE = 1.12;
const SHAKE_AMOUNT = 0.7, ROLL_RADIANS = 0.035, ROLL_PERIOD = 2.4, CRASH_AMOUNT = 0.3, CRASH_SECONDS = 0.25, KEN_BURNS_AMOUNT = 0.12;
const FLASH_STRENGTH = 0.55, FLASH_SECONDS = 0.2, HIT_PULSE_AMOUNT = 0.045, HIT_PULSE_DECAY = 0.2, HIT_PUNCH_AMOUNT = 0.06, HIT_PUNCH_DECAY = 0.16;
const STUTTER_AMOUNT = 0.05, STUTTER_DECAY = 0.08, HIT_FLASH_STRENGTH = 0.28, HIT_FLASH_DECAY = 0.12, MAX_HITS = 40, SOURCE_MARGIN = 0.15;
const GLOW_SIGMA = 14, GLOW_OPACITY = 0.32, FREEZE_SECONDS = 0.6, UPSCALE_ENHANCE_AT = 1.6, BG_DOWNSCALE = 4, SLOWMO_SMOOTH_BELOW = 0.95;
export const LOOKS = ["black_white", "vignette", "sharpen", "glow", "beat_flash", "flash"];

export interface RenderConfig {
  width: number; height: number; fps: number; cropStrategy: string; framing: "auto" | "fill" | "fit"; fitLossThreshold: number;
  segmentCrf: number; segmentPreset: string; finalCrf: number; finalPreset: string; maxBitrate: string; audioBitrate: string; targetLufs: number;
  encoder: string; audioMode: string; smoothSlowmo: boolean; stabilize: boolean;
}
export const renderConfig = (c: Partial<RenderConfig> = {}): RenderConfig => ({
  width: 1080, height: 1920, fps: 30, cropStrategy: "smart", framing: "auto", fitLossThreshold: 0.35, segmentCrf: 14, segmentPreset: "veryfast",
  finalCrf: 18, finalPreset: "medium", maxBitrate: "12M", audioBitrate: "192k", targetLufs: -14, encoder: "libx264", audioMode: "music",
  smoothSlowmo: true, stabilize: true, ...c,
});

export interface SourceClip {
  path: string; width: number; height: number; name?: string; content?: [number, number, number, number] | null;
  hasAudio?: boolean; shaky?: boolean; brightness?: number;
}

export interface SegmentPlan { length: number; tail: number; ramp: boolean; hits: number[] }
export const outLength = (p: SegmentPlan) => p.length + p.tail;

/** Tails / ramps: a segment runs past its end by the next transition; `hits` (Reel times) become shot times. */
export function planSegments(segments: Segment[], hits: number[] = []): SegmentPlan[] {
  return segments.map((seg, i) => {
    const nxt = i + 1 < segments.length ? segments[i + 1].transitionIn : null;
    const inside = hits.filter((h) => seg.timelineStart + 0.05 < h && h < seg.timelineEnd - 0.05).map((h) => round(h - seg.timelineStart, 3));
    return {
      length: round(seg.timelineEnd - seg.timelineStart, 4), tail: round(nxt && isOverlapping(nxt.type) ? nxt.duration : 0, 4),
      ramp: Boolean(nxt && getTransition(nxt.type).kind === "ramp"), hits: inside.slice(0, MAX_HITS),
    };
  });
}

const envelope = (hits: number[], decay: number) => "min(1," + hits.map((h) => `gte(t,${fixed(h, 3)})*max(0,1-(t-${fixed(h, 3)})/${pyf(decay)})`).join("+") + ")";

export function zoomExpression(effect: string, length: number, hits: number[] = []): string | null {
  const d = fixed(Math.max(length, 0.1), 3);
  if (effect === "zoom_pulse" && hits.length) return `(1+${pyf(HIT_PULSE_AMOUNT)}*${envelope(hits, HIT_PULSE_DECAY)})`;
  if (effect === "beat_stutter" && hits.length) return `(1+${pyf(STUTTER_AMOUNT)}*${envelope(hits, STUTTER_DECAY)})`;
  if (effect === "beat_punch" || effect === "beat_stutter") {
    if (hits.length) return `(1+${pyf(HIT_PUNCH_AMOUNT)}*${envelope(hits, HIT_PUNCH_DECAY)})`;
    effect = "punch";
  }
  switch (effect) {
    case "zoom_in": return `(1+${pyf(ZOOM_AMOUNT)}*min(t/${d},1))`;
    case "zoom_out": return `(1+${pyf(ZOOM_AMOUNT)}*(1-min(t/${d},1)))`;
    case "punch": return `(1+${pyf(PUNCH_AMOUNT)}*max(0,1-t/${pyf(PUNCH_SECONDS)}))`;
    case "punch_out": return `(1+${pyf(PUNCH_AMOUNT)}*max(0,1-(${d}-t)/${pyf(PUNCH_SECONDS)}))`;
    case "zoom_pulse": return `(1+${pyf(PULSE_AMOUNT)}*(0.5+0.5*sin(2*PI*t/${pyf(PULSE_PERIOD)})))`;
    case "crash_zoom": {
      const crash = `(1+${pyf(CRASH_AMOUNT)}*min(t/${pyf(CRASH_SECONDS)},1))`;
      return hits.length ? `${crash}*(1+${pyf(STUTTER_AMOUNT)}*${envelope(hits, STUTTER_DECAY)})` : crash;
    }
    case "ken_burns": return `(1+${pyf(KEN_BURNS_AMOUNT)}*min(t/${d},1))`;
  }
  return null;
}

export function panExpression(effect: string, length: number): [string, string] | null {
  const p = `min(t/${fixed(Math.max(length, 0.1), 3)},1)`, e = `(0.5-0.5*cos(PI*${p}))`, cx = "(in_w-out_w)/2", cy = "(in_h-out_h)/2";
  return ({ pan_right: [`(in_w-out_w)*${e}`, cy], pan_left: [`(in_w-out_w)*(1-${e})`, cy], pan_down: [cx, `(in_h-out_h)*${e}`], pan_up: [cx, `(in_h-out_h)*(1-${e})`] } as Record<string, [string, string]>)[effect] ?? null;
}

export function motionChain(effect: string, w: number, h: number, length: number, hits: number[] = []): string {
  const z = zoomExpression(effect, length, hits);
  const zs = `scale=w='trunc(${2 * w}*${z}/2)*2':h='trunc(${2 * h}*${z}/2)*2':eval=frame:flags=bicubic`;
  if (effect === "ken_burns") {
    const p = `min(t/${fixed(Math.max(length, 0.1), 3)},1)`;
    return `${zs},crop=w=${2 * w}:h=${2 * h}:x='(in_w-out_w)*${p}':y='(in_h-out_h)*(1-${p})',scale=${w}:${h}:flags=area`;
  }
  if (z) return `${zs},crop=${2 * w}:${2 * h},scale=${w}:${h}:flags=area`; // drawn at 2x: the zoom moves in half-pixel steps
  const pan = panExpression(effect, length);
  if (pan) return `scale=w='trunc(${w}*${pyf(PAN_SCALE)}/2)*2':h='trunc(${h}*${pyf(PAN_SCALE)}/2)*2':flags=bicubic,crop=w=${w}:h=${h}:x='${pan[0]}':y='${pan[1]}'`;
  const big = `scale=w='trunc(${w}*${pyf(MOTION_SCALE)}/2)*2':h='trunc(${h}*${pyf(MOTION_SCALE)}/2)*2':flags=bicubic`;
  if (effect === "shake") return `${big},crop=w=${w}:h=${h}:x='(in_w-out_w)/2*(1+${pyf(SHAKE_AMOUNT)}*sin(2*PI*t*6.3))':y='(in_h-out_h)/2*(1+${pyf(SHAKE_AMOUNT)}*cos(2*PI*t*8.7))'`;
  if (effect === "roll") return `${big},rotate=a='${pyf(ROLL_RADIANS)}*sin(2*PI*t/${pyf(ROLL_PERIOD)})':fillcolor=black,crop=${w}:${h}`;
  return `scale=${w}:${h}:flags=lanczos`;
}

export function lookFilters(effect: string, hits: number[] = []): string[] {
  if (effect === "beat_flash" && hits.length) return [`eq=brightness='${pyf(HIT_FLASH_STRENGTH)}*${envelope(hits, HIT_FLASH_DECAY)}':eval=frame`];
  if (effect === "flash" || effect === "beat_flash") return [`eq=brightness='${pyf(FLASH_STRENGTH)}*max(0,1-t/${pyf(FLASH_SECONDS)})':eval=frame`];
  if (effect === "black_white") return ["hue=s=0"];
  if (effect === "vignette") return ["vignette=angle=PI/4.5"];
  if (effect === "sharpen") return ["unsharp=5:5:1.0:5:5:0.0"];
  if (effect === "glow") return [`format=gbrp,split[gl1][gl2];[gl2]gblur=sigma=${GLOW_SIGMA}[gl3];[gl1][gl3]blend=all_mode=screen:all_opacity=${pyf(GLOW_OPACITY)}`];
  return [];
}

const freezeFilters = (effect: string, length: number) => (effect === "freeze" ? [`tpad=start_mode=clone:start_duration=${fixed(Math.min(FREEZE_SECONDS, 0.4 * length), 3)}`] : []);

export function chooseFraming(cw: number, ch: number, cfg: RenderConfig): "fill" | "fit" {
  if (cfg.framing === "fill" || cfg.framing === "fit") return cfg.framing;
  const ratio = cw / Math.max(ch, 1), aspect = cfg.width / cfg.height;
  return 1 - Math.min(ratio, aspect) / Math.max(ratio, aspect) > cfg.fitLossThreshold ? "fit" : "fill";
}

function enhance(upscale: number): [string, string] {
  if (upscale <= UPSCALE_ENHANCE_AT) return ["", ""];
  const s = Math.min(0.8 + (upscale - UPSCALE_ENHANCE_AT) * 0.3, 1.6);
  return [`hqdn3d=${fixed(s, 1)}:${fixed(s * 0.75, 1)}:${fixed(s * 0.8, 1)}:${fixed(s * 0.8, 1)}`, `cas=${fixed(Math.min(0.25 + 0.05 * (upscale - UPSCALE_ENHANCE_AT), 0.4), 2)}`];
}

/** A file path quoted for filtergraph syntax (Windows drive colons and backslashes escaped). */
export const filterPath = (p: string) => "'" + path.resolve(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'") + "'";

function qualityFilters(src: SourceClip, cfg: RenderConfig, transforms: string | null): string[] {
  const out: string[] = [];
  if (cfg.stabilize && src.shaky && transforms) out.push(`vidstabtransform=input=${filterPath(transforms)}:smoothing=12:optzoom=1:interpol=bicubic`);
  const b = src.brightness ?? 0.5;
  if (b < 0.32) {
    const lift = Math.min((0.32 - b) * 0.9, 0.18);
    out.push(`eq=brightness=${fixed(lift, 3)}:gamma=${fixed(1 + lift * 1.5, 3)}:saturation=1.05`);
  } else if (b > 0.8) out.push(`eq=gamma=${fixed(Math.max(1 - (b - 0.8) * 1.2, 0.8), 3)}`);
  return out;
}

const MINTERP = (fps: number) => ["format=yuv444p,format=yuv420p", `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`];

function timeFilters(seg: Segment, cfg: RenderConfig): string[] {
  const length = seg.timelineEnd - seg.timelineStart;
  if (seg.keyframes.length && kf.hasSpeed(seg.keyframes)) {
    const [kfs] = kf.validate(seg.keyframes, length);
    return [kf.speedSetpts(kfs, length), ...(cfg.smoothSlowmo && kf.slowest(kfs) < SLOWMO_SMOOTH_BELOW ? MINTERP(cfg.fps) : [`fps=${cfg.fps}`])];
  }
  return [`setpts=(PTS-STARTPTS)/${fixed(seg.speed, 4)}`, ...(cfg.smoothSlowmo && seg.speed < SLOWMO_SMOOTH_BELOW ? MINTERP(cfg.fps) : [`fps=${cfg.fps}`])];
}

export function framing(seg: Segment, src: SourceClip, cfg: RenderConfig): [string, string, [number, number]] {
  const [cx, cy, cw, ch] = src.content ?? [0, 0, src.width, src.height];
  const mode = seg.crop.framing === "fill" || seg.crop.framing === "fit" ? seg.crop.framing : chooseFraming(cw, ch, cfg);
  if (mode !== "fill") return [mode, `crop=${cw}:${ch}:${cx}:${cy}`, [cw, ch]];
  let fx = seg.focusX, fy = seg.focusY, fsrc = seg.focusSource;
  if (seg.crop.focusX !== null) { fx = seg.crop.focusX; fy = seg.crop.focusY ?? fy; fsrc = "subject"; }
  const r = computeCrop(cfg.cropStrategy, cw, ch, cfg.width / cfg.height, { x: fx, y: fy, source: fsrc });
  return [mode, `crop=${r.w}:${r.h}:${cx + r.x}:${cy + r.y}`, [r.w, r.h]];
}

export function buildFilterGraph(seg: Segment, src: SourceClip, plan: SegmentPlan, cfg: RenderConfig, grade: string | null = null, transforms: string | null = null): string {
  const W = cfg.width, H = cfg.height;
  const [mode, crop, [cw, ch]] = framing(seg, src, cfg);
  const anim = seg.keyframes.length ? kf.merge(kf.preset(seg.effect, plan.length), kf.validate(seg.keyframes, plan.length)[0]) : [];
  const keyed = anim.length > 0 && kf.animates(anim, kf.MOTION);
  const movement = (w: number, h: number) => (keyed ? kf.motionChain(anim, w, h) : motionChain(seg.effect, w, h, plan.length, plan.hits));
  const timeChain = [...qualityFilters(src, cfg, transforms), ...timeFilters(seg, cfg)];
  let core: string;
  if (mode === "fill") {
    const [pre, post] = enhance(Math.max(W / Math.max(cw, 1), H / Math.max(ch, 1)));
    core = `[0:v]${[crop, ...timeChain, ...(pre ? [pre] : []), movement(W, H), ...(post ? [post] : [])].join(",")}`;
  } else {
    // the whole picture fitted inside the canvas, over a dimmed, blurred copy of itself
    const [fw, fh] = cw / Math.max(ch, 1) >= W / H ? [W, Math.max(Math.floor(Math.trunc((W * ch) / cw) / 2) * 2, 2)] : [Math.max(Math.floor(Math.trunc((H * cw) / ch) / 2) * 2, 2), H];
    const [pre, post] = enhance(Math.max(fw / Math.max(cw, 1), fh / Math.max(ch, 1)));
    const base = [crop, ...timeChain, ...(pre ? [pre] : [])];
    const bw = Math.trunc(W / BG_DOWNSCALE), bh = Math.trunc(H / BG_DOWNSCALE);
    core = `[0:v]${base.join(",")},split[bgs][fgs];` +
      `[bgs]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},gblur=sigma=6,eq=brightness=-0.10:saturation=1.15,scale=${W}:${H}:flags=bicubic[bg];` +
      `[fgs]${[movement(fw, fh), ...(post ? [post] : [])].join(",")}[fg];[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2:shortest=1`;
  }
  core += ",tpad=stop_mode=clone:stop_duration=3";
  let graph: string;
  if (plan.ramp) {
    const r = Math.min(RAMP_SECONDS, plan.length * 0.5), cut = plan.length - r;
    graph = `${core}[m];[m]split[a][b];[a]trim=start=0:end=${fixed(cut, 3)},setpts=PTS-STARTPTS[a1];` +
      `[b]trim=start=${fixed(cut, 3)}:end=${fixed(cut + r * RAMP_FACTOR, 3)},setpts=(PTS-STARTPTS)/${pyf(RAMP_FACTOR)}[b1];[a1][b1]concat=n=2:v=1:a=0,`;
  } else graph = `${core},`;
  const looks = anim.length && seg.effect === "flash" ? [] : lookFilters(seg.effect, plan.hits);
  for (const name of new Set(seg.looks)) if (LOOKS.includes(name) && name !== seg.effect) looks.push(...lookFilters(name, plan.hits));
  const tail = [...freezeFilters(seg.effect, plan.length), `trim=duration=${fixed(outLength(plan), 3)}`, "setpts=PTS-STARTPTS", ...looks, ...(anim.length ? kf.frameFilters(anim, W, H) : [])];
  if (grade) tail.push(grade);
  tail.push("setsar=1", "format=yuv420p");
  return graph + tail.join(",") + "[v]";
}

/** Source seconds to read: nominal + tail (+ what a ramp or a speed track consumes). */
export function sourceReadSeconds(seg: Segment, plan: SegmentPlan): number {
  let extra = plan.tail;
  if (plan.ramp) extra += Math.min(RAMP_SECONDS, plan.length * 0.5) * (RAMP_FACTOR - 1);
  if (seg.keyframes.length && kf.hasSpeed(seg.keyframes)) return kf.sourceSeconds(kf.validate(seg.keyframes, seg.timelineEnd - seg.timelineStart)[0], plan.length + extra) + SOURCE_MARGIN;
  return (plan.length + extra) * seg.speed + SOURCE_MARGIN;
}

const sourceInput = (seg: Segment, src: SourceClip, plan: SegmentPlan) => ["-ss", fixed(Math.max(seg.sourceStart, 0), 3), "-t", fixed(sourceReadSeconds(seg, plan), 3), "-i", src.path];

export function buildSegmentCommand(seg: Segment, src: SourceClip, out: string, plan: SegmentPlan, cfg: RenderConfig, grade: string | null = null, transforms: string | null = null): string[] {
  let graph = buildFilterGraph(seg, src, plan, cfg, grade, transforms);
  const args = sourceInput(seg, src, plan);
  let audio = ["-an"];
  if (cfg.audioMode === "original") {
    let aIn = "[0:a]";
    if (!src.hasAudio) { args.push("-f", "lavfi", "-t", fixed(outLength(plan), 3), "-i", "anullsrc=r=48000:cl=stereo"); aIn = "[1:a]"; }
    graph += `;${aIn}${atempoChain(seg.speed)},aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${fixed(outLength(plan), 3)},asetpts=PTS-STARTPTS,volume=${fixed(seg.volume, 3)}[a]`;
    audio = ["-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"];
  }
  return [...args, "-filter_complex", graph, "-map", "[v]", ...audio, "-c:v", "libx264", "-preset", cfg.segmentPreset, "-crf", String(cfg.segmentCrf),
    "-pix_fmt", "yuv420p", "-r", String(cfg.fps), "-t", fixed(outLength(plan), 3), out];
}

/** Pass 1 of stabilising a shaky clip: the transforms file (null = steady, off, or measuring failed). */
export async function measureShake(seg: Segment, src: SourceClip, plan: SegmentPlan, cfg: RenderConfig, out: string, timeout?: number, signal?: AbortSignal): Promise<string | null> {
  if (!(cfg.stabilize && src.shaky)) return null;
  const transforms = out.replace(/\.[^.]+$/, ".trf");
  const [, crop] = framing(seg, src, cfg);
  try {
    await renderFfmpeg([...sourceInput(seg, src, plan), "-vf", `${crop},vidstabdetect=shakiness=6:accuracy=12:result=${filterPath(transforms)}`, "-an", "-f", "null", "-"], { timeout, signal });
  } catch (e) {
    if (e instanceof RenderTimeout || signal?.aborted) throw e;
    console.warn(`stabilising ${src.name || path.basename(src.path)} failed; rendering it as shot`, e);
    return null;
  }
  return transforms;
}
