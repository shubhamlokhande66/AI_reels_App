import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { submitStory } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, z.object({ voiceId: z.string().max(60).nullable().default(null), quality: z.enum(["final", "preview"]).default("final") }));
  return Response.json(jobOut(await submitStory(projectId, p.voiceId, p.quality)), { status: 202 });
});
