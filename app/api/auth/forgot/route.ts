import { z } from "zod";
import { body } from "@/server/core/body";
import { route } from "@/server/core/http";
import { forgot } from "@/server/accounts";
import { limits } from "@/server/core/rateLimit";

/** Email a link to choose a new password (the same answer whether or not the email has an account). */
export const POST = route(async (req) => {
  const { email } = await body(req, z.object({ email: z.string().min(3).max(254) }));
  limits.forgot(req, email); // no flood of reset emails
  return forgot(email);
});
