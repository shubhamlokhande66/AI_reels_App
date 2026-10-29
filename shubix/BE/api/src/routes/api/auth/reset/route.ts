import { z } from "zod";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { reset, resetWithCode } from "../../../../server/accounts";
import { limits } from "../../../../server/core/rateLimit";

/** A new password with the 6-digit code from the reset email (or a reset link emailed before the codes). */
export const POST = route(async (req) => {
  const p = await body(req, z.union([
    z.object({ email: z.string().min(3).max(254), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."), password: z.string().min(1).max(200) }),
    z.object({ token: z.string().min(20).max(200), password: z.string().min(1).max(200) }),
  ]));
  limits.reset(req);
  return "code" in p ? resetWithCode(p.email, p.code, p.password) : reset(p.token, p.password);
});
