// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

/** Administrators: the owners (ADMIN_EMAILS, several) and the ones added in Admin → Settings; every one has everything
 * open (no credits taken, Shubix AI and every plan's pages). */

const sent: { to: string; subject: string }[] = [];
vi.mock("@/server/core/mail", async (orig) => ({
  ...(await orig<typeof import("@/server/core/mail")>()),
  sendMail: async (to: string, subject: string) => { sent.push({ to, subject }); return true; },
}));

let mongo: MongoMemoryServer;
let Acc: typeof import("@/server/accounts");
let hashPassword: typeof import("@/server/core/auth").hashPassword;
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
  process.env.SECRET_KEY = "test-secret-key-for-admin-codes";
  Ad = await import("@/server/core/admin");
  C = await import("@/server/credits");
  Acc = await import("@/server/accounts");
  ({ withUser, hashPassword } = await import("@/server/core/auth"));
  ({ mainDb } = await import("@/server/core/db"));
}, 120_000);

afterAll(async () => {
  const { client } = await import("@/server/core/db");
  await (await client()).close();
  await mongo?.stop();
});

beforeEach(async () => { sent.length = 0; const d = await mainDb(); for (const c of ["users", "app_settings", "wallets", "credit_ledger"]) await d.collection(c).deleteMany({}); });

/** an account; admin: its daily admin code entered (until tomorrow) */
async function user(email: string, admin = true) {
  const _id = new ObjectId();
  await (await mainDb()).collection("users").insertOne({ _id, email, createdAt: new Date(), ...(admin ? { adminUntil: new Date(Date.now() + 864e5) } : {}) });
  return String(_id);
}
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
const req = (cookie: string) => new Request("http://x/api/admin/session", { headers: { cookie } });

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
    const due = await user("owner2@x.com", false); // an admin whose daily code is due: charged like everyone
    await expect(withUser(due, () => C.charge("studio_ai", "r4", "AI Reel"))).rejects.toThrow(/credit/);
  });

  it("ask an admin account for an emailed code at sign-in; the admin pages open only with it, for a day", async () => {
    const { resolveUser } = await import("@/server/core/auth");
    await (await mainDb()).collection("users").insertOne({ _id: new ObjectId(), email: "owner1@x.com", password: hashPassword("password123"), sessionVersion: 0, createdAt: new Date() });
    const login = await Acc.login("owner1@x.com", "password123");
    expect(await login.clone().json()).toMatchObject({ adminCode: true });
    const plain = cookieOf(login), r1 = req(plain);
    const uid = (await resolveUser(r1))!;
    expect(await withUser(uid, () => Ad.adminState(r1))).toEqual({ admin: false, required: true, otp: true }); // password alone: not yet
    const code = /(\d{6})/.exec(sent.find((m) => m.to === "owner1@x.com")!.subject)![1];
    await expect(withUser(uid, () => Acc.verifyAdminCode(code === "000000" ? "111111" : "000000"))).rejects.toThrow(/not right/);
    const ok = await withUser(uid, () => Acc.verifyAdminCode(code));
    const r2 = req(cookieOf(ok));
    expect(await withUser((await resolveUser(r2))!, () => Ad.adminState(r2))).toMatchObject({ admin: true, otp: false });
    expect(await Ad.isAdminUser(uid)).toBe(true);
    expect(await withUser(uid, () => Ad.isAdmin(r1))).toBe(false); // the old cookie still has no admin powers

    const normal = await (await mainDb()).collection("users").insertOne({ _id: new ObjectId(), email: "n@x.com", password: hashPassword("password123"), sessionVersion: 0, createdAt: new Date() });
    expect(await (await Acc.login("n@x.com", "password123")).json()).toMatchObject({ adminCode: false });
    await expect(withUser(String(normal.insertedId), () => Acc.sendAdminCode())).rejects.toThrow(/not an administrator/);
  });
});
