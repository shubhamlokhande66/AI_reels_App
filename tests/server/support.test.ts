// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

/** After a purchase (the receipt), an unfinished checkout (one reminder), the Contact page (to the team with Reply-To, a
 * copy back with a ticket) and the Help chat (answers from the app's facts; off when switched off). No email leaves. */

const sent: { to: string; subject: string; text: string; html?: string; replyTo?: string }[] = [];
vi.mock("@/server/core/mail", async (orig) => ({
  ...(await orig<typeof import("@/server/core/mail")>()),
  sendMail: async (to: string, subject: string, text: string, html?: string, opts: { replyTo?: string } = {}) => { sent.push({ to, subject, text, html, replyTo: opts.replyTo }); return true; },
}));

let mongo: MongoMemoryServer;
let R: typeof import("@/server/receipts");
let Rem: typeof import("@/server/reminders");
let S: typeof import("@/server/support");
let mainDb: typeof import("@/server/core/db").mainDb;
let withUser: typeof import("@/server/core/auth").withUser;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "support_test";
  process.env.AUTH_ENABLED = "true";
  process.env.BILLING_ENABLED = "true";
  process.env.ADMIN_EMAILS = "boss@shop.com";
  R = await import("@/server/receipts");
  Rem = await import("@/server/reminders");
  S = await import("@/server/support");
  ({ mainDb } = await import("@/server/core/db"));
  ({ withUser } = await import("@/server/core/auth"));
}, 120_000);
afterAll(async () => {
  (await import("@/server/ai")).setProvider(null);
  await (await (await import("@/server/core/db")).client()).close();
  await mongo?.stop();
});
beforeEach(async () => {
  sent.length = 0;
  const d = await mainDb();
  for (const c of ["users", "wallets", "payments", "counters", "support_messages", "support_chats", "app_settings"]) await d.collection(c).deleteMany({});
});
async function user(email: string) {
  const _id = new ObjectId();
  await (await mainDb()).collection("users").insertOne({ _id, email, username: email.split("@")[0], createdAt: new Date() });
  return String(_id);
}
const pay = async (id: string, uid: string, o: Record<string, unknown> = {}) => (await mainDb()).collection("payments").insertOne({
  _id: id as never, userId: uid, item: { kind: "plan", plan: "creator", period: "monthly", label: "Editor plan · 1 month" }, itemKey: "plan:creator:monthly", amount: 14300, currency: "INR",
  status: "created", createdAt: new Date(), price: { base: 199, offer: { id: "o", title: "Diwali sale", percent: 20, off: 40 }, coupon: { code: "WELCOME10", off: 16, label: "" }, final: 143 }, ...o,
});

describe("receipts", () => {
  it("email one receipt per paid order, numbered in order, with the price, the discounts and the ids", async () => {
    const uid = await user("riya@x.com");
    await (await mainDb()).collection("wallets").insertOne({ _id: uid as never, plan: "creator", monthly: 250, extra: 10, planEnds: new Date("2026-11-26T10:00:00Z") });
    await pay("order_1", uid, { status: "paid", paymentId: "pay_1", paidAt: new Date() });
    await pay("order_2", uid, { status: "paid", paymentId: "pay_2", paidAt: new Date() });
    expect(await R.sendReceipt("order_1")).toBe(true);
    expect(await R.sendReceipt("order_1")).toBe(false); // the browser and the webhook: one receipt
    await R.sendReceipt("order_2");
    const mine = sent.filter((m) => m.to === "riya@x.com");
    expect(mine).toHaveLength(2);
    expect(mine[0].subject).toMatch(/receipt SHU-\d{4}-000001 · Editor plan · 1 month · ₹143/);
    expect(mine[1].subject).toMatch(/SHU-\d{4}-000002/);
    for (const s of ["₹199", "Diwali sale", "WELCOME10", "₹143", "pay_1", "order_1", "non-refundable", "260 credits"]) expect(mine[0].html).toContain(s);
    expect(await R.sendReceipt("order_unknown")).toBe(false);
  });
});

describe("unfinished checkouts", () => {
  it("remind once, a few hours later; never after a purchase; at most once a week", async () => {
    const a = await user("a@x.com"), b = await user("b@x.com"), c = await user("c@x.com");
    const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000);
    await pay("o_a", a, { createdAt: hoursAgo(5) });
    await pay("o_b", b, { createdAt: hoursAgo(5) });
    await pay("o_b2", b, { status: "paid", paidAt: hoursAgo(4), createdAt: hoursAgo(4) }); // bought after: no reminder
    await pay("o_c", c, { createdAt: hoursAgo(1) }); // too soon (3 hours by default)
    expect((await Rem.remindAbandoned()).sent).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["a@x.com"]);
    expect(sent[0].subject).toMatch(/Still thinking about Editor plan/);
    await pay("o_a2", a, { createdAt: hoursAgo(4) });
    expect((await Rem.remindAbandoned()).sent).toBe(0); // a reminded this week
    await (await mainDb()).collection("app_settings").insertOne({ _id: "marketing" as never, emails: { notes: true, cartReminder: false, cartHours: 3 } });
    await (await mainDb()).collection("payments").updateOne({ _id: "o_c" as never }, { $set: { createdAt: hoursAgo(6) } });
    expect((await Rem.remindAbandoned()).sent).toBe(0); // switched off
  });
});

describe("contact", () => {
  it("send the message to the team with Reply-To, keep it, and send the person a ticket", async () => {
    const r = await S.sendContact(S.ContactIn.parse({ email: "Help@Me.com", name: "Riya", topic: "payment", message: "I paid but my plan did not change." }));
    expect(r.ticket).toMatch(/^T-[0-9A-F]{6}$/);
    const team = sent.find((m) => m.to === "boss@shop.com");
    expect(team?.replyTo).toBe("help@me.com");
    expect(team?.subject).toContain(r.ticket);
    expect(sent.find((m) => m.to === "help@me.com")?.subject).toContain(r.ticket);
    const inbox = await S.supportInbox("open");
    expect(inbox).toMatchObject({ open: 1, messages: [{ id: r.ticket, topic: "payment", status: "open", account: null }] });
    await S.setMessageStatus(r.ticket, "done");
    expect((await S.supportInbox("open")).open).toBe(0);
    expect(() => S.ContactIn.parse({ email: "x@y.com", message: "short" })).toThrow();
  });
  it("thank a bot (the hidden field) without sending anything", async () => {
    await S.sendContact(S.ContactIn.parse({ email: "bot@spam.com", message: "Buy cheap followers now!!!", website: "http://spam" }));
    expect(sent).toHaveLength(0);
    expect((await S.supportInbox("all")).messages).toHaveLength(0);
  });
});

describe("help chat", () => {
  it("answers from the app's facts with the whole talk, logs the question, and is off when switched off", async () => {
    const seen: { system: string; messages: { role: string; content: string }[] }[] = [];
    (await import("@/server/ai")).setProvider({
      structured: async (system: string, _u: string, schema: { parse: (v: unknown) => unknown }, o: { messages: { role: string; content: string }[] }) => {
        seen.push({ system, messages: o.messages });
        return schema.parse({ answer: "A Music Reel uses 1 credit. [Pricing](/pricing)", needsHuman: false, suggestions: ["How do I get more credits?"] });
      },
    } as never);
    const uid = await user("chat@x.com");
    const r = await withUser(uid, () => S.helpChat(S.ChatIn.parse({ messages: [{ role: "assistant", content: "Hi!" }, { role: "user", content: "How much does a Reel cost?" }], page: "/pricing" })));
    expect(r).toMatchObject({ needsHuman: false, suggestions: ["How do I get more credits?"] });
    expect(seen[0].messages).toEqual([{ role: "user", content: "How much does a Reel cost?" }]); // starts with a question
    for (const f of ["Editor", "₹199", "CREDIT COSTS", "non-refundable", "6-digit code"]) expect(seen[0].system).toContain(f);
    expect(seen[0].system).toContain("free plan");
    expect((await S.supportInbox("open")).questions[0]).toMatchObject({ q: "How much does a Reel cost?", signedIn: true });
    await S.setSupport({ chat: false });
    await expect(S.helpChat(S.ChatIn.parse({ messages: [{ role: "user", content: "hi" }] }))).rejects.toThrow(/off/);
  });
  it("says so and points to Contact when the AI fails", async () => {
    (await import("@/server/ai")).setProvider({ structured: async () => { throw new Error("quota"); } } as never);
    const r = await S.helpChat(S.ChatIn.parse({ messages: [{ role: "user", content: "help" }] }));
    expect(r.needsHuman).toBe(true);
    expect(r.answer).toContain("/contact");
  });
});
