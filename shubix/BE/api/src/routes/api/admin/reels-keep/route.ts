import { requireAdmin } from "../../../../server/core/admin";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { KeepIn, keepDays, LIMITS, setKeepDays } from "../../../../server/studio/reels";

/** Admin → Settings → My Reels: how many days a saved Reel is kept, per plan (0 = until deleted), and the Reels per plan. */
export const GET = route(async (req) => { await requireAdmin(req); return { days: await keepDays(), limits: LIMITS }; });
export const PUT = route(async (req) => { await requireAdmin(req); return { days: await setKeepDays(await body(req, KeepIn)), limits: LIMITS }; });
