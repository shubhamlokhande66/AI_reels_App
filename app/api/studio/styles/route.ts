import { body } from "@/server/core/body";
import { requireAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { listStyles, saveStyle, SaveIn } from "@/server/studio/styles";

/** Fast Studio's style library: my saved Reel styles (fingerprints only) and how many there are of each kind. Only the
 * administrator teaches it (saves a style); creators' Reels reach it through the administrator (styles/suggest). */
export const GET = route(async () => listStyles());
export const POST = route(async (req) => { await requireAdmin(req); return saveStyle(await body(req, SaveIn)); });
