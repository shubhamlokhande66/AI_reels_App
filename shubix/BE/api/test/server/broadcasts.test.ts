// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

/** Admin → Messages: who gets a message (everyone, paying, free, affiliates), its emails (not to those who stopped them,
 * with the link to stop them), and each person's bell (only their messages; read on every device). */

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/core/mail", async (orig) => ({
  ...(await orig<typeof import("../../src/server/core/mail")>()),
  sendMail: async (to: string, subject: string, text: string) => { sent.push({ to, subject, text }); return true; },
}));

let mongo: MongoMemoryServer;
let B: typeof import("../../src/server/broadcasts");
let withUser: typeof import("../../src/server/core/auth").withUser;
let mainDb: typeof import("../../src/server/core/db").mainDb;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "broadcasts_test";
  process.env.AUTH_ENABLED = "true";
  process.env.SECRET_KEY = "test-secret-key-for-broadcasts";
  B = await import("../../src/server/broadcasts");
  ({ withUser } = await import("../../src/server/core/auth"));
  ({ mainDb } = await import("../../src/server/core/db"));
}, 120_000);

afterAll(async () => {
  const { client } = await import("../../src/server/core/db");
  await (await client()).close();
  await mongo?.stop();
});

beforeEach(async () => { sent.length = 0; const d = await mainDb(); for (const c of ["users", "wallets", "affiliates", "broadcasts"]) await d.collection(c).deleteMany({}); });

async function user(email: string, o: { plan?: string; partnerOnly?: boolean; affiliate?: boolean; emailsOff?: boolean } = {}) {
  const _id = new ObjectId(), d = await mainDb();
  await d.collection("users").insertOne({ _id, email, createdAt: new Date(), ...(o.partnerOnly ? { partnerOnly: true } : {}), ...(o.emailsOff ? { emailsOff: true } : {}) });
  if (o.plan) await d.collection("wallets").insertOne({ _id: String(_id) as never, plan: o.plan, monthly: 0, extra: 0 });
  if (o.affiliate) await d.collection("affiliates").insertOne({ _id: String(_id) as never, status: "active" });
  return String(_id);
}
const msg = (o: Partial<import("zod").infer<typeof import("../../src/server/broadcasts").BroadcastIn>> = {}) =>
  B.BroadcastIn.parse({ title: "Diwali offer", body: "30% off Pro\nthis week", link: "/pricing", button: "See plans", audience: "all", ...o });

describe("Admin → Messages", () => {
  it("counts and reaches each group; partner-only accounts are only affiliates", async () => {
    const free = await user("free@x.com"), pro = await user("pro@x.com", { plan: "pro" }), partner = await user("partner@x.com", { partnerOnly: true, affiliate: true });
    expect((await B.sendBroadcast(msg({ dryRun: true }))).people).toBe(2);
    expect((await B.sendBroadcast(msg({ audience: "paying", dryRun: true }))).people).toBe(1);
    expect((await B.sendBroadcast(msg({ audience: "free", dryRun: true }))).people).toBe(1);
    expect((await B.sendBroadcast(msg({ audience: "affiliates", dryRun: true }))).people).toBe(1);
    expect(await (await mainDb()).collection("broadcasts").countDocuments()).toBe(0); // counting sends nothing

    await B.sendBroadcast(msg({ audience: "paying", title: "For Pro" }));
    await B.sendBroadcast(msg({ title: "For all" }));
    expect((await withUser(pro, () => B.myNotifications())).items.map((i) => i.title)).toEqual(["For all", "For Pro"]);
    expect((await withUser(free, () => B.myNotifications())).items.map((i) => i.title)).toEqual(["For all"]);
    expect((await withUser(partner, () => B.myNotifications())).items).toEqual([]);
    expect(sent).toHaveLength(0); // no email unless asked
  });

  it("emails those who did not stop them, with a working link to stop them", async () => {
    const a = await user("a@x.com"); await user("b@x.com", { emailsOff: true });
    const r = await B.sendBroadcast(msg({ email: true }));
    expect(r).toMatchObject({ people: 2, emailed: 1, emailFailed: 0 });
    expect(sent.map((m) => m.to)).toEqual(["a@x.com"]);
    expect(sent[0].text).toContain("30% off Pro");
    const link = new URL(/Stop these emails: (\S+)/.exec(sent[0].text)![1]);
    expect(await B.unsubscribe(link.searchParams.get("u")!, "wrong-signature-123456")).toBe(false);
    expect(await B.unsubscribe(link.searchParams.get("u")!, link.searchParams.get("s")!)).toBe(true);
    expect((await (await mainDb()).collection("users").findOne({ _id: new ObjectId(a) }))?.emailsOff).toBe(true);
  });

  it("shows unread in the bell until read, and a removed message is gone", async () => {
    const a = await user("a@x.com");
    const { id } = await B.sendBroadcast(msg());
    expect((await withUser(a, () => B.myNotifications())).unread).toBe(1);
    await withUser(a, () => B.readNotifications());
    expect((await withUser(a, () => B.myNotifications())).unread).toBe(0);
    await B.deleteBroadcast(id!);
    expect((await withUser(a, () => B.myNotifications())).items).toEqual([]);
    expect(() => B.BroadcastIn.parse({ title: "Hi", body: "Hi", link: "javascript:alert(1)", audience: "all" })).toThrow(); // only app pages or https links
  });
});
