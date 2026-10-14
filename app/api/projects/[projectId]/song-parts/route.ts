import { round } from "@/server/core/py";
import { route } from "@/server/core/http";
import { projectSongAnalysis } from "@/server/services/music";
import { keyBeats } from "@/server/audio/keyBeats";
import { rankMusicWindows } from "@/server/video/timeline";

/** The best parts of the song for a Reel of `duration` seconds, best first, each with why. */
export const GET = route<{ projectId: string }>(async (req, { projectId }) => {
  const q = new URL(req.url).searchParams;
  const duration = Math.min(Math.max(Number(q.get("duration") ?? 15), 5), 600), count = Math.min(Math.max(Number(q.get("count") ?? 5), 1), 10);
  const { analysis } = await projectSongAnalysis(projectId);
  return { songSeconds: round(analysis.duration, 2), bpm: round(analysis.bpm, 1), duration, parts: rankMusicWindows(analysis, duration, count), tooShort: analysis.duration < duration,
    beats: analysis.beats.map((b) => round(b, 3)), keyBeats: keyBeats(analysis).map((k) => round(k.t, 3)) };
});
