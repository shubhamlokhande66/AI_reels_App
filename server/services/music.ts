import "server-only";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import { analyzeMusic } from "@/server/audio/analyzer";
import { analyzeToJson, type AnalysisDoc } from "@/server/audio/analysisJson";
import type { AudioAnalysis } from "@/server/models/analysis";
import { getProjectDoc } from "@/server/projects/service";
import * as cache from "@/server/services/analysisCache";
import { localPath } from "@/server/storage/local";

/** The project's song, analysed once (the music endpoints and the editor read this; was api/jobs._project_song_analysis
 * and services/music_reel.song_document). */

/** 6 = beats exactly as Essentia detected them, transients, bars only with evidence; 5 = Essentia beats; raise when
 * analysisJson changes what it returns. */
export const ANALYSIS_JSON_VERSION = 6;

export async function projectSong(projectId: string) {
  const doc = await getProjectDoc(projectId);
  const audio = doc.audioId ? await (await db()).collection("media").findOne({ _id: doc.audioId }) : null;
  if (!audio) throw new ValidationFailed("Upload a song first.", { code: "NO_AUDIO" });
  if (audio.purged) throw new ValidationFailed("The song of this project was deleted (privacy). Upload it again.", { code: "MEDIA_PURGED" });
  return { doc, audio: { id: String(audio._id), key: audio.storedKey as string, name: audio.originalName as string } };
}

export async function projectSongAnalysis(projectId: string): Promise<{ analysis: AudioAnalysis; key: string; projectDoc: Awaited<ReturnType<typeof getProjectDoc>> }> {
  const { doc, audio } = await projectSong(projectId);
  return { analysis: await analyzeMusic(String(doc._id), audio), key: audio.key, projectDoc: doc };
}

/** The analysis document of a stored song, analysed once (shared by content across projects). */
export async function songDocument(audioKey: string, frameStep = 10): Promise<AnalysisDoc> {
  const digest = await cache.contentHash(audioKey);
  const kind = `analysis_json_step${frameStep}`;
  const hit = cache.load<AnalysisDoc>(digest, kind, ANALYSIS_JSON_VERSION);
  if (hit) return hit;
  const doc = await analyzeToJson(localPath(audioKey), frameStep);
  if (doc.status === "completed") cache.save(digest, kind, ANALYSIS_JSON_VERSION, doc);
  return doc;
}
