import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { createProfile, listProfiles, VoiceProfileIn } from "@/server/voice";

export const GET = route(async () => listProfiles());
export const POST = route(async (req) => Response.json(await createProfile(await body(req, VoiceProfileIn)), { status: 201 }));
