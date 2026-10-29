import { z } from "zod";
import { requireAdmin } from "../../../../../../server/core/admin";
import { body } from "../../../../../../server/core/body";
import { route } from "../../../../../../server/core/http";
import { setPlanByAdmin } from "../../../../../../server/credits";

const PlanIn = z.object({ plan: z.string().min(1).max(40), months: z.number().int().min(1).max(12).default(1) });

/** Admin: put a person on a plan by hand (Free, or a paid plan for 1 or 12 months with its credits, no payment). */
export const POST = route<{ id: string }>(async (req, { id }) => {
  await requireAdmin(req);
  const b = await body(req, PlanIn);
  return setPlanByAdmin(id, b.plan, b.months);
});
