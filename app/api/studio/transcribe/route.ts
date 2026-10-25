import { route } from "@/server/core/http";
import { isPlanAdmin } from "@/server/core/admin";
import { aiAllowed, requireAiPlan } from "@/server/credits";
import { availability, captionSong, LIMITS } from "@/server/studio/captions";
import { ValidationFailed } from "@/server/core/errors";

/** Fast Studio captions: GET says whether speech recognition is set up; POST takes the song as a 16 kHz mono WAV
 * (?lang=hi|mr|en|… or auto) and returns its words with their times. */
export const GET = route(async (req) => { const a = await availability(); return { ...a, planAi: (await aiAllowed(await isPlanAdmin(req))).ok }; });
export const POST = route(async (req) => {
  await requireAiPlan(await isPlanAdmin(req)); // captions are Shubix AI (Editor and Pro)
  const len = Number(req.headers.get("content-length") || 0);
  if (len > LIMITS.bytes) throw new ValidationFailed(`The audio must be at most ${LIMITS.seconds} s.`, { code: "CAPTIONS_AUDIO" });
  const wav = Buffer.from(await req.arrayBuffer());
  return captionSong(wav, new URL(req.url).searchParams.get("lang") ?? "");
});
