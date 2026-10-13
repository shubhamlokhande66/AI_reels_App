import { route } from "@/server/core/http";
import { removeVoice } from "@/server/voice";

export const DELETE = route<{ projectId: string }>(async (_req, { projectId }) => removeVoice(projectId));
