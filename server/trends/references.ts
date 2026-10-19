import "server-only";
import fs from "node:fs";
import { moveFile } from "@/server/storage/local";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getProvider } from "@/server/ai";
import { Text } from "@/server/ai/text";
import { analyzeAudio } from "@/server/audio/analyzer";
import { db, parseId } from "@/server/core/db";
import { AppError, NotFoundError, UnsupportedMedia, ValidationFailed } from "@/server/core/errors";
import { findBinary, probe, renderFfmpeg, run } from "@/server/core/ffmpeg";
import { round } from "@/server/core/py";
import { buildMusicMap, loudLimit, snapPoints } from "@/server/director/musicMap";
import { sanitizeFilename, VIDEO_EXTS } from "@/server/media/service";
import { readUpload, type UploadedFile } from "@/server/media/upload";
import { parseVideoProbe } from "@/server/media/probe";
import type { AudioAnalysis } from "@/server/models/analysis";

/** Learned trends (were trends/reference.py, trends/learn.py, api/references.py): reference Reels the person uploads
 * are measured - cuts, shot lengths, beat sync, look, an AI description - and only the numbers are kept. */

const SCENE_THRESHOLD = 0.32, SOFT_SCENE_THRESHOLD = 0.16, MIN_GAP = 0.2, ON_BEAT = 0.1, MAX_SECONDS = 180, MAX_FILES = 6, MAX_BYTES = 300 * 1024 * 1024, MAX_VIDEOS = 200;
type Prof = Record<string, unknown>;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** Frame-accurate cut times from FFmpeg's scene score. */
async function detectCuts(file: string, duration: number, threshold = SCENE_THRESHOLD): Promise<number[]> {
  let log = "";
  try { log = (await run(findBinary("ffmpeg"), ["-hide_banner", "-nostats", "-t", String(MAX_SECONDS), "-i", file, "-an", "-vf", `scale=320:-2,select='gt(scene,${threshold})',showinfo`, "-f", "null", "-"], 600_000)).stderr; }
  catch (e) { log = String((e as AppError).details ?? ""); }
  const cuts: number[] = [];
  for (const t of [...log.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b)) if (t > 0.1 && t < duration - 0.1 && (!cuts.length || t - cuts[cuts.length - 1] >= MIN_GAP)) cuts.push(round(t, 3));
  return cuts;
}
async function frameAt(file: string, t: number, width = 360): Promise<Buffer | null> {
  try {
    const tmp = path.join(os.tmpdir(), `ref_${process.pid}_${Math.random().toString(36).slice(2)}.jpg`);
    await run(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", tmp], 60_000);
    const b = fs.readFileSync(tmp);
    fs.rmSync(tmp, { force: true });
    return b;
  } catch { return null; }
}
async function lookOf(frames: Buffer[]) {
  if (!frames.length) return {};
  const sharp = (await import("sharp")).default, v: number[] = [], s: number[] = [];
  for (const f of frames) {
    const { data } = await sharp(f).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sv = 0, ss = 0;
    for (let i = 0; i < data.length; i += 3) { const r = data[i], g = data[i + 1], b = data[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b); sv += mx; ss += mx ? (mx - mn) / mx : 0; }
    const n = data.length / 3;
    v.push(sv / n / 255); s.push(ss / n);
  }
  return { brightness: round(mean(v), 2), saturation: round(mean(s), 2) };
}
const paceOf = (avg: number) => (avg <= 1.2 ? "fast" : avg <= 2.6 ? "balanced" : "calm");
function energyCurve(shots: number[]) {
  if (shots.length < 6) return "steady";
  const k = Math.floor(shots.length / 3), first = mean(shots.slice(0, k)), last = mean(shots.slice(-k));
  if (last < first * 0.75) return "rising";
  if (last > first * 1.33) return "falling";
  return mean(shots.slice(k, -k)) < Math.min(first, last) * 0.75 ? "peak_in_middle" : "steady";
}
function measure(cuts: number[], duration: number, audio: AudioAnalysis | null): Prof {
  const bounds = [0, ...cuts, duration], shots = bounds.slice(1).map((b, i) => b - bounds[i]).filter((x) => x > 0.05), avg = shots.length ? mean(shots) : duration;
  const out: Prof = { seconds: round(duration, 1), shots: shots.length, avg_shot: round(avg, 2), median_shot: round(shots.length ? median(shots) : duration, 2), shortest_shot: round(shots.length ? Math.min(...shots) : duration, 2),
    longest_shot: round(shots.length ? Math.max(...shots) : duration, 2), hook_seconds: round(shots.length ? shots[0] : duration, 2), cuts_per_10s: round((10 * cuts.length) / Math.max(duration, 0.1), 1),
    pace: paceOf(avg), has_music: audio !== null, energy_curve: energyCurve(shots) };
  if (audio && audio.beats.length) {
    const mm = buildMusicMap(audio, 0, duration), pts = snapPoints(mm), on = cuts.filter((c) => pts.length && Math.min(...pts.map((p) => Math.abs(c - p))) <= ON_BEAT);
    const loud: number[] = [], calm: number[] = [];
    bounds.slice(1).forEach((b, i) => (loudLimit(mm, bounds[i], b) ? loud : calm).push(b - bounds[i]));
    const period = audio.bpm ? 60 / audio.bpm : 0;
    Object.assign(out, { bpm: round(audio.bpm, 1), on_beat_share: cuts.length ? round(on.length / cuts.length, 2) : 0, beats_per_shot: period && shots.length ? round(median(shots) / period, 1) : null,
      loud_avg_shot: loud.length ? round(mean(loud), 2) : null, calm_avg_shot: calm.length ? round(mean(calm), 2) : null });
  }
  return out;
}
const ReferenceLook = z.object({ framing: z.string().default(""), text_on_screen: z.string().default(""), effects: z.array(Text).default([]), transitions: z.array(Text).default([]), colour: z.string().default(""), mood: z.string().default(""), summary: z.string().default("") });
async function describeLook(frames: Buffer[], p: Prof) {
  if (!frames.length) return null;
  try {
    return await getProvider("clip_understanding").visionStructured("You analyse the editing style of a short vertical video (Instagram Reel / TikTok) from one frame per shot, for an editor who wants to copy its style. Reply with one JSON object only. Describe style, never people's identity.",
      `${frames.length} frames, one per shot, in order. Measured: ${p.shots} shots in ${p.seconds} s, average shot ${p.avg_shot} s. Return JSON: {"framing": "close-ups|medium|wide|mixed", "text_on_screen": "none|hook only|some shots|every shot|captions", "effects": ["visible camera effects"], "transitions": ["visible transitions"], "colour": "<colour grade in a few words>", "mood": "<one word>", "summary": "<one sentence: how this video is edited>"}`,
      frames.slice(0, 12), ReferenceLook, { task: "clip_understanding", temperature: 0.1 });
  } catch (e) { if (!(e instanceof AppError)) throw e; return null; } // no vision model: the numbers still work
}

/** Measure one reference video; keepCuts also returns its cut times (to cut a new Reel shot by shot like it). */
export async function profileVideo(file: string, name = "", keepCuts = false): Promise<Prof> {
  const meta = parseVideoProbe(await probe(file)), duration = Math.min(meta.duration, MAX_SECONDS);
  let cuts = await detectCuts(file, duration);
  if (cuts.length < 2 && duration > 3) { const soft = await detectCuts(file, duration, SOFT_SCENE_THRESHOLD); if (soft.length) cuts = soft; }
  let audio: AudioAnalysis | null = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ref_"));
  try {
    const wav = path.join(tmp, "ref.wav");
    try { await renderFfmpeg(["-t", String(MAX_SECONDS), "-i", file, "-vn", "-ac", "1", "-ar", "22050", wav], { timeout: 300 }); } catch { /* no soundtrack */ }
    if (fs.existsSync(wav) && fs.statSync(wav).size > 10_000) { try { audio = await analyzeAudio(wav); } catch { /* an odd soundtrack only loses the music numbers */ } }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const prof = measure(cuts, duration, audio), bounds = [0, ...cuts, duration], frames: Buffer[] = [];
  for (const t of bounds.slice(1).map((b, i) => (bounds[i] + b) / 2).slice(0, 24)) { const f = await frameAt(file, t); if (f) frames.push(f); }
  prof.look = await lookOf(frames);
  prof.described = await describeLook(frames, prof);
  prof.name = name;
  if (keepCuts) prof.cuts = cuts.map((c) => round(c, 3));
  return prof;
}

const HALF_LIFE_DAYS = 45;
export function recencyWeight(addedAt: unknown, now = new Date()): number {
  if (!addedAt) return 1;
  const d = addedAt instanceof Date ? addedAt : new Date(String(addedAt));
  if (Number.isNaN(d.getTime())) return 1;
  return Math.max(0.5 ** (Math.max((now.getTime() - d.getTime()) / 86400_000, 0) / HALF_LIFE_DAYS), 0.15);
}
const AVG_KEYS = ["avg_shot", "median_shot", "hook_seconds", "cuts_per_10s", "bpm", "on_beat_share", "beats_per_shot", "loud_avg_shot", "calm_avg_shot"];
/** One profile for a trend: numbers averaged (by length and recency), descriptions listed. */
export function mergeProfiles(videos: Prof[]): Prof {
  if (!videos.length) return {};
  const secs = (v: Prof) => Number(v.seconds);
  const out: Prof = { videos: videos.length, seconds: round(videos.reduce((s, v) => s + secs(v), 0), 1), seconds_per_video: round(videos.reduce((s, v) => s + secs(v), 0) / videos.length, 1) };
  for (const k of AVG_KEYS) {
    const vals = videos.filter((v) => v[k] !== null && v[k] !== undefined).map((v) => [Number(v[k]), secs(v) * recencyWeight(v.added_at)]);
    if (vals.length) out[k] = round(vals.reduce((s, [x, w]) => s + x * w, 0) / vals.reduce((s, [, w]) => s + w, 0), 2);
  }
  out.shortest_shot = Math.min(...videos.map((v) => Number(v.shortest_shot)));
  out.longest_shot = Math.max(...videos.map((v) => Number(v.longest_shot)));
  out.pace = paceOf(Number(out.avg_shot ?? 2));
  const looks = videos.map((v) => v.look as Record<string, number> | undefined).filter((l): l is Record<string, number> => Boolean(l && Object.keys(l).length));
  if (looks.length) out.look = { brightness: round(mean(looks.map((l) => l.brightness)), 2), saturation: round(mean(looks.map((l) => l.saturation)), 2) };
  out.described = [...videos].sort((a, b) => String(b.added_at ?? "").localeCompare(String(a.added_at ?? ""))).filter((v) => v.described).map((v) => v.described).slice(0, 4);
  const curves = videos.map((v) => v.energy_curve as string).filter(Boolean);
  if (curves.length) { const c = new Map<string, number>(); for (const x of curves) c.set(x, (c.get(x) ?? 0) + 1); out.energy_curve = [...c].sort((a, b) => b[1] - a[1])[0][0]; }
  return out;
}

// ------------------------------------------------------------------ the API (api/references.py)
const camel = (v: unknown): unknown => (Array.isArray(v) ? v.map(camel) : v && typeof v === "object" && !(v instanceof Date) && !(v instanceof ObjectId) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()), camel(x)])) : v);
const refOut = (d: Record<string, unknown>) => ({ id: String(d._id), name: d.name, notes: d.notes ?? "", auto: Boolean(d.auto), profile: camel(d.profile ?? {}), videos: camel(d.videos ?? []), createdAt: d.createdAt ?? null, updatedAt: d.updatedAt ?? null });
const refs = async () => (await db()).collection("references");

async function measureFiles(files: UploadedFile[]): Promise<Prof[]> {
  if (!files.length) throw new ValidationFailed("Add at least one reference video.", { code: "NO_VIDEOS" });
  if (files.length > MAX_FILES) throw new ValidationFailed(`Add at most ${MAX_FILES} videos at a time.`, { code: "TOO_MANY_FILES" });
  const out: Prof[] = [];
  for (const f of files) {
    const name = sanitizeFilename(f.filename, "reference"), ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXTS.includes(ext)) throw new UnsupportedMedia(`${name} is not a supported video file.`, { code: "UNSUPPORTED_MEDIA" });
    if (f.tooLarge) throw new ValidationFailed(`${name} is larger than 300 MB.`, { code: "FILE_TOO_LARGE" });
    const named = `${f.tmp}${ext}`;
    moveFile(f.tmp, named);
    f.tmp = named;
    try { out.push(await profileVideo(named, name)); }
    catch (e) { throw new ValidationFailed(`${name} could not be read as a video (${(e as Error).message}).`, { code: "UNREADABLE_VIDEO" }); }
  }
  return out;
}

export const listReferences = async () => (await (await refs()).find({}).sort({ updatedAt: -1 }).toArray()).map(refOut);
export async function createReference(req: Request) {
  const up = await readUpload(req, MAX_BYTES, MAX_FILES + 1);
  try {
    const name = (up.fields.name ?? "").trim(), notes = (up.fields.notes ?? "").trim();
    if (!name || name.length > 80) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "name"], msg: "1 to 80 characters" }] });
    const videos = await measureFiles(up.files.filter((f) => f.field === "files")), t = new Date();
    const doc = { _id: new ObjectId(), name, notes: notes.slice(0, 300), videos, profile: mergeProfiles(videos), createdAt: t, updatedAt: t };
    await (await refs()).insertOne(doc);
    return refOut(doc);
  } finally { up.cleanup(); }
}
async function refDoc(id: string) {
  const d = await (await refs()).findOne({ _id: parseId(id, "Trend") });
  if (!d) throw new NotFoundError("Trend not found.", { code: "TREND_NOT_FOUND" });
  return d;
}
export async function addVideos(id: string, req: Request) {
  const d = await refDoc(id), up = await readUpload(req, MAX_BYTES, MAX_FILES + 1);
  try {
    const videos = [...((d.videos as Prof[]) ?? []), ...(await measureFiles(up.files.filter((f) => f.field === "files")))].slice(-MAX_VIDEOS);
    await (await refs()).updateOne({ _id: d._id }, { $set: { videos, profile: mergeProfiles(videos), updatedAt: new Date() } });
    return refOut((await (await refs()).findOne({ _id: d._id }))!);
  } finally { up.cleanup(); }
}
export async function updateReference(id: string, p: { name?: string | null; notes?: string | null }) {
  const oid = parseId(id, "Trend"), changes = Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [k, String(v).trim()]));
  const res = await (await refs()).updateOne({ _id: oid }, { $set: { ...changes, updatedAt: new Date() } });
  if (!res.matchedCount) throw new NotFoundError("Trend not found.", { code: "TREND_NOT_FOUND" });
  return refOut((await (await refs()).findOne({ _id: oid }))!);
}
export async function removeVideo(id: string, index: number) {
  const d = await refDoc(id), videos = [...((d.videos as Prof[]) ?? [])];
  if (!(index >= 0 && index < videos.length) || videos.length === 1) throw new ValidationFailed("A trend keeps at least one video; delete the trend instead.", { code: "LAST_VIDEO" });
  videos.splice(index, 1);
  await (await refs()).updateOne({ _id: d._id }, { $set: { videos, profile: mergeProfiles(videos), updatedAt: new Date() } });
  return refOut((await (await refs()).findOne({ _id: d._id }))!);
}
export async function deleteReference(id: string) {
  const oid = parseId(id, "Trend"), d = await db();
  await d.collection("references").deleteOne({ _id: oid });
}
