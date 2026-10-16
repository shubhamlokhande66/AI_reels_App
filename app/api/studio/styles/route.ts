import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { listStyles, saveStyle, SaveIn } from "@/server/studio/styles";

/** Fast Studio's style library: my saved Reel styles (fingerprints only) and how many there are of each kind. */
export const GET = route(async () => listStyles());
export const POST = route(async (req) => saveStyle(await body(req, SaveIn)));
