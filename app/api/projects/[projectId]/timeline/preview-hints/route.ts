import { route } from "@/server/core/http";
import { previewHints } from "@/server/quality/api";

/** The renderer's own framing, brightness correction and colour grade per shot, for the live preview. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => previewHints(projectId));
