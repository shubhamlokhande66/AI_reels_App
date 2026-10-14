import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { submitVariations } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";

const VariationsRequest = z.object({ strategies: z.array(z.string()).max(6).nullable().default(null), seed: z.number().int().default(0) });

/** Versions A-E from the same source, each with a different editing strategy, analysed once. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = req.headers.get("content-length") === "0" ? VariationsRequest.parse({}) : await body(req, VariationsRequest.prefault({}));
  return Response.json(jobOut(await submitVariations(projectId, p.strategies, p.seed)), { status: 202 });
});
