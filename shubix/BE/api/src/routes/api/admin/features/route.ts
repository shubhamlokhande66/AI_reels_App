import { z } from "zod";
import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { setFeatures } from "../../../../server/core/features";

const FeaturesIn = z.record(z.string(), z.boolean());

/** Turn parts of the app on or off (administrator only). */
export const PUT = route(async (req) => {
  await requireAdmin(req);
  return setFeatures(await body(req, FeaturesIn));
});
