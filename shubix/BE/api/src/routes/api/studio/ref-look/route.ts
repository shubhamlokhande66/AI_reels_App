import { isPlanAdmin } from "../../../../server/core/admin";
import { requireAiPlan } from "../../../../server/credits";
import { body } from "../../../../server/core/body";
import { requireFeature } from "../../../../server/core/features";
import { route } from "../../../../server/core/http";
import { LookIn, refLook } from "../../../../server/studio/refLook";
import { limits } from "../../../../server/core/rateLimit";

/** "Copy a Reel": the texts, stickers, captions and background of a reference Reel, read by the AI from ~10 small frames
 * the phone sends. On only when the administrator turned on Fast Studio AI (GET /api/studio/rank-shots says so). */
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  await requireAiPlan(await isPlanAdmin(req));
  limits.ai(req); // each AI call costs money
  return refLook(await body(req, LookIn));
});
