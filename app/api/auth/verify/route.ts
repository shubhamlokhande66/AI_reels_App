import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { verifyCode, verifyEmail } from "@/server/accounts";
import { limits } from "@/server/core/rateLimit";

/** Verify the email: the signed-in person's 6-digit code, or a "Verify my email" link emailed before the codes. */
export const POST = route(async (req) => {
  const p = await body(req, z.union([z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") }), z.object({ token: z.string().min(20).max(200) })]));
  limits.reset(req); // guessing codes: a few tries per IP, and CODE_TRIES per code
  return "code" in p ? verifyCode(p.code) : verifyEmail(p.token);
});
