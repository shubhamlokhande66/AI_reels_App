import { route } from "@/server/core/http";
import { saveDeviceAnalysis } from "@/server/video/clips";

/** The clip's analysis, made in the browser while it uploaded: kept when it is for this file ({ used: false, reason }
 * otherwise, and the server analyses the clip itself). */
export const POST = route<{ projectId: string; mediaId: string }>(async (req, { projectId, mediaId }) => {
  let raw: unknown = null;
  try { raw = await req.json(); } catch { /* not JSON: not used */ }
  return saveDeviceAnalysis(projectId, mediaId, (raw as { analysis?: unknown } | null)?.analysis);
});
