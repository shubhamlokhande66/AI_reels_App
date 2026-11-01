import { z } from "zod";
import { body } from "../../../../server/core/body";
import { route } from "../../../../server/core/http";
import { limits } from "../../../../server/core/rateLimit";
import { sendPartnerCode } from "../../../../server/partner";

/** The partner dashboard's sign-in: email a 6-digit code. */
export const POST = route(async (req) => {
  const p = await body(req, z.object({ email: z.string().trim().max(200) }));
  limits.forgot(req, p.email); // emails sent: a few per IP and per address
  return sendPartnerCode(p.email);
});
