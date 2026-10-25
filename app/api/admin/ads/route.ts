import { z } from "zod";
import { requireAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { setAds } from "@/server/ads";

const AdsIn = z.object({ enabled: z.boolean().optional(), client: z.string().max(40).optional(), slot: z.string().max(20).optional() });

/** Admin: ads on or off, and the Google AdSense publisher id and ad slot. */
export const PUT = route(async (req) => { await requireAdmin(req); return setAds(await body(req, AdsIn)); });
