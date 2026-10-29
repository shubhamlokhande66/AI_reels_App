import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setTexts } from "../../../../server/texts";

const TextsIn = z.record(z.string(), z.string().max(2000).nullable());

/** Change texts or put their defaults back (administrator only). */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  return setTexts(await body(req, TextsIn));
});
