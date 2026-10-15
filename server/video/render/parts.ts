import "server-only";
import { execFile } from "node:child_process";
import { settings } from "@/server/core/config";
import { findBinary } from "@/server/core/ffmpeg";
import { fixed, round } from "@/server/core/py";
import type { Segment, VoiceTrack } from "@/server/models/timeline";
import type { EditingStyle } from "@/server/styles";

/** The render engine's small parts (were video/transitions.py, grades.py, cropper.py, hardware.py, audio_mix.py). */

/** Python's float repr for the numbers that end up in filter text (1.0 stays "1.0"). */
export const pyf = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

// ------------------------------------------------------------------ transitions
export interface TransitionSpec { name: string; kind: "cut" | "xfade" | "ramp"; xfade: string | null; label: string }
const T: [string, TransitionSpec["kind"], string | null, string][] = [
  ["cut", "cut", null, "Hard cut"], ["fade", "xfade", "fadeblack", "Fade through black"], ["dissolve", "xfade", "fade", "Cross dissolve"],
  ["zoom", "xfade", "zoomin", "Zoom"], ["slide", "xfade", "slideup", "Slide"], ["blur", "xfade", "hblur", "Blur"], ["flash", "xfade", "fadewhite", "Flash"],
  ["speed_ramp", "ramp", null, "Speed ramp"],
  ["wipe_left", "xfade", "wipeleft", "Wipe left"], ["wipe_right", "xfade", "wiperight", "Wipe right"], ["wipe_up", "xfade", "wipeup", "Wipe up"],
  ["wipe_down", "xfade", "wipedown", "Wipe down"], ["wipe_tl", "xfade", "wipetl", "Wipe from top-left"], ["wipe_tr", "xfade", "wipetr", "Wipe from top-right"],
  ["wipe_bl", "xfade", "wipebl", "Wipe from bottom-left"], ["wipe_br", "xfade", "wipebr", "Wipe from bottom-right"], ["slide_left", "xfade", "slideleft", "Slide left"],
  ["slide_right", "xfade", "slideright", "Slide right"], ["slide_down", "xfade", "slidedown", "Slide down"], ["smooth_left", "xfade", "smoothleft", "Smooth wipe left"],
  ["smooth_right", "xfade", "smoothright", "Smooth wipe right"], ["smooth_up", "xfade", "smoothup", "Smooth wipe up"], ["smooth_down", "xfade", "smoothdown", "Smooth wipe down"],
  ["circle_open", "xfade", "circleopen", "Circle open"], ["circle_close", "xfade", "circleclose", "Circle close"], ["circle_crop", "xfade", "circlecrop", "Circle crop"],
  ["rect_crop", "xfade", "rectcrop", "Rectangle crop"], ["vert_open", "xfade", "vertopen", "Vertical open"], ["vert_close", "xfade", "vertclose", "Vertical close"],
  ["horz_open", "xfade", "horzopen", "Horizontal open"], ["horz_close", "xfade", "horzclose", "Horizontal close"], ["distance", "xfade", "distance", "Distance"],
  ["radial", "xfade", "radial", "Radial wipe"], ["pixelize", "xfade", "pixelize", "Pixelate"], ["diag_tl", "xfade", "diagtl", "Diagonal from top-left"],
  ["diag_tr", "xfade", "diagtr", "Diagonal from top-right"], ["diag_bl", "xfade", "diagbl", "Diagonal from bottom-left"], ["diag_br", "xfade", "diagbr", "Diagonal from bottom-right"],
  ["slice_h_left", "xfade", "hlslice", "Horizontal slices from left"], ["slice_h_right", "xfade", "hrslice", "Horizontal slices from right"],
  ["slice_v_up", "xfade", "vuslice", "Vertical slices upward"], ["slice_v_down", "xfade", "vdslice", "Vertical slices downward"],
  ["squeeze_h", "xfade", "squeezeh", "Squeeze horizontally"], ["squeeze_v", "xfade", "squeezev", "Squeeze vertically"], ["wind_left", "xfade", "hlwind", "Wind left"],
  ["wind_right", "xfade", "hrwind", "Wind right"], ["cover_left", "xfade", "coverleft", "Cover from the left"], ["cover_right", "xfade", "coverright", "Cover from the right"],
  ["cover_up", "xfade", "coverup", "Cover from below"], ["cover_down", "xfade", "coverdown", "Cover from above"], ["reveal_left", "xfade", "revealleft", "Reveal to the left"],
  ["reveal_right", "xfade", "revealright", "Reveal to the right"], ["reveal_up", "xfade", "revealup", "Reveal upward"], ["reveal_down", "xfade", "revealdown", "Reveal downward"],
  ["fade_grays", "xfade", "fadegrays", "Fade through grayscale"],
];
const TRANSITIONS = new Map(T.map(([name, kind, xfade, label]) => [name, { name, kind, xfade, label }]));
export const RAMP_SECONDS = 0.3, RAMP_FACTOR = 2.5;
export const getTransition = (name: string) => TRANSITIONS.get(name) ?? TRANSITIONS.get("cut")!;
export const isOverlapping = (name: string) => getTransition(name).kind === "xfade";

/** Older FFmpeg builds lack the newer xfade transitions (cover/reveal/wind...) and refuse the whole render over one;
 * each falls back to the closest older look, and "fade" (in every build) is the last resort. */
const XFADE_FALLBACK: Record<string, string> = {
  coverleft: "slideleft", coverright: "slideright", coverup: "slideup", coverdown: "slidedown",
  revealleft: "wipeleft", revealright: "wiperight", revealup: "wipeup", revealdown: "wipedown",
  hlwind: "smoothleft", hrwind: "smoothright", vuwind: "smoothup", vdwind: "smoothdown", fadefast: "fade", fadeslow: "fade",
};

/** The transition names listed in `ffmpeg -h filter=xfade` (the lines under the "transition" option). */
export function parseXfadeHelp(out: string): Set<string> {
  const names = new Set<string>();
  let inside = false;
  for (const line of out.split(/\r?\n/)) {
    if (/^\s+transition\s+<int>/.test(line)) { inside = true; continue; }
    if (!inside) continue;
    const m = /^\s{4,}([a-z]+)\s+-?\d+\s/.exec(line);
    if (!m) break;
    names.add(m[1]);
  }
  return names;
}

let xfadeSupport: Promise<Set<string> | null> | null = null;
/** This machine's xfade transitions (asked once per process; null = could not tell, names are used as given). */
export function xfadeTransitions(): Promise<Set<string> | null> {
  xfadeSupport ??= exec(["-hide_banner", "-h", "filter=xfade"], 15000).then(({ out }) => {
    const names = parseXfadeHelp(out);
    return names.size ? names : null;
  });
  return xfadeSupport;
}

/** The xfade name to give FFmpeg: the wanted one when this build has it, else its fallback, else "fade". */
export function xfadeName(wanted: string, supported: Set<string> | null): string {
  if (!supported || supported.has(wanted)) return wanted;
  const alt = XFADE_FALLBACK[wanted];
  return alt && supported.has(alt) ? alt : "fade";
}

// ------------------------------------------------------------------ grades
const G: [string, string, string, string][] = [
  ["natural", "Natural", "true-to-life colour, any content", "eq=contrast=1.02:saturation=1.03"],
  ["clean", "Clean", "bright, crisp product and tutorial footage", "eq=contrast=1.05:brightness=0.015:saturation=1.0,unsharp=5:5:0.35"],
  ["warm", "Warm", "food, lifestyle, golden-hour, cosy moods", "colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,eq=saturation=1.08"],
  ["cinematic", "Cinematic", "story-driven, travel, dramatic moods (teal shadows, warm highlights)", "eq=contrast=1.08:saturation=0.9,colorbalance=rs=-0.03:bs=0.04:rh=0.04:bh=-0.03"],
  ["luxury", "Luxury", "jewellery, fashion, premium products: deep contrast, warm highlights, soft vignette", "eq=contrast=1.1:saturation=0.95:brightness=-0.01,colorbalance=rh=0.04:gh=0.02:bh=-0.02,vignette=angle=PI/5"],
  ["high_contrast", "High contrast", "energetic, sports, bold trending edits", "eq=contrast=1.2:saturation=1.1"],
  ["soft", "Soft", "calm, beauty, wellness: lifted and gentle", "eq=contrast=0.94:saturation=0.9:brightness=0.02"],
  ["vintage", "Vintage", "nostalgic, throwback, memories", "curves=preset=vintage"],
  ["black_white", "Black & white", "timeless, dramatic, fashion", "hue=s=0,eq=contrast=1.08"],
  ["sepia", "Sepia", "old photos, history, heritage", "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"],
  ["cool", "Cool", "tech, winter, calm blue moods", "colorbalance=rs=-0.05:bs=0.06:rm=-0.03:bm=0.04,eq=saturation=1.02"],
  ["golden_hour", "Golden hour", "sunsets, travel, romance", "colorbalance=rs=0.08:gs=0.03:bs=-0.07:rh=0.05:bh=-0.04,eq=saturation=1.1:brightness=0.02"],
  ["faded_film", "Faded film", "indie, aesthetic, lifted blacks", "lutrgb=r=val*0.86+18:g=val*0.86+18:b=val*0.86+18,eq=saturation=0.85"],
  ["noir", "Noir", "mystery, bold black and white", "hue=s=0,eq=contrast=1.35:brightness=-0.03"],
  ["neon", "Neon", "nightlife, gaming, party", "eq=contrast=1.15:saturation=1.45"],
  ["retro", "Retro", "70s look, warm and faded", "curves=preset=vintage,eq=saturation=1.1"],
  ["crisp", "Crisp", "sharp detail, products, food close-ups", "eq=contrast=1.08:saturation=1.05,unsharp=5:5:0.6"],
  ["dreamy", "Dreamy", "weddings, soft romance", "eq=contrast=0.9:brightness=0.05:saturation=1.08,colorbalance=rh=0.03:bh=0.03"],
  ["emerald", "Emerald", "nature, forest, fresh", "colorbalance=gs=0.05:gm=0.04:rs=-0.02,eq=saturation=1.05"],
  ["rose", "Rose", "beauty, fashion, soft pink", "colorbalance=rs=0.04:bs=0.03:rh=0.04,eq=saturation=0.95:brightness=0.02"],
];
const GRADES = new Map(G.map(([id, label, hint, filter]) => [id, { id, label, hint, filter }]));
const ALIASES: Record<string, string> = { teal_orange: "cinematic", film: "cinematic", moody: "cinematic", golden: "warm", vibrant: "high_contrast",
  punchy: "high_contrast", premium: "luxury", elegant: "luxury", bright: "clean", pastel: "soft", none: "natural" };
export const gradeCatalogue = () => Object.fromEntries([...GRADES.values()].map((g) => [g.id, g.hint]));
export function resolveGrade(name: string | null | undefined): string | null {
  const n = String(name ?? "").trim().toLowerCase().replace(/ /g, "_").replace(/-/g, "_");
  if (!n) return null;
  return GRADES.has(n) ? n : ALIASES[n] ?? null;
}
export const gradeFilter = (id: string | null | undefined, styleDefault: string | null) => GRADES.get(id ?? "")?.filter ?? styleDefault;

// ------------------------------------------------------------------ crop
export interface Focus { x: number; y: number; source: string }
export interface CropRegion { x: number; y: number; w: number; h: number }
const even = (v: number) => Math.max(Math.floor(Math.trunc(v) / 2) * 2, 2);
const evenOffset = (v: number) => Math.max(Math.floor(Math.trunc(v) / 2) * 2, 0);

/** Largest `aspect` (w/h) rectangle inside the source, centred as near (fx, fy) as fits. */
export function cropToAspect(srcW: number, srcH: number, aspect: number, fx: number, fy: number): CropRegion {
  fx = Math.min(Math.max(fx, 0), 1);
  fy = Math.min(Math.max(fy, 0), 1);
  if (srcW / srcH > aspect) {
    const h = even(srcH), w = Math.min(even(round(h * aspect)), even(srcW));
    return { x: evenOffset(Math.min(Math.max(fx * srcW - w / 2, 0), srcW - w)), y: 0, w, h };
  }
  const w = even(srcW), h = Math.min(even(round(w / aspect)), even(srcH));
  return { x: 0, y: evenOffset(Math.min(Math.max(fy * srcH - h / 2, 0), srcH - h)), w, h };
}

/** center | face | motion | smart (face, else damped motion, else centre). */
export function computeCrop(strategy: string, w: number, h: number, aspect: number, f: Focus): CropRegion {
  if (strategy === "center") return cropToAspect(w, h, aspect, 0.5, 0.5);
  if (strategy === "face") return ["face", "subject"].includes(f.source) ? cropToAspect(w, h, aspect, f.x, f.y) : cropToAspect(w, h, aspect, 0.5, 0.5);
  if (["motion", "face", "subject"].includes(f.source)) {
    const d = f.source === "motion" ? 0.6 : 1;
    return cropToAspect(w, h, aspect, 0.5 + d * (f.x - 0.5), 0.5 + d * (f.y - 0.5));
  }
  return cropToAspect(w, h, aspect, 0.5, 0.5);
}

// ------------------------------------------------------------------ hardware encoders
export const CPU = "libx264";
const CANDIDATES = ["h264_nvenc", "h264_videotoolbox", "h264_qsv", "h264_amf"];
export const ENCODER_LABELS: Record<string, string> = { libx264: "CPU (x264)", h264_nvenc: "NVIDIA NVENC", h264_videotoolbox: "Apple VideoToolbox", h264_qsv: "Intel Quick Sync", h264_amf: "AMD AMF" };
const works = new Map<string, Promise<boolean>>();
const exec = (args: string[], timeout: number) => new Promise<{ ok: boolean; out: string }>((r) => {
  try {
    execFile(findBinary("ffmpeg"), args, { timeout, windowsHide: true, maxBuffer: 8 << 20 }, (e, out) => r({ ok: !e, out: String(out) }));
  } catch {
    r({ ok: false, out: "" });
  }
});

/** True only if FFmpeg lists the encoder and a real test encode succeeds on this machine. */
export function encoderWorks(enc: string): Promise<boolean> {
  if (enc === CPU) return Promise.resolve(true);
  let p = works.get(enc);
  if (!p) {
    p = (async () => {
      const listed = await exec(["-hide_banner", "-encoders"], 15000);
      if (!listed.out.includes(` ${enc} `)) return false;
      return (await exec(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:size=256x256:rate=30:duration=0.2", "-c:v", enc, "-f", "null", "-"], 20000)).ok;
    })();
    works.set(enc, p);
  }
  return p;
}
export async function availableEncoders() {
  const out = [CPU];
  for (const e of CANDIDATES) if (await encoderWorks(e)) out.push(e);
  return out;
}
/** HW_ACCEL: off | auto | <encoder>. Anything unusable falls back to the CPU. */
export async function pickEncoder(setting: string = settings.hwAccel): Promise<string> {
  const c = setting.trim().toLowerCase();
  if (["", "off", "cpu", CPU].includes(c)) return CPU;
  if (c === "auto") { for (const e of CANDIDATES) if (await encoderWorks(e)) return e; return CPU; }
  if (CANDIDATES.includes(c) && (await encoderWorks(c))) return c;
  console.warn(`HW_ACCEL=${c} is not usable on this machine; using the CPU encoder`);
  return CPU;
}
export function encoderArgs(enc: string, crf: number, preset: string): string[] {
  if (enc === "h264_nvenc") return ["-c:v", enc, "-preset", "p5", "-rc", "vbr", "-cq", String(crf + 2), "-b:v", "0", "-profile:v", "high"];
  if (enc === "h264_qsv") return ["-c:v", enc, "-global_quality", String(crf + 2), "-preset", "medium", "-profile:v", "high"];
  if (enc === "h264_amf") return ["-c:v", enc, "-quality", "quality", "-rc", "cqp", "-qp_i", String(crf + 2), "-qp_p", String(crf + 2)];
  if (enc === "h264_videotoolbox") return ["-c:v", enc, "-q:v", String(Math.max(30, 90 - crf * 2)), "-profile:v", "high"];
  return ["-c:v", CPU, "-preset", preset, "-crf", String(crf), "-profile:v", "high", "-level", "4.2"];
}

// ------------------------------------------------------------------ audio graphs
export const AUDIO_MODES = ["music", "voice_music", "voice", "original", "none"] as const;
export const STEREO = "aresample=48000,aformat=channel_layouts=stereo";
const SFX_LEVEL = 0.8;

/** atempo only accepts 0.5..2.0 per stage; chain stages for slower / faster speeds. */
export function atempoChain(speed: number): string {
  const stages: number[] = [];
  let s = speed;
  while (s < 0.5 - 1e-9) { stages.push(0.5); s /= 0.5; }
  while (s > 2.0 + 1e-9) { stages.push(2.0); s /= 2.0; }
  stages.push(round(s, 4));
  return stages.map((x) => `atempo=${pyf(x)}`).join(",");
}

export function musicChain(duration: number, style: EditingStyle, volume: number, fadeIn: number | null, fadeOut: number | null): string {
  const fi = Math.min(fadeIn ?? style.audioFadeIn, duration / 4), fo = Math.min(fadeOut ?? style.audioFadeOut, duration / 3);
  return `afade=t=in:st=0:d=${fixed(fi, 3)},afade=t=out:st=${fixed(Math.max(duration - fo, 0), 3)}:d=${fixed(fo, 3)},volume=${fixed(volume, 3)},${STEREO}`;
}

/** The voice, delayed to its start and padded to the full Reel (so the mixer never ends early). */
export function voiceChain(voice: VoiceTrack, duration: number): string {
  const ms = round(voice.start * 1000);
  return `volume=${fixed(voice.volume, 3)},${STEREO},adelay=${ms}|${ms},apad=whole_dur=${fixed(duration, 3)}`;
}

export const finishChain = (duration: number, lufs: number) => `loudnorm=I=${lufs}:TP=-1.5:LRA=11,${STEREO},apad=whole_dur=${fixed(duration, 3)}`;

/** Each shot's own audio joined like the video (crossfade where the picture dissolves). */
export function originalAudioGraph(segments: Segment[]): string {
  const parts = segments.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
  let cur = "[a0]";
  for (let i = 1; i < segments.length; i++) {
    const t = segments[i].transitionIn;
    const label = `[aj${i}]`;
    parts.push(getTransition(t.type).kind === "xfade" && t.duration > 0 ? `${cur}[a${i}]acrossfade=d=${fixed(t.duration, 3)}:c1=tri:c2=tri${label}` : `${cur}[a${i}]concat=n=2:v=0:a=1${label}`);
    cur = label;
  }
  parts.push(`${cur}anull[orig]`);
  return parts.join(";");
}

export interface AudioGraphIn {
  mode: string; musicIdx: number | null; voiceIdx: number | null; segments: Segment[]; duration: number; style: EditingStyle; lufs: number;
  voice: VoiceTrack | null; musicVolume?: number; fadeIn?: number | null; fadeOut?: number | null; sfxIdx?: number | null;
}

function graph(a: AudioGraphIn): string | null {
  const fin = finishChain(a.duration, a.lufs);
  if (a.mode === "none") return null;
  if (a.mode === "original") return `${originalAudioGraph(a.segments)};[orig]${fin}[a]`;
  const hasVoice = ["voice", "voice_music"].includes(a.mode) && a.voice !== null && a.voiceIdx !== null;
  const hasMusic = ["music", "voice_music"].includes(a.mode) && a.musicIdx !== null;
  const mus = () => musicChain(a.duration, a.style, a.musicVolume ?? 1, a.fadeIn ?? null, a.fadeOut ?? null);
  if (hasVoice && hasMusic) {
    let g = `[${a.musicIdx}:a]${mus()}[mus];[${a.voiceIdx}:a]${voiceChain(a.voice!, a.duration)}[vo];`;
    g += a.voice!.duckMusic
      ? "[vo]asplit=2[vsc][vmx];[mus][vsc]sidechaincompress=threshold=0.04:ratio=9:attack=20:release=500:makeup=1[duck];[duck][vmx]amix=inputs=2:duration=longest:normalize=0[mix];"
      : "[mus][vo]amix=inputs=2:duration=longest:normalize=0[mix];";
    return g + `[mix]${fin}[a]`;
  }
  if (hasVoice) return `[${a.voiceIdx}:a]${voiceChain(a.voice!, a.duration)},${fin}[a]`;
  if (hasMusic) return `[${a.musicIdx}:a]${mus()},${fin}[a]`;
  return null;
}

/** The audio graph ending in [a] (null = no audio); a sound-effects track is mixed in before loudness normalising. */
export function buildAudioGraph(a: AudioGraphIn): string | null {
  const g = graph(a);
  if (g === null || a.sfxIdx === null || a.sfxIdx === undefined) return g;
  const fin = finishChain(a.duration, a.lufs);
  let head = g.slice(0, -`${fin}[a]`.length).replace(/,+$/, "");
  if (head.endsWith("]")) head += "anull";
  return `${head}[pre];[${a.sfxIdx}:a]${STEREO},volume=${pyf(SFX_LEVEL)}[fx];[pre][fx]amix=inputs=2:duration=first:normalize=0,${fin}[a]`;
}
