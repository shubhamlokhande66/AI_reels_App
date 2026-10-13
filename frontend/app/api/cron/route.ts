import crypto from "node:crypto";
import { AuthRequired } from "@/server/core/auth";
import { settings } from "@/server/core/config";
import { route } from "@/server/core/http";
import { runDuePosts } from "@/server/publish";
import { sweep } from "@/server/workspace";

/** The scheduler's tick (Cloudflare cron, cloudflare/src/index.ts): the auto-delete sweep and the scheduled posts that are
 * due. A container that sleeps when idle cannot keep its own timers, so they run here. Needs CRON_SECRET. */
export const POST = route(async (req) => {
  const key = req.headers.get("x-cron-key") ?? "", want = settings.cronSecret;
  if (!want || key.length !== want.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(want))) throw new AuthRequired("Not allowed.", "CRON_FORBIDDEN");
  const [deleted, posted] = await Promise.all([sweep(), runDuePosts()]);
  return { ok: true, deleted, posted };
});
