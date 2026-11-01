import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setPricing } from "../../../../server/workspace";

const PricingIn = z.object({ plans: z.array(z.record(z.string(), z.unknown())), topUps: z.array(z.record(z.string(), z.unknown())), costs: z.record(z.string(), z.unknown()) });

/** Admin: prices, credits per plan, top-ups and credit costs. */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  const p = await body(req, PricingIn);
  return setPricing(p.plans, p.topUps, p.costs);
});
