import { adminRequired, isAdmin } from "@/server/core/admin";
import { currentUser } from "@/server/core/auth";
import { settings } from "@/server/core/config";
import { getFeatures } from "@/server/core/features";
import { route } from "@/server/core/http";
import { me } from "@/server/accounts";
import { myCredits } from "@/server/credits";
import { getLocks } from "@/server/planLocks";
import { getSite } from "@/server/site";
import { getTexts } from "@/server/texts";
import { currentOffer } from "@/server/marketing";
import { sweepSoon } from "@/server/reminders";

/** A page's first read, in one request: what every page asks for when it opens (lib/boot.ts). Each part is exactly what
 * its own route answers; a part that fails, or that its route would refuse (credits, plan locks and features need a
 * signed-in person when accounts are on), is left out, and the page then asks its own route as before. */
export const GET = route(async (req) => {
  const signedIn = !settings.authEnabled || !!currentUser();
  if (settings.billingEnabled) sweepSoon(); // unfinished checkouts' reminder emails, now and then, in the background
  const part = async <T,>(f: () => Promise<T> | T) => { try { return await f(); } catch { return undefined; } };
  const [texts, account, site, admin, features, planLocks, credits, offer] = await Promise.all([
    part(getTexts), part(me), part(getSite), part(async () => ({ admin: await isAdmin(req), required: adminRequired() })),
    signedIn ? part(getFeatures) : undefined, signedIn ? part(getLocks) : undefined, signedIn ? part(myCredits) : undefined,
    part(async () => ({ offer: await currentOffer() })),
  ]);
  return { texts, me: account, site, admin, features, planLocks, credits, offer };
});
