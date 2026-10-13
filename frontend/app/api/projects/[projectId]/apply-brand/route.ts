import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { applyBrand } from "@/server/brands";

/** Make a project follow a brand: defaults for new renders and (optionally) the current edit. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await body(req, z.object({ brandId: z.string(), toTimeline: z.boolean().default(true) }));
  return applyBrand(projectId, p.brandId, p.toTimeline);
});
