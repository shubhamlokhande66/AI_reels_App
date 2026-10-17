import "server-only";
import type { ObjectId } from "mongodb";
import { DEFAULTS, FEATURE_LIST, type FeatureKey, type Features } from "@/lib/features-list";
import { isAdmin } from "./admin";
import { db } from "./db";
import { AppError, ValidationFailed } from "./errors";

/** Which parts of the app are on (Administration → Features), saved in app_settings. Only Fast Studio is on until the
 * administrator turns a server part on (lib/features-list.ts DEFAULTS). Cached for a few seconds: it is read on every guarded request. */
const ID = "features" as unknown as ObjectId;
let cache: { at: number; value: Features } | null = null;

export async function getFeatures(): Promise<Features> {
  if (cache && Date.now() - cache.at < 5000) return cache.value;
  const saved = ((await (await db()).collection("app_settings").findOne({ _id: ID })) ?? {}) as Record<string, unknown>;
  const value = { ...DEFAULTS };
  for (const f of FEATURE_LIST) if (typeof saved[f.key] === "boolean") value[f.key] = saved[f.key] as boolean;
  cache = { at: Date.now(), value };
  return value;
}

export async function setFeatures(patch: Partial<Features>): Promise<Features> {
  const clean: Partial<Features> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!FEATURE_LIST.some((f) => f.key === k) || typeof v !== "boolean") throw new ValidationFailed(`Unknown feature: ${k}`, { code: "INVALID_FEATURE" });
    clean[k as FeatureKey] = v;
  }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { ...clean, updatedAt: new Date() } }, { upsert: true });
  cache = null;
  return getFeatures();
}

/** A hidden feature's work is refused (the administrator can still use it, e.g. to check it before turning it on). */
export async function requireFeature(req: Request, key: FeatureKey) {
  if ((await getFeatures())[key] || isAdmin(req)) return;
  const label = FEATURE_LIST.find((f) => f.key === key)?.label ?? key;
  throw new AppError(`${label} is turned off in this studio.`, { code: "FEATURE_OFF", status: 403 });
}
