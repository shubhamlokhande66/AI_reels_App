import { analyzeMusic } from "@/server/audio/analyzer";
import { analyzeSong } from "@/server/audio/songReport";
import { route } from "@/server/core/http";
import { projectSong } from "@/server/services/music";
import { localPath } from "@/server/storage/local";

/** The full song report: tempo by section, every detected event, sections, patterns, and - kept apart - the editing
 * segments and recommendations (never a clip shorter than minClip). */
export const GET = route<{ projectId: string }>(async (req, { projectId }) => {
  const q = new URL(req.url).searchParams;
  const minClip = Math.min(Math.max(Number(q.get("min_clip") ?? q.get("minClip") ?? 0.4) || 0.4, 0.25), 2);
  const everyBeat = ["1", "true", "yes", "on"].includes((q.get("every_beat") ?? q.get("everyBeat") ?? "").toLowerCase());
  const { doc, audio } = await projectSong(projectId);
  const analysis = await analyzeMusic(String(doc._id), { id: audio.id, key: audio.key });
  return analyzeSong(localPath(audio.key), minClip, everyBeat, analysis);
});
