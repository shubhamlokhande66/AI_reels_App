import { route } from "@/server/core/http";
import { qualityCheck } from "@/server/quality/api";

export const POST = route<{ projectId: string }>(async (_req, { projectId }) => qualityCheck(projectId));
