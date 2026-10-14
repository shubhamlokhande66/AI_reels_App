import { route } from "@/server/core/http";
import { redo } from "@/server/timeline/service";

export const POST = route<{ projectId: string }>(async (_req, { projectId }) => redo(projectId));
