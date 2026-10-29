import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setAds } from "../../../../server/ads";

const AdsIn = z.object({ enabled: z.boolean().optional(), client: z.string().max(40).optional(), slot: z.string().max(20).optional(),
  places: z.record(z.string().max(20), z.boolean()).optional() });

/** Admin: ads on or off, the pages that show one, and the Google AdSense publisher id and ad slot. */
export const PUT = route(async (req) => { await requireAdmin(req); return setAds(await body(req, AdsIn)); });
