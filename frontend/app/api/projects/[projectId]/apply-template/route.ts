import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { applyTemplate } from "@/server/workspace";

export const POST = route<{ projectId: string }>(async (req, { projectId }) => applyTemplate(projectId, (await body(req, z.object({ templateId: z.string() }))).templateId));
