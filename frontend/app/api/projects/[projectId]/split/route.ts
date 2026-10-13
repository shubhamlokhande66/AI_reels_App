import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { submitSplit } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

/** One long video -> several Reels from its best parts (talks: the densest whole sentences; other footage: the strongest moments). */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, z.object({ count: z.number().int().min(1).max(5).default(3), seconds: z.number().int().min(10).max(90).default(30) }));
  return Response.json(jobOut(await submitSplit(projectId, p.count, p.seconds)), { status: 202 });
});
