import { route } from "@/server/core/http";
import { listGenerations } from "@/server/workspace";

/** Every generation of this project (analysis versions, AI, plan, score, corrections, output). */
export const GET = route<{ projectId: string }>(async (_req, { projectId }) => listGenerations(projectId));
