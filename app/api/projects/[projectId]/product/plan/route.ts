import { route } from "@/server/core/http";
import { productInput } from "@/server/jobs/manager";
import { makeProductPlan } from "@/server/product";
import { productBody } from "@/server/product/request";

/** The director's shot list, without rendering anything: every micro-shot, camera move, effect, transition and text. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = await productBody(req);
  const { inp } = await productInput(projectId, p.overrides, p.quality, p.seed ?? 0, p.audioAuto);
  return (await makeProductPlan(inp, () => {}))[0];
});
