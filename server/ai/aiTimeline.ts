import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { analyzeMusic } from "@/server/audio/analyzer";
import { videoShape, type AnalysisDoc } from "@/server/audio/analysisJson";
import { db, parseId } from "@/server/core/db";
import { NotFoundError, ValidationFailed } from "@/server/core/errors";
import { g, round } from "@/server/core/py";
import { describePace, paceFor } from "@/server/director/paceRules";
import { songHits } from "@/server/director/musicMap";
import { projectKey } from "@/server/media/service";
import type { AudioAnalysis } from "@/server/models/analysis";
import type { ClipInput } from "@/server/models/clip";
import { Timeline as TimelineSchema, type Keyframe, type Timeline } from "@/server/models/timeline";
import { getProjectDoc } from "@/server/projects/service";
import { ProjectSettings } from "@/server/projects/settings";
import { projectSong, songDocument } from "@/server/services/music";
import { localPath } from "@/server/storage/local";
import * as kf from "@/server/video/keyframes";
import { clipInputs, projectVideos } from "@/server/video/clips";
import { rankMusicWindows } from "@/server/video/timeline";
import { clipFacts, pickFootage } from "./director";
import { getProvider } from "./index";
import { runStructured } from "./types";

/** Music-first editing (were director/ai_timeline.py and services/music_reel.py): the AI plans the Reel's timeline
 * from the song analysis, the answer is checked into a playable timeline (cuts on beats or events, real footage, no
 * repeats), saved under a plan id, and can be rendered. */

const VERSION = 1, SNAP_SURE = 0.15, SNAP_UNSURE = 0.04, ON_EVENT = 0.03, MIN_SPEED = 0.5, MAX_SPEED = 2, MAX_TRANSITION = 0.6, QUICK_ZOOM = 0.4;
const SHOW_EVENTS = ["STRONG_BEAT", "MUSIC_DROP", "BUILD_UP", "ROLL", "FILL", "IMPACT", "ENERGY_RISE", "ENERGY_DROP", "SILENCE", "PHRASE_END", "VOCAL_ENTRY", "VOCAL_PAUSE", "REVERB_TAIL", "TEMPO_CHANGE"];
export const EFFECTS: Record<string, [string, string]> = {
  ZOOM_IN: ["zoom_in", "slow push in over the shot (with duration <= 0.4 s: a quick punch-in)"], ZOOM_OUT: ["zoom_out", "slow pull out over the shot"], PUNCH_ZOOM: ["punch", "a quick punch-in on the hit"],
  CRASH_ZOOM: ["crash_zoom", "a fast snap zoom: for a drop"], PULSE: ["zoom_pulse", "a soft pulse on the beats the shot holds"], BEAT_PUNCH: ["beat_punch", "a punch on every strong hit inside the shot"],
  STUTTER: ["beat_stutter", "quick punches on a fast roll"], FLASH: ["flash", "a white flash on a hard hit (put it at the hit's offset)"], SHAKE: ["shake", "handheld energy"],
  KEN_BURNS: ["ken_burns", "a slow drift: calm parts"], ROLL: ["roll", "a gentle rotation sway"], GLOW: ["glow", "highlights bloom: dreamy, luxury"], BLACK_WHITE: ["black_white", "black and white"], VIGNETTE: ["vignette", "darker edges"],
};
const LOOK_EFFECTS = ["GLOW", "BLACK_WHITE", "VIGNETTE"], KEYED_EFFECTS = ["ZOOM_IN", "ZOOM_OUT", "PUNCH_ZOOM", "CRASH_ZOOM", "KEN_BURNS", "FLASH"], EASES = ["linear", "ease_in", "ease_out", "ease_in_out", "hold"];
export const TRANSITIONS: Record<string, [string, string]> = {
  HARD_CUT: ["cut", "an instant cut on the beat (most cuts)"], FLASH: ["flash", "a white flash: drops, impacts"], CROSSFADE: ["dissolve", "a soft blend: calm parts"], FADE: ["fade", "through black: openings, endings"],
  ZOOM: ["zoom", "zoom through: energy"], WHIP_LEFT: ["slide_left", "a fast push to the left"], WHIP_RIGHT: ["slide_right", "a fast push to the right"], SLIDE_DOWN: ["slide_down", "the next shot slides down"],
  COVER_UP: ["cover_up", "the next shot covers from below"], WIPE_LEFT: ["wipe_left", "a wipe"], WIPE_RIGHT: ["wipe_right", "a wipe"], CIRCLE_OPEN: ["circle_open", "an iris opening: reveals"],
  BLUR: ["blur", "focus pull through blur"], GLITCH: ["pixelize", "a digital glitch"], SPEED_RAMP: ["speed_ramp", "the shot speeds up into the cut"],
};

const optN = z.number().nullable().default(null);
const AIEffect = z.object({ type: z.string(), start_offset_sec: z.number().default(0), duration_sec: z.number().default(0.2) });
const AITransition = z.object({ type: z.string().default("HARD_CUT"), duration_sec: z.number().default(0) });
const AIKeyframe = z.object({ t: z.number(), zoom: optN, x: optN, y: optN, rotation: optN, opacity: optN, blur: optN, brightness: optN, speed: optN, ease: z.string().default("linear") });
const AIShot = z.object({ timeline_start_sec: z.number(), timeline_end_sec: z.number(), clip_id: z.string(), source_start_sec: z.number(), source_end_sec: z.number(), speed: z.number().default(1),
  effects: z.array(AIEffect).default([]), keyframes: z.array(AIKeyframe).default([]), transition_out: AITransition.nullable().default(null), why: z.string().default("") });
export const AITimeline = z.object({ timeline: z.array(AIShot).min(1) });
type AIShot = z.infer<typeof AIShot>;
type AIKeyframe = z.infer<typeof AIKeyframe>;
type AITimeline = z.infer<typeof AITimeline>;
type Music = Record<string, unknown> & { reel_seconds: number; beats: { t: number; confidence?: number | null }[]; events: Record<string, number | string>[] };

const SYSTEM = "You are a professional short-video editor. You cut Reels to music: every cut lands on a beat or a musical event from the analysis, the energy of the edit follows the song, and footage is used only from the clips' good parts. Reply with JSON only.";

/** The song analysis cut down to the part the Reel plays, in Reel time. */
export function musicForReel(doc: Record<string, unknown>, start: number, duration: number): Music {
  const end = start + duration, rel = (t: number | null | undefined) => (t === null || t === undefined ? null : round(t - start, 3));
  const inside = (t: number | null | undefined, a?: number | null, b?: number | null) => (t !== null && t !== undefined ? start <= t && t <= end : a !== null && a !== undefined && b !== null && b !== undefined && b >= start && a <= end);
  const beats = ((doc.beats as Record<string, unknown>[]) ?? []).filter((b) => inside(b.time_sec as number)).map((b) => ({ t: rel(b.time_sec as number)!, strength: b.strength, confidence: (b.confidence as number | null) ?? null, ...(b.downbeat ? { downbeat: true } : {}) }));
  const events: Record<string, number | string>[] = [];
  for (const e of (doc.candidate_events as Record<string, unknown>[]) ?? []) {
    if (!SHOW_EVENTS.includes(e.type as string) || !inside(e.time_sec as number | null, e.start_sec as number | null, e.end_sec as number | null)) continue;
    const row: Record<string, number | string> = { type: e.type as string, confidence: e.confidence as number };
    if (e.time_sec !== null && e.time_sec !== undefined) row.t = rel(e.time_sec as number)!;
    else { row.start = Math.max(rel(e.start_sec as number) ?? 0, 0); row.end = Math.min(rel(e.end_sec as number) ?? duration, duration); }
    events.push(row);
  }
  const tempo = doc.tempo as Record<string, unknown>, ec = doc.energy_curve as { sample_interval_sec: number; values: number[] }, step = ec.sample_interval_sec, values = ec.values;
  const energy: number[] = [];
  for (let k = Math.trunc(start / step); k < Math.min(Math.trunc(end / step) + 1, values.length); k += Math.max(Math.trunc(0.5 / step), 1)) energy.push(values[k]);
  return {
    reel_seconds: duration, song_starts_at_sec: round(start, 3), bpm: tempo.bpm, beat_interval_sec: tempo.beat_interval_sec,
    tempo_sections: ((tempo.sections as Record<string, number>[]) ?? []).filter((s) => s.end_sec >= start && s.start_sec <= end).map((s) => ({ start: Math.max(rel(s.start_sec) || 0, 0), end: Math.min(rel(s.end_sec) || duration, duration), bpm: s.bpm })),
    sections: ((doc.sections as Record<string, unknown>[]) ?? []).filter((s) => (s.end_sec as number) >= start && (s.start_sec as number) <= end).map((s) => ({ type: s.type, energy_level: s.energy_level, start: Math.max(rel(s.start_sec as number) || 0, 0), end: Math.min(rel(s.end_sec as number) || duration, duration) })),
    energy_every_half_second: energy, beats, events,
  };
}

export function clipsForAi(clips: ClipInput[]): [Record<string, unknown>[], Record<string, string>] {
  const [rows, alias] = clipFacts(clips), back: Record<string, string> = {};
  const out = rows.map((row, k) => { const name = `clip_${String(k + 1).padStart(2, "0")}`; back[name] = alias[row.clip as string]; return { ...row, clip: name }; });
  return [out, back];
}

function request(music: Music, clips: Record<string, unknown>[], minClip: number, brief: string): string {
  const rules = [
    `The timeline covers exactly 0 to ${music.reel_seconds} s: shots back to back, the first starting at 0, the last ending at ${music.reel_seconds}.`,
    "Every cut (a shot's timeline_end_sec) lands on a beat time or an event time from the music. Put important cuts (the drop, a new section, a hero shot) on beats with high confidence or on downbeats; a beat with low confidence is a weak place for a cut.",
    `No shot is shorter than ${minClip} s. Follow the pace rules: how far apart the beats are sets how often to cut and how often to use a transition.`,
    "source_end_sec - source_start_sec = (timeline_end_sec - timeline_start_sec) * speed, inside ONE usable window of that clip.",
    "Never show the same moment of a clip twice. speed 1.0 normally; 0.5-0.8 for slow motion in calm parts; up to 2.0 to speed up.",
    "MUSIC_DROP: a hero shot with CRASH_ZOOM or FLASH, entered with a FLASH transition. STRONG_BEAT / IMPACT: PUNCH_ZOOM or a whip.",
    "Most transitions are HARD_CUT (see the pace rules for how often a smooth one fits). Transition duration 0 for HARD_CUT, otherwise at most the pace's max_transition_sec and 40% of the shot.",
    "effects: start_offset_sec is seconds into the shot (put a FLASH or PUNCH_ZOOM on a hit inside it); duration_sec how long it lasts.",
    "The last shot's transition_out is null. Open with the strongest hook shot, end on a satisfying shot.",
    "keyframes animate a shot (optional, but use them to give every shot life). t = seconds into the shot; each property moves from one keyframe that sets it to the next, with the later keyframe's ease. Ranges: zoom 1-3 (1 = framed), x / y -1..1 (where the zoomed window sits; 0 = centre), rotation -20..20 degrees (keep it under 4 for taste), opacity 0-1 (0 = black), blur 0-1, brightness -0.5..0.5 (0.4 = a flash). ease: linear, ease_in, ease_out, ease_in_out, hold.",
    "Keyframe ideas: a slow push-in through a calm shot (zoom 1.0 at 0 -> 1.08 at the end, ease_in_out); a punch on a beat inside the shot (zoom 1.12 at the beat's time minus the shot start, back to 1.0 0.25 s later, ease_out); a pan across a wide shot (x -0.8 -> 0.8, with zoom 1.15); a flash on a hit (brightness 0.4 at the hit, 0 0.2 s later); fade the last shot out (opacity 1 -> 0 over its last 0.5 s). Beats inside a shot: beats with t between the shot's start and end.",
    "GLOW, BLACK_WHITE and VIGNETTE are colour looks: they combine with any movement.",
    "Speed ramps: a keyframe 'speed' (0.25-4) remaps time inside the shot and the footage follows it (leave speed at 1 and source times consistent; the check recomputes the footage a ramp needs). Ideas synced to the music: slow (0.6) accelerating to 2.0 right into a MUSIC_DROP cut (ease_in); slow motion (0.35) on a big hit inside a shot and back to 1.0; fast (2.0) off a drop settling to 1.0 within 0.5 s. Use ramps on 1-3 key moments, not every shot.",
  ];
  return JSON.stringify({
    music, clips, rules, pace_rules: describePace(Number(music.beat_interval_sec) || 0.5), effects: Object.fromEntries(Object.entries(EFFECTS).map(([k, v]) => [k, v[1]])),
    transitions: Object.fromEntries(Object.entries(TRANSITIONS).map(([k, v]) => [k, v[1]])), instructions: brief || "(none)",
    answer: { timeline: [{ timeline_start_sec: 0.0, timeline_end_sec: 0.0, clip_id: "clip_01", source_start_sec: 0.0, source_end_sec: 0.0, speed: 1.0, effects: [{ type: "ZOOM_IN", start_offset_sec: 0, duration_sec: 0.2 }],
      keyframes: [{ t: 0.0, zoom: 1.0 }, { t: 0.43, zoom: 1.12, ease: "ease_out" }, { t: 0.68, zoom: 1.0 }], transition_out: { type: "HARD_CUT", duration_sec: 0 }, why: "short reason" }] },
  });
}

const toKeyframe = (k: AIKeyframe) => ({ t: k.t, ease: k.ease, zoom: k.zoom, x: k.x, y: k.y, rotation: k.rotation, opacity: k.opacity, blur: k.blur, brightness: k.brightness, speed: k.speed }) as unknown as Keyframe;
function checkKeyframes(raw: AIKeyframe[], length: number, where: string, notes: string[]): AIKeyframe[] {
  const fixed = raw.map((k) => { const ease = EASES.includes(k.ease) ? k.ease : "linear"; if (ease !== k.ease) notes.push(`${where}: unknown ease '${k.ease}' -> linear`); return toKeyframe({ ...k, ease }); });
  const [good, why] = kf.validate(fixed, length);
  notes.push(...why.map((w) => `${where}: ${w}`));
  return good.map((k) => AIKeyframe.parse(Object.fromEntries(Object.entries(k).filter(([, v]) => v !== null && v !== undefined))));
}
const rampSpeed = (keyframes: AIKeyframe[], length: number) => { const kfs = keyframes.map(toKeyframe); return kf.hasSpeed(kfs) ? round(kf.averageSpeed(kfs, length), 4) : null; };

/** A playable timeline from the AI's answer, and what had to change. */
export function check(plan: AITimeline, music: Music, clips: ClipInput[], alias: Record<string, string>, minClip: number): [AITimeline, string[]] {
  const duration = Number(music.reel_seconds), pace = paceFor(Number(music.beat_interval_sec) || 0.5), longest = pace.maxTransition || 0.15, notes: string[] = [];
  const events = [...new Set([...music.events.filter((e) => "t" in e).map((e) => e.t as number), ...music.events.flatMap((e) => [e.start, e.end].filter((x) => x !== undefined && x !== null) as number[])])].sort((a, b) => a - b);
  const beats = music.beats.map((b) => [b.t, b.confidence === null || b.confidence === undefined ? 0.6 : Number(b.confidence)] as [number, number]);
  const snap = (t: number) => {
    const ev = events.length ? events.reduce((a, p) => (Math.abs(p - t) < Math.abs(a - t) ? p : a)) : null;
    if (ev !== null && Math.abs(ev - t) <= ON_EVENT) return ev;
    let best = t, score = 1;
    for (const [b, conf] of beats) { const reach = SNAP_UNSURE + (SNAP_SURE - SNAP_UNSURE) * Math.min(Math.max(conf, 0), 1); if (Math.abs(b - t) / reach <= score) { best = b; score = Math.abs(b - t) / reach; } }
    return best;
  };
  const byId = new Map(clips.map((c) => [c.clipId, c])), shots = [...plan.timeline].sort((a, b) => a.timeline_start_sec - b.timeline_start_sec), chosen: AIShot[] = [], cuts: number[] = [];
  for (const s of shots.slice(0, -1)) {
    const t = snap(s.timeline_end_sec), prev = cuts.length ? cuts[cuts.length - 1] : 0;
    if (t - prev < minClip || duration - t < minClip) { notes.push(`the shot ending at ${s.timeline_end_sec.toFixed(2)} s would be under ${minClip} s: left out, the next shot takes its time`); continue; }
    chosen.push(s); cuts.push(round(t, 3));
  }
  chosen.push(shots[shots.length - 1]);
  const bounds = [0, ...cuts, duration];
  if (Math.abs(shots[shots.length - 1].timeline_end_sec - duration) > 0.05) notes.push(`the timeline ended at ${shots[shots.length - 1].timeline_end_sec.toFixed(2)} s: set to the Reel's ${g(duration)} s`);
  const used = new Map<string, [number, number][]>(clips.map((c) => [c.clipId, []])), uses = new Map<string, number>(), out: AIShot[] = [];
  chosen.forEach((s, k) => {
    const a = bounds[k], b = bounds[k + 1], length = b - a;
    let real = alias[s.clip_id];
    if (!byId.has(real)) {
      real = [...byId.keys()].reduce((x, i) => ((uses.get(i) ?? 0) < (uses.get(x) ?? 0) || ((uses.get(i) ?? 0) === (uses.get(x) ?? 0) && byId.get(i)!.analysis.qualityScore > byId.get(x)!.analysis.qualityScore) ? i : x));
      notes.push(`shot ${k + 1}: unknown clip '${s.clip_id}', used ${Object.keys(alias).find((n) => alias[n] === real)}`);
    }
    const keyframes = checkKeyframes(s.keyframes, length, `shot ${k + 1}`, notes), ramp = rampSpeed(keyframes, length);
    let speed = ramp ?? Math.min(Math.max(s.speed || 1, MIN_SPEED), MAX_SPEED);
    if (ramp === null && Math.abs(speed - (s.speed || 1)) > 1e-6) notes.push(`shot ${k + 1}: speed ${s.speed} -> ${speed}`);
    const [clip, srcA, srcB, sp, why] = pickFootage(byId.get(real)!, s.source_start_sec, length, speed, used, clips, uses);
    speed = sp;
    notes.push(...why.map((w) => `shot ${k + 1}: ${w}`));
    used.get(clip.clipId)!.push([srcA, srcB]);
    uses.set(clip.clipId, (uses.get(clip.clipId) ?? 0) + 1);
    const name = Object.keys(alias).find((n) => alias[n] === clip.clipId) ?? s.clip_id;
    const effects = s.effects.flatMap((e) => {
      const kind = e.type.trim().toUpperCase();
      if (!(kind in EFFECTS)) { notes.push(`shot ${k + 1}: unknown effect '${e.type}' left out`); return []; }
      const off = Math.min(Math.max(e.start_offset_sec, 0), Math.max(length - 0.05, 0));
      return [{ type: kind, start_offset_sec: round(off, 3), duration_sec: round(Math.min(Math.max(e.duration_sec, 0.05), length - off), 3) }];
    });
    let tr = null;
    if (k < chosen.length - 1) {
      const raw = s.transition_out ?? { type: "HARD_CUT", duration_sec: 0 };
      let kind = raw.type.trim().toUpperCase();
      if (!(kind in TRANSITIONS)) { notes.push(`shot ${k + 1}: unknown transition '${raw.type}' -> HARD_CUT`); kind = "HARD_CUT"; }
      const nxt = bounds[k + 2] - bounds[k + 1];
      const dur = kind === "HARD_CUT" ? 0 : round(Math.min(Math.max(raw.duration_sec, 0.1), MAX_TRANSITION, longest, 0.4 * Math.min(length, nxt)), 3);
      if (kind !== "HARD_CUT" && raw.duration_sec > dur + 0.02) notes.push(`shot ${k + 1}: ${kind} ${g(raw.duration_sec)} s -> ${g(dur)} s (the ${pace.name} pace allows ${g(longest)} s)`);
      tr = { type: kind, duration_sec: dur };
    }
    out.push({ timeline_start_sec: round(a, 3), timeline_end_sec: round(b, 3), clip_id: name, source_start_sec: srcA, source_end_sec: srcB, speed: round(speed, 3), effects, keyframes, transition_out: tr, why: s.why.slice(0, 120) });
  });
  return [{ timeline: out }, notes];
}

const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v);
const cacheKey = (music: Music, clips: Record<string, unknown>[], minClip: number, brief: string, model: string) => crypto.createHash("sha1").update(JSON.stringify(sortKeys({ m: music, c: clips, min: minClip, b: brief, model, v: VERSION }))).digest("hex").slice(0, 24);

export async function planTimeline(doc: AnalysisDoc, clips: ClipInput[], start: number, duration: number, minClip: number, brief: string, cache: [(k: string) => Record<string, unknown> | null, (k: string, v: Record<string, unknown>) => void] | null) {
  if (doc.status !== "completed") throw new ValidationFailed("The song analysis failed: " + ((doc.errors as string[]) ?? ["unknown reason"]).join("; "), { code: "ANALYSIS_FAILED" });
  const shaped = ("schema_version" in doc ? doc : videoShape(doc)) as unknown as Record<string, unknown>;
  const music = musicForReel(shaped, start, duration), [rows, alias] = clipsForAi(clips);
  if (!rows.length) throw new ValidationFailed("None of the clips has usable footage.", { code: "NO_USABLE_CLIPS" });
  const provider = getProvider("director"), key = cacheKey(music, rows, minClip, brief, provider.model);
  const hit = cache?.[0](key);
  if (hit) return { ...hit, cached: true };
  const [answer, res] = await runStructured(provider, { system: SYSTEM, user: request(music, rows, minClip, brief), temperature: 0, task: "director", maxOutputTokens: 16000 }, AITimeline);
  const [checked, notes] = check(answer, music, clips, alias, minClip);
  const out = { ...checked, notes, provider: res.provider, model: res.model };
  cache?.[1](key, out);
  return { ...out, cached: false };
}

const PRESET_OF: Record<string, string> = { ZOOM_IN: "zoom_in", ZOOM_OUT: "zoom_out", PUNCH_ZOOM: "punch", CRASH_ZOOM: "crash_zoom", KEN_BURNS: "ken_burns", FLASH: "flash" };
function shotAnimation(shot: AIShot): [string, Keyframe[], string[], string[]] {
  const length = shot.timeline_end_sec - shot.timeline_start_sec, notes: string[] = [], looks: string[] = [], effectKfs: Keyframe[] = [];
  let procedural = "none";
  for (const e of [...shot.effects].sort((a, b) => a.start_offset_sec - b.start_offset_sec)) {
    if (LOOK_EFFECTS.includes(e.type)) looks.push(EFFECTS[e.type][0]);
    else if (KEYED_EFFECTS.includes(e.type)) {
      let name = PRESET_OF[e.type];
      if (e.type === "ZOOM_IN" && e.duration_sec <= QUICK_ZOOM) name = "punch";
      const span = Math.max(Math.min(["zoom_in", "zoom_out", "ken_burns"].includes(name) ? e.duration_sec : length, length - e.start_offset_sec), 0.1);
      effectKfs.push(...kf.preset(name, span).map((k) => ({ ...k, t: round(k.t + e.start_offset_sec, 4) })));
    } else if (procedural === "none") {
      procedural = EFFECTS[e.type][0];
      if (e.start_offset_sec > 0.15) notes.push(`${e.type} drives the whole shot (it follows the beats / wobbles from the start)`);
    } else notes.push(`${e.type} left out: one beat-reactive / wobbling effect per shot (${procedural} kept)`);
  }
  const own = shot.keyframes.map(toKeyframe), sorted = [...effectKfs].sort((a, b) => a.t - b.t);
  const [keyframes, why] = kf.validate(own.length ? kf.merge(sorted, own) : sorted, length);
  return [procedural, keyframes, [...new Set(looks)], [...notes, ...why]];
}

export function toTimeline(plan: AITimeline, alias: Record<string, string>, clips: ClipInput[], audio: AudioAnalysis | null, audioStart: number, style = "fast_trending"): [Timeline, string[]] {
  const names = new Map(clips.map((c) => [c.clipId, c.name])), notes: string[] = [], segments: Record<string, unknown>[] = [];
  let wayIn = { type: "cut", duration: 0 };
  plan.timeline.forEach((shot, k) => {
    const real = alias[shot.clip_id] ?? shot.clip_id, [effect, keyframes, looks, why] = shotAnimation(shot);
    notes.push(...why.map((w) => `shot ${k + 1}: ${w}`));
    const speed = kf.hasSpeed(keyframes) ? round(kf.averageSpeed(keyframes, shot.timeline_end_sec - shot.timeline_start_sec), 4) : shot.speed;
    segments.push({ clipId: real, video: names.get(real) ?? real, sourceStart: round(shot.source_start_sec, 3), sourceEnd: round(shot.source_end_sec, 3), timelineStart: round(shot.timeline_start_sec, 3),
      timelineEnd: round(shot.timeline_end_sec, 3), speed, effect, keyframes, looks, transitionIn: wayIn, reason: shot.why || null, locked: true });
    const o = shot.transition_out;
    wayIn = o && o.type in TRANSITIONS ? { type: TRANSITIONS[o.type][0], duration: o.duration_sec } : { type: "cut", duration: 0 };
  });
  const tl = TimelineSchema.parse({ duration: round(plan.timeline[plan.timeline.length - 1].timeline_end_sec, 3), bpm: audio?.bpm ?? 0, audioStart: round(audioStart, 3), style, segments,
    musicHits: audio ? songHits(audio) : [], notes: ["Edited by the AI from the song analysis (director/ai_timeline.py).", ...notes] });
  return [tl, notes];
}

// ------------------------------------------------------------------ the music-first service (services/music_reel.py)
const planKey = (pid: string, id: string) => projectKey(pid, "analysis", `ai_timeline_${id}.json`);
const readJson = (key: string) => { try { return JSON.parse(fs.readFileSync(localPath(key), "utf8")); } catch { return null; } };

async function inputs(projectId: string) {
  const { doc, audio } = await projectSong(projectId), { projectId: pid, videos } = await projectVideos(projectId);
  return { doc, audio, pid, videos, clips: await clipInputs(pid, videos), analysis: await analyzeMusic(pid, { id: audio.id, key: audio.key }), song: await songDocument(audio.key, 10) };
}

/** The AI's checked timeline for this project, with its plan id (the same inputs give the same plan, saved). */
export async function makePlan(projectId: string, o: { duration: number | null; start: number | null; minClip: number; brief: string | null; refresh: boolean }) {
  const x = await inputs(projectId), s = ProjectSettings.parse(x.doc.settings ?? {}), duration = o.duration ?? s.duration;
  let start = o.start ?? s.audioStart;
  if (start === null || start === undefined) { const best = rankMusicWindows(x.analysis, duration, 1); start = best.length ? best[0].start : 0; }
  const saved: { id?: string } = {};
  const load = (k: string) => { saved.id = k; return o.refresh ? null : readJson(planKey(x.pid, k)); };
  const save = (k: string, v: Record<string, unknown>) => { saved.id = k; const f = localPath(planKey(x.pid, k)); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ ...v, song_start_sec: round(start!, 3) })); };
  const out = await planTimeline(x.song, x.clips, start, duration, o.minClip, o.brief ?? s.brief, [load, save]);
  return { plan_id: saved.id ?? null, song_start_sec: round(start, 3), duration_sec: duration, min_clip_sec: o.minClip, ...out };
}

/** Save the checked plan as the project's timeline (it opens in the editor too) and start rendering it. */
export async function renderPlan(projectId: string, planId: string | null, timeline: unknown[] | null, quality: string, minClip: number) {
  if (!planId && !timeline) throw new ValidationFailed("Send a plan_id (from /api/v1/reels/plan) or a timeline.", { code: "NO_PLAN" });
  const x = await inputs(projectId);
  let plan: Record<string, unknown>;
  if (planId) {
    if (!/^[A-Za-z0-9]+$/.test(planId) || planId.length > 64) throw new ValidationFailed("Not a plan id.", { code: "BAD_PLAN_ID" });
    plan = readJson(planKey(x.pid, planId));
    if (!plan) throw new NotFoundError("No such plan for this project: make one with /api/v1/reels/plan.", { code: "PLAN_NOT_FOUND" });
  } else plan = { timeline, song_start_sec: (x.doc.settings as Record<string, unknown>)?.audioStart ?? 0 };
  if (timeline) plan = { ...plan, timeline };
  const start = Number(plan.song_start_sec ?? 0), parsed = AITimeline.parse({ timeline: plan.timeline }), duration = parsed.timeline[parsed.timeline.length - 1].timeline_end_sec;
  const music = musicForReel(videoShape(x.song) as Record<string, unknown>, start, duration), [, alias] = clipsForAi(x.clips);
  const [checked, notes] = check(parsed, music, x.clips, alias, minClip), [tl, more] = toTimeline(checked, alias, x.clips, x.analysis, start);
  await (await db()).collection("projects").updateOne({ _id: x.doc._id }, { $set: { timeline: JSON.parse(JSON.stringify(tl)), "settings.audioStart": tl.audioStart, "settings.duration": tl.duration, updatedAt: new Date() } });
  const { submitRender } = await import("@/server/jobs/manager");
  const job = await submitRender(projectId, quality, "AI plan");
  return { reel_id: String(job._id), project_id: projectId, status: job.status, plan_id: planId, segments: tl.segments.length, notes: [...notes, ...more] };
}

export async function reelStatus(reelId: string) {
  const d = await db(), job = await d.collection("jobs").findOne({ _id: parseId(reelId) });
  if (!job) throw new NotFoundError("No such reel.", { code: "REEL_NOT_FOUND" });
  const pid = String(job.projectId);
  const out: Record<string, unknown> = { reel_id: reelId, project_id: pid, status: job.status, progress: job.progress ?? 0, stage: job.stage ?? null, error: job.error ?? null, result_url: null };
  if (job.status === "completed" && job.renderingId) {
    const rid = String(job.renderingId);
    Object.assign(out, { rendering_id: rid, result_url: `/api/projects/${pid}/renderings/${rid}/file`, download_url: `/api/projects/${pid}/renderings/${rid}/file?download=true`,
      check: ((await d.collection("renderings").findOne({ _id: job.renderingId }, { projection: { check: 1 } })) as Record<string, unknown> | null)?.check ?? null });
  }
  return out;
}
export { getProjectDoc };
