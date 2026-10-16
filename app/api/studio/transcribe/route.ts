import { route } from "@/server/core/http";
import { availability, captionSong, LIMITS } from "@/server/studio/captions";
import { ValidationFailed } from "@/server/core/errors";

/** Fast Studio captions: GET says whether speech recognition is set up; POST takes the song as a 16 kHz mono WAV
 * (?lang=hi|mr|en|… or auto) and returns its words with their times. */
export const GET = route(async () => availability());
export const POST = route(async (req) => {
  const len = Number(req.headers.get("content-length") || 0);
  if (len > LIMITS.bytes) throw new ValidationFailed(`The audio must be at most ${LIMITS.seconds} s.`, { code: "CAPTIONS_AUDIO" });
  const wav = Buffer.from(await req.arrayBuffer());
  return captionSong(wav, new URL(req.url).searchParams.get("lang") ?? "");
});
