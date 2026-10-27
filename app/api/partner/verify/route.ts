import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { limits } from "@/server/core/rateLimit";
import { verifyPartnerCode } from "@/server/partner";

/** The partner dashboard's sign-in: the code from the email (signed in for 30 days). */
export const POST = route(async (req) => {
  const p = await body(req, z.object({ email: z.string().trim().max(200), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") }));
  limits.reset(req); // guessing codes: a few tries per IP, and 5 per code
  return verifyPartnerCode(p.email, p.code);
});
