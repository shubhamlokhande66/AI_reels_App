import { z } from "zod";
import { body } from "../../../../../server/core/body";
import { route } from "../../../../../server/core/http";
import { limits } from "../../../../../server/core/rateLimit";
import { verifyAdminCode } from "../../../../../server/accounts";

/** The administrator's daily code: entered, this session opens the administration for a day. */
export const POST = route(async (req) => {
  const p = await body(req, z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") }));
  limits.reset(req); // guessing codes: a few tries per IP, and 5 per code
  return verifyAdminCode(p.code);
});
