import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setSite } from "../../../../server/site";

const SiteIn = z.object({ businessName: z.string(), supportEmail: z.string(), supportPhone: z.string(), businessAddress: z.string(), legalUpdated: z.string(), playStoreUrl: z.string().max(300), appStoreUrl: z.string().max(300), gstin: z.string().max(20) }).partial();

/** Change the business details (administrator only). */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  return setSite(await body(req, SiteIn));
});
