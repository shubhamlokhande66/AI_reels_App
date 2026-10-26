import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { quoteItem } from "@/server/credits";

/** What I pay for a plan or top-up: the price, the offer, my coupon (and why a code does not apply), the total. */
export const POST = route(async (req) => {
  const p = await body(req, z.object({ item: z.string().max(60), coupon: z.string().max(24).optional() }));
  limits.account(req);
  return quoteItem(p.item, p.coupon ?? null);
});
