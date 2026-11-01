import { route } from "../../../../server/core/http";
import { startConvert } from "../../../../server/studio/convert";

/** Fast Studio: a clip the browser cannot open (camera ProRes / 4:2:2, old codecs) as the raw file body (?to=webm for a
 * browser without H.264); starts converting it and answers { id } at once. Signed-in users only. */
export const POST = route(async (req) => startConvert(req));
