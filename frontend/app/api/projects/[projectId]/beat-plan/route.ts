import { cutPlan } from "@/server/audio/beatmap";
import { ValidationFailed } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { annotatePlan } from "@/server/director/planMotion";
import { projectSongAnalysis } from "@/server/services/music";

const num = (q: URLSearchParams, k: string, def: number, lo: number, hi: number) => {
  const v = q.has(k) ? Number(q.get(k)) : def;
  if (!Number.isFinite(v) || v < lo || v > hi) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["query", k], msg: `between ${lo} and ${hi}` }] });
  return v;
};

/** The cut plan for the chosen part of the song (start .. start + duration, song time), shot by shot. */
export const GET = route<{ projectId: string }>(async (req, { projectId }) => {
  const q = new URL(req.url).searchParams;
  const start = num(q, "start", 0, 0, 36000), duration = num(q, "duration", 15, 3, 600), minClip = num(q, "min_clip", 0.35, 0.25, 1);
  const everyBeat = ["1", "true"].includes(q.get("every_beat") ?? ""), hardOnly = ["1", "true"].includes(q.get("hard_hits") ?? "");
  const { analysis } = await projectSongAnalysis(projectId);
  const rows = cutPlan(analysis, null, null, start, start + duration, null, everyBeat && !hardOnly, minClip, hardOnly);
  annotatePlan(rows, analysis);
  return { start, duration, rows };
});
