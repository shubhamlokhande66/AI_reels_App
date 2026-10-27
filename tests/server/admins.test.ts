// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";

/** Administrators: the owners (ADMIN_EMAILS, several) and the ones added in Admin → Settings; every one has everything
 * open (no credits taken, Shubix AI and every plan's pages). */

let mongo: MongoMemoryServer;
let Ad: typeof import("@/server/core/admin");
let C: typeof import("@/server/credits");
let withUser: typeof import("@/server/core/auth").withUser;
let mainDb: typeof import("@/server/core/db").mainDb;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "admins_test";
  process.env.BILLING_ENABLED = "true";
  process.env.AUTH_ENABLED = "true";
  process.env.ADMIN_EMAILS = "owner1@x.com, Owner2@x.com";
  Ad = await import("@/server/core/admin");
  C = await import("@/server/credits");
  ({ withUser } = await import("@/server/core/auth"));
  ({ mainDb } = await import("@/server/core/db"));
}, 120_000);

afterAll(async () => {
  const { client } = await import("@/server/core/db");
  await (await client()).close();
  await mongo?.stop();
});

beforeEach(async () => { const d = await mainDb(); for (const c of ["users", "app_settings", "wallets", "credit_ledger"]) await d.collection(c).deleteMany({}); });

async function user(email: string) {
  const _id = new ObjectId();
  await (await mainDb()).collection("users").insertOne({ _id, email, createdAt: new Date() });
  return String(_id);
}

describe("administrators", () => {
  it("are the owners (several) plus the ones added; owners cannot be removed here", async () => {
    const o2 = await user("owner2@x.com"), helper = await user("helper@x.com"), someone = await user("someone@x.com");
    expect(await Ad.isAdminUser(o2)).toBe(true);
    expect(await Ad.isAdminUser(helper)).toBe(false);
    const l = await Ad.addAdmin("Helper@X.com");
    expect(l.admins).toEqual([{ email: "owner1@x.com", owner: true }, { email: "owner2@x.com", owner: true }, { email: "helper@x.com", owner: false }]);
    expect(await Ad.isAdminUser(helper)).toBe(true);
    expect(await Ad.isAdminUser(someone)).toBe(false);
    await expect(Ad.removeAdmin("owner1@x.com")).rejects.toThrow(/ADMIN_EMAILS/);
    await Ad.removeAdmin("helper@x.com");
    expect(await Ad.isAdminUser(helper)).toBe(false);
    expect(await Ad.adminEmails()).toEqual(["owner1@x.com", "owner2@x.com"]);
  });

  it("are never charged credits (everything open), while others are", async () => {
    const admin = await user("owner1@x.com"), other = await user("free@x.com");
    expect(await withUser(admin, () => C.charge("studio_ai", "r1", "AI Reel"))).toBe(0);
    expect((await withUser(admin, () => C.chargeOnce("studio_ai", "r2", "AI Reel"))).taken).toBe(0);
    await expect(withUser(other, () => C.charge("studio_ai", "r3", "AI Reel"))).rejects.toThrow(/credit/);
  });
});
