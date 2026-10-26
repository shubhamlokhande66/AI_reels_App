import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { createOrder } from "@/server/credits";

export const POST = route(async (req) => { const p = await body(req, z.object({ item: z.string().max(60), coupon: z.string().max(24).optional() })); return createOrder(p.item, p.coupon ?? null); });
