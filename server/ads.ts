import "server-only";
import type { ObjectId } from "mongodb";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";

/** Ads for the plans that show them (Free by default: Admin → Plans & pricing → Ads). Google AdSense when its publisher id
 * and ad slot are set here (Admin → Settings → Ads); otherwise the app's own card for the paid plans. Ads are shown on
 * Home and My Reels only: never in the editor (the editor's page is cross-origin isolated, and ads would get in the way). */
export interface AdsConfig { enabled: boolean; client: string; slot: string }
const ID = "ads" as unknown as ObjectId;
const DEF: AdsConfig = { enabled: true, client: "", slot: "" };

export async function getAds(): Promise<AdsConfig> {
  const s = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as Partial<AdsConfig>;
  return { enabled: s.enabled ?? DEF.enabled, client: s.client ?? "", slot: s.slot ?? "" };
}
export async function setAds(p: Partial<AdsConfig>): Promise<AdsConfig> {
  const cur = await getAds(), next = { ...cur, ...p };
  next.client = String(next.client || "").trim(); next.slot = String(next.slot || "").trim();
  if (next.client && !/^ca-pub-\d{10,20}$/.test(next.client)) throw new ValidationFailed("The AdSense publisher id looks like ca-pub-1234567890123456.", { code: "INVALID_ADS" });
  if (next.slot && !/^\d{6,14}$/.test(next.slot)) throw new ValidationFailed("The ad slot is a number (AdSense → Ads → By ad unit).", { code: "INVALID_ADS" });
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { ...next, updatedAt: new Date() } }, { upsert: true });
  return next;
}
