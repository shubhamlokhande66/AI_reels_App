// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** An AI Reel whose plan never reached the server's answer (the app closed, the phone off, a step failed on the phone): its
 * credits come back by themselves. A Reel that got its plan keeps its charge; chat and mix charges have their own rules. */

let mongo: MongoMemoryServer;
let C: typeof import("../../src/server/credits");
let withUser: typeof import("../../src/server/core/auth").withUser;
let mainDb: typeof import("../../src/server/core/db").mainDb;
const USER = "u-sweep";
const as = <T>(fn: () => Promise<T>) => withUser(USER, fn);
const MIN = 60_000;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "sweep_test";
  process.env.AUTH_ENABLED = "true";
  process.env.BILLING_ENABLED = "true";
  C = await import("../../src/server/credits");
  ({ withUser } = await import("../../src/server/core/auth"));
  ({ mainDb } = await import("../../src/server/core/db"));
}, 120_000);
afterAll(async () => {
  await (await (await import("../../src/server/core/db")).client()).close();
  await mongo?.stop();
});
beforeEach(async () => {
  const d = await mainDb();
  await d.collection("wallets").deleteMany({}); await d.collection("credit_ledger").deleteMany({});
  await as(() => C.setPlanByAdmin(USER, "pro", 1));
});
const age = async (ref: string, at: Date) => (await mainDb()).collection("credit_ledger").updateOne({ ref, delta: { $lt: 0 } }, { $set: { at } });
const NOW = new Date("2026-12-01T12:00:00Z").getTime();

describe("credits of a Reel whose plan never came", () => {
  it("come back after 30 minutes, once", async () => {
    const before = await as(() => C.balanceNow());
    const a = await as(() => C.chargeOnce("studio_ai", "reelA", "Shubix AI Reel"));
    expect(a.taken).toBeGreaterThan(0);
    await age(a.ref, new Date(NOW - 31 * MIN));
    expect(await C.refundAbandoned(NOW)).toBe(1);
    expect(await as(() => C.balanceNow())).toBe(before);
    expect(await C.refundAbandoned(NOW)).toBe(0);
    expect(await as(() => C.balanceNow())).toBe(before);
  });
  it("stay while the AI may still be working", async () => {
    const a = await as(() => C.chargeOnce("studio_ai", "reelB", "Shubix AI Reel"));
    await age(a.ref, new Date(NOW - 10 * MIN));
    expect(await C.refundAbandoned(NOW)).toBe(0);
  });
  it("stay when the Reel got its plan", async () => {
    const a = await as(() => C.chargeOnce("studio_ai", "reelC", "Shubix AI Reel"));
    await as(() => C.markDelivered(a.ref));
    await age(a.ref, new Date(NOW - 60 * MIN));
    expect(await C.refundAbandoned(NOW)).toBe(0);
  });
  it("leave other charges alone, and charges from before this rule", async () => {
    const mix = await as(() => C.chargeOnce("studio_mix", "reelD:mix:1", "Change Reel"));
    await age(mix.ref, new Date(NOW - 60 * MIN));
    const old = await as(() => C.chargeOnce("studio_ai", "reelOld", "Shubix AI Reel"));
    await age(old.ref, new Date("2026-10-01T12:00:00Z"));
    expect(await C.refundAbandoned(NOW)).toBe(0);
  });
  it("a Reel tried again after its refund is charged again", async () => {
    const a = await as(() => C.chargeOnce("studio_ai", "reelE", "Shubix AI Reel"));
    await age(a.ref, new Date(NOW - 31 * MIN));
    await C.refundAbandoned(NOW);
    expect((await as(() => C.chargeOnce("studio_ai", "reelE", "Shubix AI Reel"))).taken).toBeGreaterThan(0);
  });
});
