import { body } from "@/server/core/body";
import { getFeatures, requireFeature } from "@/server/core/features";
import { route } from "@/server/core/http";
import { availability, RankIn, rankShots } from "@/server/studio/rankShots";

/** Fast Studio's AI shot picking: GET says whether the studio's AI is on (an AI provider is set up AND the administrator
 * turned on "Fast Studio AI"; people never choose) and its credit cost; POST scores the frames the phone sends (a few
 * small JPEGs per clip) and returns per-frame scores, roles, issues and subject boxes. */
export const GET = route(async () => {
  const a = await availability();
  return { ...a, available: !!a.available && (await getFeatures()).studioAI };
});
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  return rankShots(await body(req, RankIn));
});
