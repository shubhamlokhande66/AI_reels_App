import { z } from "zod";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { setUsername } from "../../../../server/marketing";

/** Choose my @username (unique; also my invite code). */
export const POST = route(async (req) => { const p = await body(req, z.object({ username: z.string().min(1).max(40) })); limits.account(req); return setUsername(p.username); });
