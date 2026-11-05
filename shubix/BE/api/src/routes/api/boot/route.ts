import { adminState } from "../../../server/core/admin";
import { currentUser, sessionVerified } from "../../../server/core/auth";
import { settings } from "../../../server/core/config";
import { getFeatures } from "../../../server/core/features";
import { route } from "../../../server/core/http";
import { me } from "../../../server/accounts";
import { myCredits } from "../../../server/credits";
import { getLocks } from "../../../server/planLocks";
import { getSite } from "../../../server/site";
import { getTexts } from "../../../server/texts";
import { currentOffer } from "../../../server/marketing";
import { sweepSoon } from "../../../server/reminders";
import { getSupport } from "../../../server/support";
import { pricing } from "../../../server/workspace";
import { getContent } from "../../../server/content";
import { getAds } from "../../../server/ads";
import { myNotifications } from "../../../server/broadcasts";

/** A page's first read, in one request: what every page asks for when it opens (lib/boot.ts). Each part is exactly what
 * its own route answers; a part that fails, or that its route would refuse (credits, plan locks and features need a
 * signed-in person when accounts are on; plan locks and features are for everyone), is left out, and the page then asks its own route as before. */
export const GET = route(async (req) => {
  const uid = currentUser(), signedIn = !settings.authEnabled || (!!uid && (await sessionVerified(uid)));
  if (settings.billingEnabled) sweepSoon(); // unfinished checkouts' reminder emails, now and then, in the background
  const part = async <T,>(f: () => Promise<T> | T) => { try { return await f(); } catch { return undefined; } };
  const [texts, account, site, admin, features, planLocks, credits, offer, help, plans, content, ads, notifications] = await Promise.all([
    part(getTexts), part(me), part(getSite), part(() => adminState(req)),
    part(getFeatures), part(getLocks), signedIn ? part(myCredits) : undefined,
    part(async () => ({ offer: await currentOffer() })),
    part(async () => ({ on: (await getSupport()).chat })), part(pricing), part(getContent), signedIn ? part(getAds) : undefined, signedIn ? part(myNotifications) : undefined,
  ]);
  return { texts, me: account, site, admin, features, planLocks, credits, offer, help, plans, content, ads, notifications };
});
