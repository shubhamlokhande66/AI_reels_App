import { body } from "../../../server/core/body";
import { isPlanAdmin } from "../../../server/core/admin";
import { route } from "../../../server/core/http";
import { requirePlanItem } from "../../../server/planLocks";
import { createProfile, listProfiles, VoiceProfileIn } from "../../../server/voice";

/** Voice profiles (each person's own): a plan's page (lib/plan-locks.ts "page:voices", Pro by default). Listing stays
 * open (a brand shows its voice); making one needs the plan. */
export const GET = route(async () => listProfiles());
export const POST = route(async (req) => {
  await requirePlanItem("page:voices", await isPlanAdmin(req));
  return Response.json(await createProfile(await body(req, VoiceProfileIn)), { status: 201 });
});
