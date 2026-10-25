import { route } from "@/server/core/http";
import { getAds } from "@/server/ads";

/** Public: whether ads are on and the AdSense ids (which plans see them: the pricing's `ads` flag). */
export const GET = route(async () => getAds());
