import { route } from "@/server/core/http";
import { restoreVersion } from "@/server/timeline/service";

/** Make the edit a previous render was made from the current one (a new, undoable step). */
export const POST = route<{ projectId: string; renderingId: string }>(async (_req, { projectId, renderingId }) => restoreVersion(projectId, renderingId));
