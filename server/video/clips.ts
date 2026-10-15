import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import { projectKey } from "@/server/media/service";
import { clipDefaults, semanticDefaults, type ClipAnalysis, type ClipInput, type ClipSemantic } from "@/server/models/clip";
import { getProjectDoc } from "@/server/projects/service";
import * as shared from "@/server/services/analysisCache";
import { localPath, mediaPath } from "@/server/storage/local";
import { analyzeClip, VIDEO_ANALYSIS_VERSION } from "./analyzer";
import { findDuplicates, thumbnails } from "./duplicates";
import { joined } from "./footage";

/** The project's clips analysed once (was jobs/pipeline.analyze_videos / find_duplicate_videos and
 * services/music_reel.video_report). Same files as the Python backend: projects/<id>/analysis/clip_<media id>.json,
 * the shared cache by content, and duplicates_v2_<hash>.json. */

export interface VideoRef { id: string; name: string; key: string; width: number; height: number }
type Progress = (fraction: number) => void;

const clipKey = (pid: string, mid: string) => projectKey(pid, "analysis", `clip_${mid}.json`);
const semanticKey = (pid: string, mid: string) => projectKey(pid, "analysis", `semantic_${mid}.json`);

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(localPath(key), "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(key: string, doc: unknown) {
  const file = localPath(key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc));
}

/** The project's clips in their order (was music_reel.project_input for the videos). */
export async function projectVideos(projectId: string): Promise<{ projectId: string; videos: VideoRef[] }> {
  const doc = await getProjectDoc(projectId);
  const media = new Map((await (await db()).collection("media").find({ projectId: doc._id }).toArray()).map((m) => [String(m._id), m]));
  const videos = ((doc.videoOrder ?? []) as unknown[]).map((i) => media.get(String(i))).filter((m) => m !== undefined);
  if (!videos.length) throw new ValidationFailed("Upload at least one clip first.", { code: "NO_VIDEOS" });
  if (videos.some((m) => m.purged)) throw new ValidationFailed("Some clips of this project were deleted (privacy). Upload them again.", { code: "MEDIA_PURGED" });
  return {
    projectId: String(doc._id),
    videos: videos.map((m) => ({ id: String(m._id), name: m.originalName as string, key: m.storedKey as string, width: (m.width as number) || 0, height: (m.height as number) || 0 })),
  };
}

/** Each clip analysed once; re-runs read the saved analysis. */
export async function analyzeVideos(projectId: string, videos: VideoRef[], progress: Progress = () => {}): Promise<Map<string, ClipAnalysis>> {
  const out = new Map<string, ClipAnalysis>();
  const n = videos.length;
  for (const [i, v] of videos.entries()) {
    const cached = readJson<ClipAnalysis>(clipKey(projectId, v.id));
    if (cached && (cached.analysisVersion ?? 0) >= VIDEO_ANALYSIS_VERSION) {
      out.set(v.id, clipDefaults(cached));
      progress((i + 1) / n);
      continue;
    }
    const digest = await shared.contentHash(v.key);
    const hit = shared.load<ClipAnalysis>(digest, "clip", VIDEO_ANALYSIS_VERSION);
    if (hit) {
      // the same footage was analysed before (another project, a duplicate): reuse it
      const a = clipDefaults({ ...hit, clipId: v.id });
      writeJson(clipKey(projectId, v.id), a);
      out.set(v.id, a);
      progress((i + 1) / n);
      continue;
    }
    const a = await analyzeClip(await mediaPath(v.key), v.id, (f) => progress((i + f) / n));
    writeJson(clipKey(projectId, v.id), a);
    shared.save(digest, "clip", VIDEO_ANALYSIS_VERSION, a);
    out.set(v.id, a);
    progress((i + 1) / n);
  }
  return out;
}

/** What the vision model saw in each clip, when it was asked before (no new AI call here). */
export function savedSemantics(projectId: string, videos: VideoRef[]): Map<string, ClipSemantic> {
  const out = new Map<string, ClipSemantic>();
  for (const v of videos) {
    const s = readJson<ClipSemantic>(semanticKey(projectId, v.id));
    if (s) out.set(v.id, semanticDefaults({ ...s, clipId: s.clipId ?? v.id }));
  }
  return out;
}

export async function clipInputs(projectId: string, videos: VideoRef[]): Promise<ClipInput[]> {
  const clips = await analyzeVideos(projectId, videos);
  const sem = savedSemantics(projectId, videos);
  return videos.filter((v) => clips.has(v.id)).map((v) => ({ clipId: v.id, name: v.name, analysis: clips.get(v.id)!, semantic: sem.get(v.id) ?? null }));
}

/** [{clipId, sameAs, offset}] of uploads that copy another (cached per set of clips); null = the check could not run. */
export async function findDuplicateVideos(projectId: string, videos: VideoRef[]): Promise<{ clipId: string; sameAs: string; offset: number }[] | null> {
  if (videos.length < 2) return [];
  const hash = crypto.createHash("sha1").update(videos.map((v) => v.id).sort().join(",")).digest("hex").slice(0, 16);
  const key = projectKey(projectId, "analysis", `duplicates_v2_${hash}.json`);
  const found = readJson<{ clipId: string; sameAs: string; offset: number }[]>(key);
  if (Array.isArray(found)) return found;
  try {
    const thumbs = [];
    for (const v of videos) thumbs.push([v.id, await thumbnails(await mediaPath(v.key))] as [string, Awaited<ReturnType<typeof thumbnails>>]);
    const dups = findDuplicates(thumbs);
    writeJson(key, dups);
    return dups;
  } catch (e) {
    console.warn("duplicate check skipped:", e); // a failed check must never stop a Reel
    return null;
  }
}

/** Each clip: size, scores, flags, good parts, scene cuts, best segments, and which uploads are copies (the
 * /api/v1/video/analyze answer). */
export async function videoReport(projectId: string, videos: VideoRef[], understand = false) {
  const warnings: string[] = [];
  if (understand) warnings.push("Clip understanding (the vision model) is not available yet in this version; the measurements are complete.");
  const clips = await clipInputs(projectId, videos);
  const dups = await findDuplicateVideos(projectId, videos);
  const same = new Map((dups ?? []).map((d) => [d.clipId, d]));
  const names = new Map(videos.map((v) => [v.id, v.name]));
  const rows = clips.map(({ clipId, name, analysis: a, semantic: s }) => {
    const m = a.metadata;
    return {
      clip_id: clipId, name, duration_sec: round(m.duration, 3), width: m.width, height: m.height, fps: m.fps, orientation: m.orientation, usable: a.usable, flags: a.flags,
      scores: { quality: round(a.qualityScore, 3), sharpness: round(a.sharpnessScore, 3), brightness: round(a.brightnessScore, 3), motion: round(a.motionScore, 3), shake: round(a.shakeScore, 3), resolution: round(a.resolutionScore, 3) },
      usable_windows: joined(a.windows).map((w) => ({ start_sec: round(w.start, 3), end_sec: round(w.end, 3), quality: round(w.quality, 3), motion: round(w.motion, 3), face: w.face, shot: w.shotSize })),
      scene_changes_sec: a.sceneChanges.map((t) => round(t, 3)),
      best_segments: a.bestSegments.map((b) => ({ start_sec: round(b.start, 3), end_sec: round(b.end, 3), score: round(b.score, 3), why: b.reason })),
      duplicate_of: same.get(clipId)?.sameAs ?? null,
      understanding: s === null ? null : {
        shows: s.summary, category: s.category, scene: s.scene, objects: s.objects, people: s.people, action: s.action, mood: s.mood, stage: s.stage,
        hook_candidate: s.hookCandidate, ending_candidate: s.endingCandidate, importance: s.importance, tags: s.tags, model: s.model,
      },
    };
  });
  return {
    status: "completed", clips: rows,
    duplicates: (dups ?? []).map((d) => ({ clip_id: d.clipId, name: names.get(d.clipId) ?? null, same_as: d.sameAs, same_as_name: names.get(d.sameAs) ?? null, offset_sec: d.offset ?? null })),
    understood: rows.filter((r) => r.understanding).length,
    errors: [...(dups !== null ? [] : ["The duplicate check could not run."]), ...warnings],
  };
}
