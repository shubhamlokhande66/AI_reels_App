import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { connectionTest } from "@/server/ai/settingsApi";

/** One tiny structured call to the provider (and optionally its vision model). Nothing else changes. */
export const POST = route(async (req) => {
  requireAdmin(req);
  const p = await body(req, z.object({ provider: z.string().nullish(), vision: z.boolean().default(false) }));
  return connectionTest(p.provider ?? null, p.vision);
});
