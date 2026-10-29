import { z } from "zod";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { sendCredits } from "../../../../server/credits";

/** Send credits to a friend by @username (the administrator's limits apply). */
export const POST = route(async (req) => {
  const p = await body(req, z.object({ to: z.string().min(1).max(40), amount: z.number().int().positive().max(1000000), note: z.string().max(140).optional() }));
  limits.account(req);
  return sendCredits(p.to, p.amount, p.note ?? "");
});
