import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { deleteProfile, updateProfile, VoiceProfileIn } from "@/server/voice";

export const PATCH = route<{ voiceId: string }>(async (req, { voiceId }) => updateProfile(voiceId, await body(req, VoiceProfileIn)));
export const DELETE = route<{ voiceId: string }>(async (_req, { voiceId }) => { await deleteProfile(voiceId); return undefined; });
