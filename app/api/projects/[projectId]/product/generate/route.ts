import { requireFeature } from "@/server/core/features";
import { route } from "@/server/core/http";
import { submitProduct } from "@/server/jobs/manager";
import { jobOut } from "@/server/projects/service";
import { productBody } from "@/server/product/request";

export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  await requireFeature(req, "productReel");
  const p = await productBody(req);
  return Response.json(jobOut(await submitProduct(projectId, p.overrides, p.quality, p.label ?? "", p.seed ?? 0, p.audioAuto)), { status: 202 });
});
