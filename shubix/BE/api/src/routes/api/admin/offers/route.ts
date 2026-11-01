import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { deleteOffer, listOffers, OfferIn, saveOffer } from "../../../../server/marketing";

/** Admin → Marketing → Offers: the sales (a % off for some days); list, add or change, remove (?id=). */
export const GET = route(async (req) => { await requireAdmin(req); return { offers: await listOffers() }; });
export const PUT = route(async (req) => { await requireAdmin(req); return saveOffer(await body(req, OfferIn)); });
export const DELETE = route(async (req) => { await requireAdmin(req); return deleteOffer(new URL(req.url).searchParams.get("id") ?? ""); });
