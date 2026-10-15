import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { availability, RankIn, rankShots } from "@/server/studio/rankShots";

/** Fast Studio's optional AI shot picking: GET says whether it is available (and its credit cost), POST scores the
 * frames the phone sends (a few small JPEGs per clip) and returns per-frame scores, roles, issues and subject boxes. */
export const GET = route(async () => availability());
export const POST = route(async (req) => rankShots(await body(req, RankIn)));
