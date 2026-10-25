import "server-only";
import type { ObjectId } from "mongodb";
import { db } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import { site as fromEnv } from "@/server/workspace";

/** The business details (Contact, Privacy, Terms, Refunds; Razorpay asks for a real email and address): the
 * administrator's (Admin → Settings → Business details), saved in app_settings, else the server's environment
 * (BUSINESS_NAME, SUPPORT_EMAIL, SUPPORT_PHONE, BUSINESS_ADDRESS, LEGAL_UPDATED). Cached for a few seconds. */
const ID = "site" as unknown as ObjectId;
const KEYS = ["businessName", "supportEmail", "supportPhone", "businessAddress", "legalUpdated"] as const;
type Site = Record<(typeof KEYS)[number], string>;
let cache: { at: number; value: Site } | null = null;

export async function getSite(): Promise<Site> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as Partial<Site>;
  const env = fromEnv() as Site, value = { ...env };
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
    const t = String(v).trim().slice(0, k === "businessAddress" ? 300 : 120);
    if (k === "supportEmail" && t && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) throw new ValidationFailed("That support email does not look right.", { code: "INVALID_SITE" });
    set[k] = t;
  }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { ...set, updatedAt: new Date() } }, { upsert: true });
  cache = null;
  return getSite();
}
