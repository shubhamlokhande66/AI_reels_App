import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setContent } from "../../../../server/content";

const ContentIn = z.record(z.string(), z.array(z.record(z.string(), z.unknown())).nullable());

/** Save lists, or put their first items back (administrator only). */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  return setContent(await body(req, ContentIn));
});
