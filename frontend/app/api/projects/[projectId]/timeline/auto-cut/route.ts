import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { autoCut } from "@/server/services/markers";

const AutoCut = z.object({ density: z.string().default("both"), minClip: z.number().min(0.25).max(3).default(0.4) });

/** Re-cut the Reel's clips onto the markers of a density (one undoable edit), with keyframes and ramps from the music. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, AutoCut);
  return autoCut(projectId, p.density, p.minClip);
});
