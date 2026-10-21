import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { SuggestIn, suggestStyle } from "@/server/studio/styles";

/** A Reel a creator copied ("Copy a Reel"), offered to the administrator to teach the styles (its fingerprint only). */
export const POST = route(async (req) => suggestStyle(await body(req, SuggestIn)));
