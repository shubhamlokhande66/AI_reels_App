// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

/** The partner dashboard (/affiliate): a Shubix user goes straight in; anyone else signs in with an emailed code (a
 * partner-only account, no password, its own cookie), asks to join, and once approved sees their dashboard. */

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/core/mail", async (orig) => ({
  ...(await orig<typeof import("../../src/server/core/mail")>()),
  sendMail: async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return true; },
}));

let mongo: MongoMemoryServer;
let P: typeof import("../../src/server/partner");
let M: typeof import("../../src/server/marketing");
let A: typeof import("../../src/server/accounts");
let withUser: typeof import("../../src/server/core/auth").withUser;
let mainDb: typeof import("../../src/server/core/db").mainDb;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "partner_test";
  process.env.AUTH_ENABLED = "true";
  process.env.SECRET_KEY = "test-secret-key-for-partner-sessions";
  P = await import("../../src/server/partner");
  M = await import("../../src/server/marketing");
  A = await import("../../src/server/accounts");
  ({ withUser } = await import("../../src/server/core/auth"));
  ({ mainDb } = await import("../../src/server/core/db"));
  const { ensureIndexes } = await import("../../src/server/core/indexes");
  await ensureIndexes();
}, 120_000);

afterAll(async () => {
  const { client } = await import("../../src/server/core/db");
  await (await client()).close();
  await mongo?.stop();
});

beforeEach(async () => {
  sent.length = 0;
  const d = await mainDb();
  for (const c of ["users", "affiliates", "partner_codes", "app_settings"]) await d.collection(c).deleteMany({});
});

const codeIn = (to: string) => /\b(\d{6})\b/.exec(sent.filter((m) => m.to === to).at(-1)!.subject)![1];
const req = (cookie = "") => new Request("http://x/api/partner/me", { headers: cookie ? { cookie } : {} });
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];

describe("partner dashboard", () => {
  it("signs in a new email by code (a partner-only account), then join → approve → dashboard", async () => {
    expect((await P.partnerMe(req())).via).toBeNull();
    await P.sendPartnerCode("Riya@X.com");
    await expect(P.sendPartnerCode("riya@x.com")).rejects.toThrow(/wait/); // a minute apart
    await expect(P.verifyPartnerCode("riya@x.com", "000000".replace(/0/g, (_, i) => String((Number(codeIn("riya@x.com")[i]) + 1) % 10)))).rejects.toThrow(/not right/);
    const r = await P.verifyPartnerCode("riya@x.com", codeIn("riya@x.com"));
    const cookie = cookieOf(r);
    expect(cookie).toMatch(/^partner_session=/);
    await expect(P.verifyPartnerCode("riya@x.com", codeIn("riya@x.com"))).rejects.toThrow(/expired|used/); // once

    const u = await (await mainDb()).collection("users").findOne({ email: "riya@x.com" });
    expect(u).toMatchObject({ partnerOnly: true, emailVerified: true, username: "riya" });
    expect(u!.password).toBeUndefined();

    const me = await P.partnerMe(req(cookie));
    expect(me).toMatchObject({ via: "partner", email: "riya@x.com", affiliate: null });
    await P.partnerApply(req(cookie), "Instagram @riya");
    expect((await M.listAffiliates())[0]).toMatchObject({ email: "riya@x.com", status: "pending", note: "Instagram @riya", partnerOnly: true });

    await M.updateAffiliate({ id: String(u!._id), status: "active" });
    const after = await P.partnerMe(req(cookie));
    expect(after.affiliate).toMatchObject({ status: "active", username: "riya" });
    await P.partnerPayout(req(cookie), { method: "upi", upi: "riya@okaxis" });
    expect((await M.affiliateDetail(String(u!._id), true)).payout).toMatchObject({ upi: "riya@okaxis" });
    const raw = await (await mainDb()).collection("affiliates").findOne({ _id: String(u!._id) as never });
    expect(JSON.stringify(raw)).not.toContain("riya@okaxis"); // encrypted in the database (server/core/sealed.ts)
    expect(raw!.payout).toMatchObject({ method: "upi", sealed: expect.stringMatching(/^v1\./) });
  });

  it("lets a Shubix user straight in (no code), and never opens the studio with the partner cookie", async () => {
    const _id = new ObjectId();
    await (await mainDb()).collection("users").insertOne({ _id, email: "sam@x.com", password: "x", createdAt: new Date() });
    const me = await withUser(String(_id), () => P.partnerMe(req()));
    expect(me).toMatchObject({ via: "shubix", email: "sam@x.com" });

    await P.sendPartnerCode("sam@x.com"); // the same person signed out: the code opens the same account
    const cookie = cookieOf(await P.verifyPartnerCode("sam@x.com", codeIn("sam@x.com")));
    expect(await (await mainDb()).collection("users").countDocuments({ email: "sam@x.com" })).toBe(1);
    const { resolveUser } = await import("../../src/server/core/auth");
    await expect(resolveUser(new Request("http://x/api/projects", { headers: { cookie } }))).rejects.toThrow(/sign in/i);
  });

  it("refuses requests signed out, and tells a partner-only email to set a password on the studio", async () => {
    await expect(P.partnerApply(req(), "")).rejects.toThrow(/email/);
    await P.sendPartnerCode("p@x.com");
    await P.verifyPartnerCode("p@x.com", codeIn("p@x.com"));
    await expect(A.login("p@x.com", "anything")).rejects.toThrow(/Forgot password/);
    await expect(A.register("p@x.com", "longenough1")).rejects.toThrow(/Forgot password/);
  });
});
