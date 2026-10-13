import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { getScript, putScript, ScriptIn } from "@/server/voice";

export const GET = route<{ projectId: string }>(async (_req, { projectId }) => getScript(projectId));
export const PUT = route<{ projectId: string }>(async (req, { projectId }) => putScript(projectId, await body(req, ScriptIn)));
