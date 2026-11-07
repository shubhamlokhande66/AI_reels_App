import { isPlanAdmin } from "../../../../server/core/admin";
import { canChargeOnce, requireAiPlan } from "../../../../server/credits";
import { requireFeature } from "../../../../server/core/features";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { ValidationFailed } from "../../../../server/core/errors";
import { hearSong, LIMITS } from "../../../../server/studio/song";

/** Shubix AI hears a short sample of the song (16 kHz mono WAV) before it edits; part of the AI Reel, no credits of its own. */
export const POST = route(async (req) => {
  await requireFeature(req, "studioAI");
  await requireAiPlan(await isPlanAdmin(req), { credits: true });
  limits.ai(req); // each AI call costs money
  if (Number(req.headers.get("content-length") || 0) > LIMITS.bytes) throw new ValidationFailed("The song sample is too long.", { code: "SONG_SAMPLE" });
  const reel = new URL(req.url).searchParams.get("reel") ?? "";
  if (/^[\w-]{6,64}$/.test(reel)) await canChargeOnce("studio_ai", reel);
  return hearSong(Buffer.from(await req.arrayBuffer()));
});
