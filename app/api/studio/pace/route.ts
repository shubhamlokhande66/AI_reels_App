import { isAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { chargeOnce, requireAiPlan } from "@/server/credits";
import { requireFeature } from "@/server/core/features";
import { route } from "@/server/core/http";
import { recordRun, taste } from "@/server/studio/brain";
import { pace, PaceIn } from "@/server/studio/direct";
import { limits } from "@/server/core/rateLimit";

/** Fast Studio's AI director, first decision: how fast to cut in each section of the song (every 1, 2, 4 or 8 beats).
 * The phone then places the cuts on the real beats. */
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  await requireAiPlan(await isAdmin(req));
  limits.ai(req); // each AI call costs money
  const d = await body(req, PaceIn), t0 = Date.now();
  if (d.reelId) await chargeOnce("studio_ai", d.reelId, "Shubix AI Reel");
  try {
    const res = await pace(d, undefined, await taste());
    recordRun({ kind: "pace", cuts: d.sections.length, mode: d.mode, provider: res.provider, model: res.model, ms: Date.now() - t0, ok: true });
    return res;
  } catch (e) {
    recordRun({ kind: "pace", cuts: d.sections.length, mode: d.mode, provider: "", model: "", ms: Date.now() - t0, ok: false });
    throw e;
  }
});
