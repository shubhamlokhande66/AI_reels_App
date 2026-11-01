import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { listReels, startReel, StartIn } from "../../../../server/studio/reels";

/** My Reels (the finished Reels kept in the account) and how many the plan allows; POST starts saving one. */
export const GET = route(async () => listReels());
export const POST = route(async (req) => startReel(await body(req, StartIn)));
