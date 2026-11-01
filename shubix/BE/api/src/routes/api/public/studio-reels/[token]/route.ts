import { route } from "../../../../../server/core/http";
import { publicReel } from "../../../../../server/studio/reels";

/** A Reel someone shared from My Reels: anyone with the link can watch it (?download saves it). */
export const GET = route<{ token: string }>(async (req, { token }) => publicReel(req, token));
