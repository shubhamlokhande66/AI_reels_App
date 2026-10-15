import "server-only";
import fs from "node:fs";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import { decode } from "@/server/audio/decode";
import { addMotion } from "@/server/director/planMotion";
import type { AudioAnalysis } from "@/server/models/analysis";
import { Segment, type Timeline } from "@/server/models/timeline";
import { projectSongAnalysis } from "@/server/services/music";
import { mediaPath } from "@/server/storage/local";
import { contextFor, currentTimeline, load, replace } from "@/server/timeline/service";

/** Beat markers in the editor and auto-cut (was backend/app/services/markers.py): the strong and medium beats of the
 * Reel's part of the song (each on its real hit), the drops, the person's own markers (kept in song time). */

export const DENSITIES: Record<string, string[]> = {
  both: ["strong", "medium", "drop", "custom"], strong: ["strong", "drop", "custom"], drops: ["drop", "custom"],
};
const SAME = 0.04;
export const PEAKS_PER_SECOND = 40;
const near = (times: number[], t: number, tol: number) => times.some((x) => Math.abs(x - t) <= tol);

async function context(projectId: string): Promise<[Awaited<ReturnType<typeof load>>, Timeline, AudioAnalysis, string]> {
  const { analysis, key } = await projectSongAnalysis(projectId);
  const doc = await load(projectId);
  const tl = currentTimeline(doc);
  if (!tl) throw new ValidationFailed("Add your clips first: there is no edit to put beat markers on.", { code: "NO_TIMELINE" });
  return [doc, tl, analysis, key];
}

/** The song's waveform for the editor: the loudest level every 1/PEAKS_PER_SECOND s, 0..1, made once and kept. */
async function songPeaks(file: string): Promise<number[]> {
  const saved = `${file}.peaks.json`;
  try {
    if (fs.statSync(saved).mtimeMs >= fs.statSync(file).mtimeMs) return JSON.parse(fs.readFileSync(saved, "utf8"));
  } catch { /* not made yet */ }
  const sr = 8000;
  const y = await decode(file, sr);
  const step = Math.trunc(sr / PEAKS_PER_SECOND);
  const n = Math.floor(y.length / step);
  const peaks = new Float64Array(n);
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step; j++) m = Math.max(m, Math.abs(y[j])); peaks[i] = m; }
  const sorted = Float64Array.from(peaks).sort();
  const top = n ? sorted[Math.min(Math.round(0.995 * (n - 1)), n - 1)] : 1;
  const out = top > 0 ? Array.from(peaks, (v) => round(Math.min(v / top, 1), 3)) : Array.from(peaks, () => 0);
  fs.writeFileSync(saved, JSON.stringify(out));
  return out;
}

export function songMarkers(a: AudioAnalysis, start: number, end: number, own: { added?: number[]; removed?: number[] } = {}) {
  const removed = own.removed ?? [], added = own.added ?? [];
  const downs = [...a.downbeats].sort((x, y) => x - y), strong = [...a.strongBeats].sort((x, y) => x - y), medium = [...a.mediumBeats].sort((x, y) => x - y);
  const drops = [...a.drops].sort((x, y) => x - y).map((d) => {
    if (!a.beats.length) return d;
    const b = a.beats.reduce((best, x) => (Math.abs(x - d) < Math.abs(best - d) ? x : best), a.beats[0]);
    return Math.abs(b - d) <= 0.1 ? b : d;
  });
  const levels = a.beatLevels.length === a.beats.length ? a.beatLevels : a.beats.map(() => 1);
  const out: { t: number; kind: string; level: number; barStart?: boolean }[] = [];
  a.beats.forEach((t, i) => {
    if (!(start - 1e-6 <= t && t <= end + 1e-6) || near(removed, t, SAME) || near(drops, t, 0.005)) return;
    const kind = near(strong, t, 0.02) || levels[i] >= 4 ? "strong" : near(medium, t, 0.02) ? "medium" : null;
    if (kind) out.push({ t: round(t, 3), kind, level: levels[i], barStart: near(downs, t, 0.02) });
  });
  for (const d of drops) if (start <= d && d <= end && !near(removed, d, SAME)) out.push({ t: round(d, 3), kind: "drop", level: 5 });
  for (const t of added) if (start <= t && t <= end) out.push({ t: round(t, 3), kind: "custom", level: 5 });
  return out.sort((x, y) => x.t - y.t);
}

/** The Reel's markers in Reel time (0 = the Reel's first frame), with the waveform of its part of the song. */
export async function markers(projectId: string) {
  const [doc, tl, analysis, key] = await context(projectId);
  const own = (doc.beatMarkers ?? {}) as { added?: number[]; removed?: number[] };
  const ms = songMarkers(analysis, tl.audioStart, tl.audioStart + tl.duration, own);
  const peaks = await songPeaks(await mediaPath(key));
  const i0 = Math.trunc(tl.audioStart * PEAKS_PER_SECOND);
  return {
    waveform: { perSecond: PEAKS_PER_SECOND, peaks: peaks.slice(i0, i0 + Math.trunc(tl.duration * PEAKS_PER_SECOND) + 1) },
    markers: ms.map((m) => ({ ...m, t: round(m.t - tl.audioStart, 3) })),
    barConfidence: round(analysis.downbeatConfidence, 2), bpm: round(analysis.bpm, 1), audioStart: tl.audioStart, duration: tl.duration,
    densities: Object.keys(DENSITIES), own: { added: (own.added ?? []).length, removed: (own.removed ?? []).length },
  };
}

/** Add / remove markers by hand (Reel times in, kept in song time). */
export async function editMarkers(projectId: string, add: number[], remove: number[]) {
  const [doc, tl] = await context(projectId);
  const own = (doc.beatMarkers ?? { added: [], removed: [] }) as { added?: number[]; removed?: number[] };
  let added = [...(own.added ?? [])], removed = [...(own.removed ?? [])];
  for (const t of remove) {
    const song = round(tl.audioStart + t, 3);
    const mine = added.filter((x) => Math.abs(x - song) <= SAME);
    if (mine.length) added = added.filter((x) => !mine.includes(x));
    else if (!near(removed, song, SAME)) removed.push(song);
  }
  for (const t of add) {
    const song = round(tl.audioStart + t, 3);
    removed = removed.filter((x) => Math.abs(x - song) > SAME);
    if (!near(added, song, 0.02)) added.push(song);
  }
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { beatMarkers: { added: added.sort((a, b) => a - b), removed: removed.sort((a, b) => a - b) } } });
  return markers(projectId);
}

/** The Reel re-cut at `points` (Reel times): no shot under `minClip`, the clips in order, each clip's footage running on. */
export function cutOnto(tl: Timeline, points: number[], minClip: number, clipSeconds: Record<string, number>): Timeline {
  const cuts: number[] = [];
  for (const p of [...points].sort((a, b) => a - b)) if (p - (cuts.length ? cuts[cuts.length - 1] : 0) >= minClip && tl.duration - p >= minClip) cuts.push(round(p, 3));
  const bounds = [0, ...cuts, round(tl.duration, 3)];
  const old = tl.segments;
  const n = bounds.length - 1;
  const segs: Segment[] = [];
  const cursor = new Map<number, number>();
  const which = (i: number) => Math.min(Math.floor((i * old.length) / n), old.length - 1);
  for (let i = 0; i < n; i++) {
    const k = which(i);
    const src = old[k];
    const length = bounds[i + 1] - bounds[i];
    const need = length * src.speed;
    let start = cursor.get(k) ?? src.sourceStart;
    const dur = clipSeconds[src.clipId];
    if (dur !== undefined && start + need > dur) start = Math.max(dur - need, 0);
    cursor.set(k, start + need);
    const first = !Array.from({ length: i }, (_, j) => which(j)).includes(k);
    let wayIn = first && i > 0 ? src.transitionIn : { type: "cut", duration: 0 };
    if (wayIn.type !== "cut" && wayIn.type !== "speed_ramp") {
      const prevLen = i > 0 ? bounds[i] - bounds[i - 1] : length;
      wayIn = { type: wayIn.type, duration: round(Math.min(wayIn.duration, 0.4 * Math.min(length, prevLen)), 3) };
    }
    segs.push({ ...structuredClone(src), id: `${src.id.slice(0, 8)}${String(i).padStart(4, "0")}`, timelineStart: bounds[i], timelineEnd: bounds[i + 1],
      sourceStart: round(start, 3), sourceEnd: round(start + need, 3), transitionIn: wayIn, keyframes: [], locked: false });
  }
  return { ...tl, segments: segs };
}

/** Re-cut the Reel onto the markers of `density` and give the shots their motion from the music, one undoable step. */
export async function autoCut(projectId: string, density = "both", minClip = 0.4) {
  if (!(density in DENSITIES)) throw new ValidationFailed(`Unknown density '${density}'.`, { code: "BAD_DENSITY", details: { available: Object.keys(DENSITIES) } });
  const [doc, tl, analysis] = await context(projectId);
  const found = await markers(projectId);
  const points = found.markers.filter((m) => DENSITIES[density].includes(m.kind)).map((m) => m.t);
  if (!points.length) throw new ValidationFailed("There are no markers of that kind in this part of the song.", { code: "NO_MARKERS" });
  const ctx = await contextFor(doc);
  const next = cutOnto(tl, points, minClip, ctx.clipDurations);
  const notes = addMotion(next.segments, analysis, next.audioStart, ctx.clipDurations);
  const label = ({ both: "strong + medium beats", strong: "strong beats", drops: "drops" } as Record<string, string>)[density];
  return replace(projectId, { ...next, notes: [...next.notes.filter((x) => !x.startsWith("Motion from") && !x.startsWith("Speed ramps")), ...notes] }, `Auto-cut to ${label}`);
}

