import { z } from "zod";
import { body } from "../../../../../server/core/body";
import { route } from "../../../../../server/core/http";
import { previewProfile } from "../../../../../server/voice";
import { isPlanAdmin } from "../../../../../server/core/admin";
import { requirePlanItem } from "../../../../../server/planLocks";

export const POST = route<{ voiceId: string }>(async (req, { voiceId }) => {
  await requirePlanItem("page:voices", await isPlanAdmin(req));
  const p = req.headers.get("content-length") === "0" ? { text: null } : await body(req, z.object({ text: z.string().max(200).nullable().default(null) }).prefault({}));
  return new Response(new Uint8Array(await previewProfile(voiceId, p.text)), { headers: { "Content-Type": "audio/wav" } });
});
