import { route } from "../../../server/core/http";
import { currentOffer } from "../../../server/marketing";

/** The sale running now, for the banner and the pricing page (public; null when none). */
export const GET = route(async () => ({ offer: await currentOffer() }));
