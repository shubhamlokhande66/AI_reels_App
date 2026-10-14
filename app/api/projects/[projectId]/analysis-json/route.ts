import { ValidationFailed } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { projectSong, songDocument } from "@/server/services/music";

/** The song's analysis document: tempo, every beat and onset, frame features, events, silences, candidate changes. */
export const GET = route<{ projectId: string }>(async (req, { projectId }) => {
  const step = Number(new URL(req.url).searchParams.get("frame_step") ?? 1);
  if (!Number.isInteger(step) || step < 1 || step > 100) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["query", "frame_step"], msg: "1 to 100" }] });
  return songDocument((await projectSong(projectId)).audio.key, step);
});
