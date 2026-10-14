import { route } from "@/server/core/http";
import { undo } from "@/server/timeline/service";

export const POST = route<{ projectId: string }>(async (_req, { projectId }) => undo(projectId));
