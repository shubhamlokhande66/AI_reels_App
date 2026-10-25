import { isPlanAdmin } from "@/server/core/admin";
import { body } from "@/server/core/body";
import { aiAllowed, aiCosts, balanceNow, requireAiPlan } from "@/server/credits";
import { getFeatures, requireFeature } from "@/server/core/features";
import { route } from "@/server/core/http";
import { availability, RankIn, rankShots } from "@/server/studio/rankShots";
import { limits } from "@/server/core/rateLimit";

/** Fast Studio's AI shot picking: GET says whether the studio's AI is on (an AI provider is set up AND the administrator
 * turned on "Fast Studio AI"; people never choose) and its credit cost; POST scores the frames the phone sends (a few
 * small JPEGs per clip) and returns per-frame scores, roles, issues and subject boxes. */
export const GET = route(async (req) => {
  const a = await availability(), admin = await isPlanAdmin(req), p = await aiAllowed(admin);
  // planAi: this person's plan has Shubix AI (Free: the phone edits); costs and balance for the phone's confirmations
  return { ...a, available: !!a.available && ((await getFeatures()).studioAI || admin), planAi: p.ok, plan: p.plan, planName: p.planName, balance: p.balance, freeChats: p.freeChats, costs: await aiCosts() };
});
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  await requireAiPlan(await isPlanAdmin(req));
  limits.ai(req); // each AI call costs money
  const res = await rankShots(await body(req, RankIn));
  return { ...res, balance: await balanceNow() };
});
