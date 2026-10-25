import { body } from "@/server/core/body";
import { isPlanAdmin } from "@/server/core/admin";
import { route } from "@/server/core/http";
import { requirePlanItem } from "@/server/planLocks";
import { deleteProfile, updateProfile, VoiceProfileIn } from "@/server/voice";

export const PATCH = route<{ voiceId: string }>(async (req, { voiceId }) => {
  await requirePlanItem("page:voices", await isPlanAdmin(req));
  return updateProfile(voiceId, await body(req, VoiceProfileIn));
});
export const DELETE = route<{ voiceId: string }>(async (_req, { voiceId }) => { await deleteProfile(voiceId); return undefined; });
