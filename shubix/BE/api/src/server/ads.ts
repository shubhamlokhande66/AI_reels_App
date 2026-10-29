import type { ObjectId } from "mongodb";
import { db } from "./core/db";
import { ValidationFailed } from "./core/errors";

/** Ads for the plans that show them (Free by default: Admin → Plans & pricing → Ads), set in Admin → Settings → Ads:
 * on the website Google AdSense (publisher id + ad slot), in the phone app Google AdMob (a banner ad unit per platform);
 * without ids, the app's own card for the paid plans. Ads are shown on
 * Home and My Reels only: never in the editor (the editor's page is cross-origin isolated, and ads would get in the way). */
/** the pages with an ad spot (none in the editor): Home twice, My Reels, Invite & earn, My account */
export const AD_PLACES = ["home", "homeEnd", "reels", "rewards", "account"] as const;
export type AdPlace = (typeof AD_PLACES)[number];
/** AdMob banner ad units of the phone app ("ca-app-pub-1234567890123456/1234567890"); the app id itself is built into the
 * app (FE/mobile-app/app.config.ts) */
export interface AdMobConfig { android: string; ios: string }
export interface AdsConfig { enabled: boolean; client: string; slot: string; places: Record<AdPlace, boolean>; admob: AdMobConfig }
const ID = "ads" as unknown as ObjectId;
const DEF: AdsConfig = { enabled: true, client: "", slot: "", places: Object.fromEntries(AD_PLACES.map((p) => [p, true])) as Record<AdPlace, boolean>, admob: { android: "", ios: "" } };
const ADMOB_UNIT = /^ca-app-pub-\d{10,20}\/\d{6,14}$/;

export async function getAds(): Promise<AdsConfig> {
  const s = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as Partial<AdsConfig>;
  const places = Object.fromEntries(AD_PLACES.map((p) => [p, typeof s.places?.[p] === "boolean" ? s.places[p] : DEF.places[p]])) as Record<AdPlace, boolean>;
  return { enabled: s.enabled ?? DEF.enabled, client: s.client ?? "", slot: s.slot ?? "", places, admob: { android: s.admob?.android ?? "", ios: s.admob?.ios ?? "" } };
}
export async function setAds(p: Partial<Omit<AdsConfig, "admob">> & { admob?: Partial<AdMobConfig> }): Promise<AdsConfig> {
  const cur = await getAds(), next = { ...cur, ...p, places: { ...cur.places, ...(p.places ?? {}) }, admob: { ...cur.admob, ...(p.admob ?? {}) } };
  next.places = Object.fromEntries(AD_PLACES.map((k) => [k, !!next.places[k]])) as Record<AdPlace, boolean>;
  next.client = String(next.client || "").trim(); next.slot = String(next.slot || "").trim();
  if (next.client && !/^ca-pub-\d{10,20}$/.test(next.client)) throw new ValidationFailed("The AdSense publisher id looks like ca-pub-1234567890123456.", { code: "INVALID_ADS" });
  if (next.slot && !/^\d{6,14}$/.test(next.slot)) throw new ValidationFailed("The ad slot is a number (AdSense → Ads → By ad unit).", { code: "INVALID_ADS" });
  next.admob = { android: String(next.admob.android || "").trim(), ios: String(next.admob.ios || "").trim() };
  for (const unit of [next.admob.android, next.admob.ios]) if (unit && !ADMOB_UNIT.test(unit)) throw new ValidationFailed("An AdMob ad unit id looks like ca-app-pub-1234567890123456/1234567890 (AdMob → Apps → Ad units).", { code: "INVALID_ADS" });
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { ...next, updatedAt: new Date() } }, { upsert: true });
  return next;
}
