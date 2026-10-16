import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { EditsIn, recordEdits } from "@/server/studio/styles";

/** The changes a creator makes to an edit (transition / effect / speed of a shot), which the learned styles follow. */
export const POST = route(async (req) => recordEdits(await body(req, EditsIn)));
