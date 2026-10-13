import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { qualityFix } from "@/server/quality/api";

/** The fix for one issue as a single undoable edit, then what is left. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, z.object({ code: z.string().min(1).max(40), segmentId: z.string().nullable().default(null) }));
  return qualityFix(projectId, p.code, p.segmentId);
});
