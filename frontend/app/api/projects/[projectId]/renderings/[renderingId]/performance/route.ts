import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { Performance, setPerformance } from "@/server/workspace";

/** Numbers the person copies from the platform; nothing is fetched from any social network. */
export const PUT = route<{ projectId: string; renderingId: string }>(async (req, { projectId, renderingId }) => setPerformance(projectId, renderingId, await body(req, Performance)));
