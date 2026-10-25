import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { setSite } from "@/server/site";

const SiteIn = z.object({ businessName: z.string(), supportEmail: z.string(), supportPhone: z.string(), businessAddress: z.string(), legalUpdated: z.string() }).partial();

/** Change the business details (administrator only). */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  return setSite(await body(req, SiteIn));
});
