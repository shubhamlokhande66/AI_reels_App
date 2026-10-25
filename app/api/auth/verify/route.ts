import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { verifyEmail } from "@/server/accounts";
import { limits } from "@/server/core/rateLimit";

/** The "Verify my email" link from the sign-up email: marks the account's email as checked (the link works once). */
export const POST = route(async (req) => { const p = await body(req, z.object({ token: z.string().min(20).max(200) })); limits.reset(req); return verifyEmail(p.token); });
