import type { ObjectId } from "mongodb";
import { db } from "./core/db";
import { ValidationFailed } from "./core/errors";
import { applyOverrides, DEFAULT_LOCKS, needMap, PLAN_NAME, planRank, PLANS, type LockOverrides, type PlanId } from "@shubix/core/lib/plan-locks";
import { aiAllowed, PlanNeeded } from "./credits";

/** What each plan unlocks in Fast Studio: the defaults (lib/plan-locks.ts) with the administrator's changes. */
const ID = "plan_locks" as unknown as ObjectId;
export async function getLocks() {
  const saved = (await (await db()).collection("app_settings").findOne({ _id: ID })) as LockOverrides | null;
  return applyOverrides(saved);
}
const KEYS = new Set(DEFAULT_LOCKS.groups.flatMap((g) => g.items.map((it) => `${g.id}:${it.key}`)));
export async function setLocks(o: LockOverrides) {
  const items: Record<string, PlanId> = {};
  for (const [k, v] of Object.entries(o.items ?? {})) {
    if (!KEYS.has(k)) throw new ValidationFailed(`Unknown item "${k}".`, { code: "INVALID_LOCKS" });
    if (!PLANS.includes(v)) throw new ValidationFailed(`Unknown plan "${v}".`, { code: "INVALID_LOCKS" });
    items[k] = v;
  }
  const ex: LockOverrides["export"] = {};
  for (const p of PLANS) { const r = o.export?.[p]; if (!r) continue;
    ex[p] = { ...(r.maxRes && ["720", "1080", "4k"].includes(r.maxRes) ? { maxRes: r.maxRes } : {}), ...(typeof r.fps60 === "boolean" ? { fps60: r.fps60 } : {}), ...(typeof r.noWatermark === "boolean" ? { noWatermark: r.noWatermark } : {}) }; }
  await (await db()).collection("app_settings").updateOne({ _id: ID }, { $set: { items, export: ex, updatedAt: new Date() } }, { upsert: true });
  return getLocks();
}

/** A page's tools on the server (lib/plan-locks.ts "page:…", e.g. the brand kit is Pro): a lower plan gets a 402 with the
 * plan it needs. Billing off and the administrator: open. */
export async function requirePlanItem(key: string, admin = false) {
  const a = await aiAllowed(admin);
  if (!a.plan && a.ok) return; // billing off, or the administrator
  const need = needMap(await getLocks())[key] as PlanId | undefined;
  if (need && planRank(need) > planRank(a.plan)) throw new PlanNeeded(`This is in the ${PLAN_NAME[need]} plan. Upgrade to use it.`, { plan: a.plan, need });
}
