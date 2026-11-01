import type { ObjectId } from "mongodb";
import { db } from "./core/db";
import { ValidationFailed } from "./core/errors";
import { site as fromEnv } from "./workspace";

/** The business details (Contact, Privacy, Terms, Refunds; Razorpay asks for a real email and address): the
 * administrator's (Admin → Settings → Business details), saved in app_settings, else the server's environment
 * (BUSINESS_NAME, SUPPORT_EMAIL, SUPPORT_PHONE, BUSINESS_ADDRESS, LEGAL_UPDATED). Cached for a few seconds. */
const ID = "site" as unknown as ObjectId;
const KEYS = ["businessName", "supportEmail", "supportPhone", "businessAddress", "legalUpdated", "playStoreUrl", "appStoreUrl", "gstin"] as const;
// the phone apps' store pages (Google Play, App Store): empty = "Coming soon" on the badges
const STORE_KEYS = new Set<string>(["playStoreUrl", "appStoreUrl"]);
type Site = Record<(typeof KEYS)[number], string>;
let cache: { at: number; value: Site } | null = null;

export async function getSite(): Promise<Site> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as Partial<Site>;
  const env = fromEnv() as Site, value: Site = Object.assign({ playStoreUrl: "", appStoreUrl: "", gstin: "" }, env);
  for (const k of KEYS) if (typeof saved[k] === "string" && saved[k]!.trim()) value[k] = saved[k]!.trim();
  cache = { at: Date.now(), value };
  return value;
}

/** Admin: change the details (an empty field goes back to the environment's value). */
export async function setSite(patch: Partial<Site>): Promise<Site> {
  const set: Partial<Site> = {};
  for (const k of KEYS) {
    const v = patch[k];
    if (v === undefined) continue;
    const t = String(v).trim().slice(0, k === "businessAddress" || STORE_KEYS.has(k) ? 300 : 120);
    if (k === "gstin" && t && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(t.toUpperCase())) throw new ValidationFailed("A GSTIN is 15 characters, like 27ABCDE1234F1Z5.", { code: "INVALID_SITE" });
    if (STORE_KEYS.has(k) && t && !/^https:\/\/[^\s"'<>]+$/i.test(t)) throw new ValidationFailed("A store link starts with https:// (copy it from the store page).", { code: "INVALID_SITE" });
    if (k === "supportEmail" && t && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) throw new ValidationFailed("That support email does not look right.", { code: "INVALID_SITE" });
    set[k] = k === "gstin" ? t.toUpperCase() : t;
  }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { ...set, updatedAt: new Date() } }, { upsert: true });
  cache = null;
  return getSite();
}
