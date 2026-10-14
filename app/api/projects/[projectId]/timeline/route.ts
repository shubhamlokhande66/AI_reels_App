import { route } from "@/server/core/http";
import { getState } from "@/server/timeline/service";

/** The edit (defaults filled), its version and undo history. */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => getState(projectId));
