import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { reviseProjectScript } from "@/server/voice";

export const POST = route<{ projectId: string }>(async (req, { projectId }) => reviseProjectScript(projectId, (await body(req, z.object({ instruction: z.enum(["shorten", "natural", "energetic", "regenerate"]) }))).instruction));
