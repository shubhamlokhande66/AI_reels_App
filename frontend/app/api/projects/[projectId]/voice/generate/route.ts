import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { generateVoice } from "@/server/voice";

/** Speak the script, then re-time the Reel to the real voice. */
export const POST = route<{ projectId: string }>(async (req, { projectId }) => {
  const p = req.headers.get("content-length") === "0" ? { voiceProfileId: null } : await body(req, z.object({ voiceProfileId: z.string().nullable().default(null) }).prefault({}));
  return generateVoice(projectId, p.voiceProfileId);
});
