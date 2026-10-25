// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The plans: Free has no Shubix AI; an AI Reel is charged once however many requests it makes; each chat change once;
 * the administrator can put a person on a plan; prices saved before these plans give way to them. */
type Doc = Record<string, unknown>;
const st = vi.hoisted(() => ({ user: "u1" as string | null, cols: new Map<string, Doc[]>() }));
const match = (d: Doc, q: Doc) => Object.entries(q).every(([k, v]) => {
  const x = d[k];
  if (v && typeof v === "object" && !(v instanceof Date)) { const o = v as Record<string, unknown>;
    if ("$lt" in o) return typeof x === "number" && x < (o.$lt as number);
    if ("$ne" in o) return x !== o.$ne; }
  return x === v;
});
const coll = (name: string) => {
  if (!st.cols.has(name)) st.cols.set(name, []);
  const L = st.cols.get(name)!;
  return {
    findOne: async (q: Doc) => L.find((d) => match(d, q)) ?? null,
    insertOne: async (d: Doc) => { L.push({ ...d }); },
    updateOne: async (q: Doc, u: { $set: Doc }, o?: { upsert?: boolean }) => { const d = L.find((x) => match(x, q)); if (d) Object.assign(d, u.$set); else if (o?.upsert) L.push({ ...q, ...u.$set }); },
    findOneAndUpdate: async (q: Doc, u: { $set?: Doc; $inc?: Record<string, number> }) => {
      const d = L.find((x) => match(x, q)); if (!d) return null;
      Object.assign(d, u.$set ?? {}); for (const [k, v] of Object.entries(u.$inc ?? {})) d[k] = Number(d[k] ?? 0) + v; return { ...d };
    },
    find: (q: Doc) => ({ sort: () => ({ limit: () => ({ toArray: async () => L.filter((d) => match(d, q)) }) }) }),
  };
};
vi.mock("@/server/core/db", () => ({ mainDb: async () => ({ collection: coll }), db: async () => ({ collection: coll }), ObjectId: String }));
vi.mock("@/server/core/auth", () => ({ currentUser: () => st.user, AuthRequired: Error }));
vi.mock("@/server/ai", () => ({ getProvider: () => ({}) }));
vi.mock("@/server/ai/config", () => ({ effective: () => ({}) }));
vi.mock("@/server/core/config", () => ({ settings: { billingEnabled: true, authEnabled: true, razorpayKeyId: "", razorpayKeySecret: "" }, env: () => "" }));

beforeEach(() => { st.cols.clear(); st.user = "u1"; });

describe("plans and Shubix AI credits", () => {
  it("has Free without AI, Editor and Pro with it, and an AI Reel at 10 credits", async () => {
    const { getPricing } = await import("@/server/workspace");
    const p = await getPricing();
    const by = Object.fromEntries(p.plans.map((x) => [x.id, x]));
    expect([by.free.ai, by.creator.ai, by.pro.ai]).toEqual([false, true, true]);
    expect([by.creator.name, by.creator.monthly, by.pro.monthly]).toEqual(["Editor", 199, 499]);
    expect(by.business.hidden).toBe(true);
    expect([p.costs.studio_ai, p.costs.studio_chat_small, p.costs.studio_chat_big]).toEqual([10, 1, 2]);
  });
  it("prices saved before the AI plans give way to them", async () => {
    st.cols.set("app_settings", [{ _id: "pricing", plans: [{ id: "free", name: "Free", monthly: 0, credits: 15 }], costs: { studio_ai: 0 } }]);
    const { getPricing } = await import("@/server/workspace");
    expect((await getPricing()).costs.studio_ai).toBe(10);
  });
  it("Free has no AI; a paid plan has; the administrator moves people between them", async () => {
    const { aiAllowed, setPlanByAdmin } = await import("@/server/credits");
    expect((await aiAllowed()).ok).toBe(false);
    await setPlanByAdmin("u1", "creator", 1);
    const a = await aiAllowed();
    expect([a.ok, a.balance]).toEqual([true, 250]);
    await setPlanByAdmin("u1", "free", 1);
    expect((await aiAllowed()).ok).toBe(false);
    expect((await aiAllowed(true)).ok).toBe(true); // the administrator always
  });
  it("charges an AI Reel once and each chat message once", async () => {
    const { chargeOnce, setPlanByAdmin, balanceNow } = await import("@/server/credits");
    await setPlanByAdmin("u1", "pro", 1);
    expect((await chargeOnce("studio_ai", "reelA", "AI Reel")).taken).toBe(10);
    expect((await chargeOnce("studio_ai", "reelA", "AI Reel")).taken).toBe(0); // more clips, the plan, a retry
    expect((await chargeOnce("studio_chat_small", "reelA:chat1", "chat")).taken).toBe(1);
    expect((await chargeOnce("studio_chat_small", "reelA:chat1", "chat")).taken).toBe(0);
    expect((await chargeOnce("studio_chat_big", "reelA:chat2", "chat")).taken).toBe(2);
    expect(await balanceNow()).toBe(720 - 13);
  });
});
