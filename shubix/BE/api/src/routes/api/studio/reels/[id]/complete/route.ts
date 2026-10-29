import { body } from "../../../../../../server/core/body";
import { route } from "../../../../../../server/core/http";
import { CompleteIn, completeReel } from "../../../../../../server/studio/reels";

/** The upload is finished: the parts are joined and checked, and the Reel is in My Reels. */
export const POST = route<{ id: string }>(async (req, { id }) => completeReel(id, (await body(req, CompleteIn)).parts));
