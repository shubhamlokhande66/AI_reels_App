import "server-only";
import fs from "node:fs";
import { moveFile } from "@/server/storage/local";
import os from "node:os";
import path from "node:path";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getProvider } from "@/server/ai";
import { Text } from "@/server/ai/director";
import { analyzeAudio } from "@/server/audio/analyzer";
import { db, parseId } from "@/server/core/db";
import { AppError, NotFoundError, UnsupportedMedia, ValidationFailed } from "@/server/core/errors";
import { findBinary, probe, renderFfmpeg, run } from "@/server/core/ffmpeg";
import { round } from "@/server/core/py";
import { forAi } from "@/server/director/learned";
import { buildMusicMap, loudLimit, snapPoints } from "@/server/director/musicMap";
import { sanitizeFilename, VIDEO_EXTS } from "@/server/media/service";
import { readUpload, type UploadedFile } from "@/server/media/upload";
import { parseVideoProbe } from "@/server/media/probe";
import { getProjectDoc } from "@/server/projects/service";
import { replaceProjectAudio } from "@/server/projects/media";
import type { AudioAnalysis } from "@/server/models/analysis";

/** Learned trends (were trends/reference.py, trends/learn.py, api/references.py): reference Reels the person uploads
 * are measured - cuts, shot lengths, beat sync, look, an AI description - and only the numbers are kept; many trending
 * Reels can be grouped into editing styles; one Reel can be copied shot by shot ("make it like this"). */

const SCENE_THRESHOLD = 0.32, SOFT_SCENE_THRESHOLD = 0.16, MIN_GAP = 0.2, ON_BEAT = 0.1, MAX_SECONDS = 180, MAX_FILES = 6, MAX_BYTES = 300 * 1024 * 1024, MAX_VIDEOS = 200, LIBRARY_MAX = 500;
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

const HALF_LIFE_DAYS = 45, MIN_PER_GROUP = 4, MAX_GROUPS = 6, MIN_STYLE_GAP = 0.45;
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
function features(v: Prof): number[] {
  const look = (v.look as Record<string, number>) ?? {}, beat = v.on_beat_share as number | undefined;
  return [Math.log(Math.max(Number(v.median_shot || v.avg_shot || 2), 0.15)), Math.log(Math.max(Number(v.hook_seconds || 2), 0.15)) * 0.6, (beat ?? 0.5) * 2,
    Number(look.brightness ?? 0.5) * 1.5, Number(look.saturation ?? 0.4) * 1.5, ({ rising: 0.5, peak_in_middle: 0.25, steady: 0, falling: -0.5 } as Record<string, number>)[v.energy_curve as string] ?? 0];
}
const dist2 = (a: number[], b: number[]) => a.reduce((s, x, i) => s + (x - b[i]) ** 2, 0);
function kmeans(x: number[][], k: number, seed = 7, iters = 60): [number[], number[][]] {
  let st = seed;
  const rand = () => { st = (st * 1103515245 + 12345) % 2147483648; return st / 2147483648; };
  const centers = [x[Math.floor(rand() * x.length)]];
  for (let c = 1; c < k; c++) {
    const d = x.map((p) => Math.min(...centers.map((cc) => dist2(p, cc)))), sum = d.reduce((a, b) => a + b, 0);
    if (sum <= 0) { centers.push(x[Math.floor(rand() * x.length)]); continue; }
    let r = rand() * sum, i = 0;
    while (i < d.length - 1 && r > d[i]) { r -= d[i]; i++; }
    centers.push(x[i]);
  }
  let c = centers.map((p) => [...p]), labels = new Array(x.length).fill(0);
  for (let it = 0; it < iters; it++) {
    labels = x.map((p) => c.reduce((best, cc, j) => (dist2(p, cc) < dist2(p, c[best]) ? j : best), 0));
    const nw = c.map((cc, j) => { const m = x.filter((_, i) => labels[i] === j); return m.length ? cc.map((_, d) => mean(m.map((p) => p[d]))) : cc; });
    if (nw.every((p, j) => p.every((v, d) => Math.abs(v - c[j][d]) < 1e-8))) break;
    c = nw;
  }
  return [labels, c];
}
function silhouette(x: number[][], labels: number[]): number {
  const d = (i: number, j: number) => Math.sqrt(dist2(x[i], x[j]));
  return mean(x.map((_, i) => {
    const same = labels.map((l, j) => (l === labels[i] ? j : -1)).filter((j) => j >= 0);
    if (same.length <= 1) return 0;
    const a = same.reduce((s, j) => s + d(i, j), 0) / (same.length - 1);
    const others = [...new Set(labels)].filter((l) => l !== labels[i]).map((l) => { const m = labels.map((x2, j) => (x2 === l ? j : -1)).filter((j) => j >= 0); return m.reduce((s, j) => s + d(i, j), 0) / m.length; });
    const b = others.length ? Math.min(...others) : 0;
    return (b - a) / Math.max(a, b, 1e-9);
  }));
}
/** The videos of each editing style, biggest first (few videos or one clear style = one group). */
export function groupVideos(videos: Prof[]): number[][] {
  const n = videos.length;
  if (n < 2 * MIN_PER_GROUP) return n ? [Array.from({ length: n }, (_, i) => i)] : [];
  const x = videos.map(features);
  let best: [number, number[]] | null = null;
  for (let k = 2; k <= Math.min(MAX_GROUPS, Math.floor(n / MIN_PER_GROUP)); k++) {
    const [labels, centers] = kmeans(x, k), sizes = Array.from({ length: k }, (_, j) => labels.filter((l) => l === j).length);
    if (Math.min(...sizes) < MIN_PER_GROUP) continue;
    const gaps: number[] = [];
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) gaps.push(Math.sqrt(dist2(centers[i], centers[j])));
    if (Math.min(...gaps) < MIN_STYLE_GAP) continue;
    const s = silhouette(x, labels);
    if (!best || s > best[0]) best = [s, labels];
  }
  if (!best || best[0] < 0.25) return [Array.from({ length: n }, (_, i) => i)];
  const labels = best[1];
  return [...new Set(labels)].sort((a, b) => a - b).map((j) => labels.map((l, i) => (l === j ? i : -1)).filter((i) => i >= 0)).sort((a, b) => b.length - a.length);
}
export function nameFor(p: Prof): string {
  const shot = Number(p.median_shot || p.avg_shot || 2), beat = p.on_beat_share as number | undefined, look = (p.look as Record<string, number>) ?? {};
  const parts = [shot <= 0.6 ? "Very fast" : shot <= 1.2 ? "Fast" : shot <= 2.4 ? "Balanced" : "Slow cinematic"];
  if (beat !== undefined && beat !== null) parts.push(beat >= 0.65 ? "beat-synced" : beat < 0.35 ? "free rhythm" : "");
  if (Number(p.hook_seconds || 9) <= 1) parts.push("quick hook");
  if ((look.saturation ?? 0.4) >= 0.5) parts.push("vivid"); else if ((look.brightness ?? 0.5) <= 0.35) parts.push("moody"); else if ((look.brightness ?? 0.5) >= 0.62) parts.push("bright");
  return parts.filter(Boolean).join(" · ");
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
  await d.collection("projects").updateMany({ "settings.reference": String(oid) }, { $set: { "settings.reference": "auto" } });
}

/** More trending Reels into the learning library; an unreadable file is reported by name, the others are learned. */
export async function learn(req: Request) {
  const up = await readUpload(req, MAX_BYTES, MAX_FILES + 1);
  try {
    const files = up.files.filter((f) => f.field === "files");
    if (!files.length) throw new ValidationFailed("Add at least one video.", { code: "NO_VIDEOS" });
    if (files.length > MAX_FILES) throw new ValidationFailed(`Send at most ${MAX_FILES} videos at a time.`, { code: "TOO_MANY_FILES" });
    const d = await db(), learned: string[] = [], failed: { name: string; error: string }[] = [];
    for (const f of files) {
      let prof: Prof;
      try { prof = (await measureFiles([f]))[0]; } catch (e) { if (!(e instanceof AppError)) throw e; failed.push({ name: f.filename || "video", error: e.message }); continue; }
      prof.added_at = new Date().toISOString();
      await d.collection("trend_videos").insertOne({ _id: new ObjectId(), name: prof.name ?? "", profile: prof, addedAt: new Date() });
      learned.push(String(prof.name ?? ""));
    }
    let total = await d.collection("trend_videos").countDocuments({});
    if (total > LIBRARY_MAX) {
      const old = (await d.collection("trend_videos").find({}, { projection: { _id: 1 } }).sort({ addedAt: 1 }).limit(total - LIBRARY_MAX).toArray()).map((x) => x._id);
      await d.collection("trend_videos").deleteMany({ _id: { $in: old } });
      total = LIBRARY_MAX;
    }
    return { learned, failed, total };
  } finally { up.cleanup(); }
}
export async function trendLibrary() {
  const d = await db(), last = await d.collection("trend_videos").findOne({}, { sort: { addedAt: -1 } });
  return { count: await d.collection("trend_videos").countDocuments({}), lastAdded: last?.addedAt ?? null, styles: await d.collection("references").countDocuments({ auto: true }) };
}
/** Every learned Reel sorted into editing styles (replaces the previous automatic styles; the person's own trends stay). */
export async function groupLibrary() {
  const d = await db(), videos = (await d.collection("trend_videos").find({}).sort({ addedAt: 1 }).toArray()).map((x) => x.profile as Prof);
  if (!videos.length) throw new ValidationFailed("Add a trending Reel first.", { code: "NO_REELS" });
  const groups = groupVideos(videos);
  await d.collection("references").deleteMany({ auto: true });
  const names = new Set<string>(), out = [];
  for (const idx of groups) {
    const vids = idx.map((i) => videos[i]), prof = mergeProfiles(vids), base = nameFor(prof);
    let name = base, k = 2;
    while (names.has(name)) name = `${base} (${k++})`;
    names.add(name);
    const doc = { _id: new ObjectId(), name, notes: `Learned from ${vids.length} trending Reels`, videos: vids, profile: prof, auto: true, createdAt: new Date(), updatedAt: new Date() };
    await d.collection("references").insertOne(doc);
    out.push(refOut(doc));
  }
  return out;
}
export async function clearLibrary() {
  const d = await db();
  await d.collection("trend_videos").deleteMany({});
  const autoIds = (await d.collection("references").find({ auto: true }, { projection: { _id: 1 } }).toArray()).map((x) => String(x._id));
  await d.collection("references").deleteMany({ auto: true });
  await d.collection("projects").updateMany({ "settings.reference": { $in: autoIds } }, { $set: { "settings.reference": "auto" } });
}

// ------------------------------------------------------------------ "make it like this Reel"
function referenceOut(ref: Record<string, unknown> | null | undefined) {
  if (!ref) return null;
  const p = (ref.profile as Prof) ?? {}, desc = p.described;
  return { name: ref.name, seconds: ref.seconds, shots: ((ref.cuts as unknown[]) ?? []).length + 1, avgShot: p.avg_shot ?? null, hookSeconds: p.hook_seconds ?? null, onBeatShare: ref.on_beat_share ?? null,
    bpm: p.bpm ?? null, summary: Array.isArray(desc) ? ((desc[0] as Record<string, string>) ?? {}).summary ?? "" : "", usesAudio: Boolean(ref.use_audio) };
}
export const getReferenceReel = async (projectId: string) => referenceOut((await getProjectDoc(projectId)).referenceReel as Record<string, unknown> | null);
export async function removeReferenceReel(projectId: string) {
  const doc = await getProjectDoc(projectId);
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $unset: { referenceReel: "" } });
}
/** Measure the one Reel the person wants theirs to be like; with useAudio its sound becomes the project's song. */
export async function setReferenceReel(projectId: string, req: Request) {
  const doc = await getProjectDoc(projectId), up = await readUpload(req, MAX_BYTES, 1);
  try {
    const f = up.files.find((x) => x.field === "file");
    if (!f) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "file"], msg: "Field required" }] });
    const useAudio = !["0", "false", "no", "off"].includes((up.fields.use_audio ?? up.fields.useAudio ?? "true").toLowerCase());
    const name = sanitizeFilename(f.filename, "reference"), ext = path.extname(name).toLowerCase();
    if (!VIDEO_EXTS.includes(ext)) throw new UnsupportedMedia(`${name} is not a supported video file.`, { code: "UNSUPPORTED_MEDIA" });
    if (f.tooLarge) throw new ValidationFailed(`${name} is larger than 300 MB.`, { code: "FILE_TOO_LARGE" });
    const file = `${f.tmp}${ext}`;
    moveFile(f.tmp, file);
    f.tmp = file;
    let prof: Prof;
    try { prof = await profileVideo(file, name, true); } catch (e) { throw new ValidationFailed(`${name} could not be read as a video (${(e as Error).message}).`, { code: "UNREADABLE_VIDEO" }); }
    if (Number(prof.shots ?? 0) < 2) throw new ValidationFailed("No cuts were found in this video: it looks like one continuous shot, so there is no editing to copy. Choose a Reel that cuts between several shots.", { code: "NO_CUTS" });
    let song: string | null = null;
    if (useAudio) {
      const m4a = path.join(path.dirname(file), `${path.parse(name).name.slice(0, 60)} (music).m4a`);
      try { await renderFfmpeg(["-i", file, "-vn", "-c:a", "aac", "-b:a", "192k", m4a], { timeout: 300 }); song = fs.existsSync(m4a) && fs.statSync(m4a).size > 20_000 ? m4a : null; } catch { song = null; }
    }
    const cuts = (prof.cuts as number[]) ?? [];
    delete prof.cuts;
    const ref = { name, seconds: prof.seconds, cuts, on_beat_share: prof.on_beat_share ?? null, profile: forAi({ name, profile: prof }), use_audio: song !== null };
    if (song) await replaceProjectAudio(doc, { field: "file", filename: path.basename(song), mimeType: "audio/mp4", tmp: song, size: fs.statSync(song).size, tooLarge: false }, false);
    await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { referenceReel: ref, updatedAt: new Date() } });
    return referenceOut(ref);
  } finally { up.cleanup(); }
}
