import { z } from "zod";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { linkClick } from "../../../../server/marketing";

/** A friend's or affiliate's link was opened (?ref=username): counted once per browser (public; rate-limited). */
export const POST = route(async (req) => { const p = await body(req, z.object({ ref: z.string().min(3).max(40) })); limits.clientError(req); return linkClick(p.ref); });
