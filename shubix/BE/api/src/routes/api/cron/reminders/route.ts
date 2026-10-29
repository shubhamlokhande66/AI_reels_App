import { settings } from "../../../../server/core/config";
import { route } from "../../../../server/core/http";
import { NotFoundError } from "../../../../server/core/errors";
import { remindAbandoned } from "../../../../server/reminders";
import crypto from "node:crypto";

/** A scheduler's call (Cloudflare cron, cron-job.org…) with the header `x-cron-secret: CRON_SECRET`: send the unfinished
 * checkouts' reminders now. Without CRON_SECRET this route does not exist (the reminders still go out as people use the site). */
export const POST = route(async (req) => {
  const key = req.headers.get("x-cron-secret") ?? "", secret = settings.cronSecret;
  if (!secret || key.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(secret))) throw new NotFoundError("Not found.");
  return remindAbandoned();
});
