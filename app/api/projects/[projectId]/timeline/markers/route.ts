import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { editMarkers, markers } from "@/server/services/markers";

/** The Reel's beat markers (Reel time): strong / medium beats on their real hits, drops, the person's own; + waveform. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => markers(projectId));

const MarkerEdit = z.object({ add: z.array(z.number()).default([]), remove: z.array(z.number()).default([]) });

/** Add or remove beat markers by hand (Reel times). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, MarkerEdit);
  return editMarkers(projectId, p.add, p.remove);
});
