// @vitest-environment node
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";

/** Marketing (Admin → Marketing): usernames, invites (both get credits, once, after the step the admin chose), sending
 * credits to a friend (limits; plan credits stay), prices with offers and coupons (every rule), affiliate commissions. */

let mongo: MongoMemoryServer;
let M: typeof import("../../src/server/marketing");
let C: typeof import("../../src/server/credits");
let withUser: typeof import("../../src/server/core/auth").withUser;
let mainDb: typeof import("../../src/server/core/db").mainDb;

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "marketing_test";
  process.env.BILLING_ENABLED = "true";
  process.env.AUTH_ENABLED = "true";
  M = await import("../../src/server/marketing");
  C = await import("../../src/server/credits");
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
  const d = await mainDb();
  for (const c of ["users", "wallets", "credit_ledger", "referrals", "coupons", "coupon_uses", "offers", "affiliates", "affiliate_earnings", "affiliate_payouts", "credit_transfers", "payments", "app_settings", "link_clicks"])
    await d.collection(c).deleteMany({});
});

async function user(email: string) {
  const _id = new ObjectId();
  await (await mainDb()).collection("users").insertOne({ _id, email, createdAt: new Date() });
  return String(_id);
}
const as = <T>(uid: string, fn: () => Promise<T>) => withUser(uid, fn);
const balance = async (uid: string) => { const w = await C.wallet(uid); return { monthly: Number(w.monthly ?? 0), extra: Number(w.extra ?? 0) }; };

describe("usernames", () => {
  it("are made from the email, unique, and can be changed (checked)", async () => {
    const a = await user("sam.k@x.com"), b = await user("sam.k@y.com");
    expect(await M.ensureUsername(a)).toBe("sam.k");
    const nb = await M.ensureUsername(b);
    expect(nb).not.toBe("sam.k");
    expect(nb.startsWith("sam.k")).toBe(true);
    expect(await M.ensureUsername(a)).toBe("sam.k"); // kept
    await expect(as(b, () => M.setUsername("sam.k"))).rejects.toThrow(/taken/);
    await expect(as(b, () => M.setUsername("x"))).rejects.toThrow(/3 to 20/);
    await expect(as(b, () => M.setUsername("admin"))).rejects.toThrow(/taken/);
    expect((await as(b, () => M.setUsername("@Sammy_Reels"))).username).toBe("sammy_reels");
    expect((await M.userByUsername("SAMMY_REELS"))?.id).toBe(b);
  });
});

describe("invites", () => {
  it("the friend's gift once they verify, the inviter's once the friend pays (the defaults); each once; never yourself", async () => {
    const inviter = await user("ana@x.com"), friend = await user("raj@x.com");
    await M.ensureUsername(inviter);
    await M.noteReferral(friend, "ana", C.grantCredits);
    const start = (await balance(friend)).extra, startI = (await balance(inviter)).extra;
    expect((await balance(friend)).extra).toBe(start); // signed up: not yet
    await M.rewardFor(friend, "verified", C.grantCredits);
    expect((await balance(friend)).extra).toBe(start + 10); // the friend's welcome gift
    expect((await balance(inviter)).extra).toBe(startI);    // the inviter waits for a purchase
    await M.rewardFor(friend, "purchase", C.grantCredits);
    expect((await balance(inviter)).extra).toBe(startI + 20);
    expect((await balance(friend)).extra).toBe(start + 10); // not twice
    await M.rewardFor(friend, "purchase", C.grantCredits);  // a second purchase: nothing more
    expect((await balance(inviter)).extra).toBe(startI + 20);
    const self = await user("solo@x.com"), name = await M.ensureUsername(self);
    await M.noteReferral(self, name, C.grantCredits);
    expect(await (await mainDb()).collection("referrals").countDocuments({ _id: self as never })).toBe(0);
  });
  it("follows the administrator: rewards at sign-up, and the inviter's monthly cap", async () => {
    const s = await M.getMarketing();
    await M.setMarketing({ ...s, referral: { ...s.referral, inviteeOn: "signup", inviterOn: "signup", monthlyCap: 1 } });
    const inviter = await user("lee@x.com"); await M.ensureUsername(inviter);
    const a = await user("a1@x.com"), b = await user("b1@x.com"), i0 = (await balance(inviter)).extra;
    await M.noteReferral(a, "lee", C.grantCredits);
    await M.noteReferral(b, "lee", C.grantCredits);
    expect((await balance(inviter)).extra).toBe(i0 + 20); // the second is over this month's cap
    expect((await balance(b)).extra).toBeGreaterThan((await balance(await user("c1@x.com"))).extra); // the friend still gets theirs
  });
});

describe("sending credits", () => {
  it("moves top-up credits to a friend, within the limits; a plan's credits stay", async () => {
    const a = await user("al@x.com"), b = await user("bo@x.com");
    const na = await M.ensureUsername(a), nb = await M.ensureUsername(b); // "al" and "bo" are short: "aluser", "bouser"
    await C.adjustCredits(a, 100 - (await balance(a)).extra, "test"); // 100 extra
    const b0 = (await balance(b)).extra;
    const r = await as(a, () => C.sendCredits("@" + nb, 30));
    expect(r.sent).toBe(30);
    expect((await balance(a)).extra).toBe(70);
    expect((await balance(b)).extra).toBe(b0 + 30);
    await expect(as(a, () => C.sendCredits(nb, 500))).rejects.toThrow(/between/);
    await expect(as(a, () => C.sendCredits(na, 5))).rejects.toThrow(/yourself/);
    await expect(as(a, () => C.sendCredits("nobody_here", 5))).rejects.toThrow(/No one/);
    const s = await M.getMarketing();
    await M.setMarketing({ ...s, share: { ...s.share, dailyMax: 40 } });
    await expect(as(a, () => C.sendCredits(nb, 20))).rejects.toThrow(/a day/);
    await (await mainDb()).collection("wallets").updateOne({ _id: a as never }, { $set: { monthly: 250, extra: 0 } });
    await M.setMarketing({ ...s, share: { ...s.share, dailyMax: 1000 } });
    await expect(as(a, () => C.sendCredits(nb, 5))).rejects.toThrow(/monthly credits stay/);
  });
});

describe("prices: offers and coupons", () => {
  const plan = { kind: "plan", rupees: 499 }, topup = { kind: "topup", rupees: 99 };
  it("takes the best live offer for the item, then a coupon; never under ₹1", async () => {
    await M.saveOffer({ title: "Diwali", banner: "", percent: 20, appliesTo: "plans", audience: "all", active: true });
    await M.saveOffer({ title: "Small", banner: "", percent: 5, appliesTo: "all", audience: "all", active: true });
    await M.saveOffer({ title: "Ended", banner: "", percent: 50, appliesTo: "all", audience: "all", active: true, ends: new Date(Date.now() - 1000).toISOString() });
    const q1 = await M.quote(null, plan);
    expect([q1.offer?.title, q1.final]).toEqual(["Diwali", 399]);
    expect((await M.quote(null, topup)).offer?.title).toBe("Small");
    await M.saveCoupon({ code: "save10", kind: "percent", value: 10, appliesTo: "all", audience: "all", minAmount: 0, maxUses: 0, perUserOnce: true, active: true, note: "" });
    const q2 = await M.quote(null, plan, "SAVE10");
    expect([q2.coupon?.code, q2.final]).toEqual(["SAVE10", 359]); // 499 − 20% = 399.2, − 10% = 359.28
    await M.saveCoupon({ code: "BIG", kind: "flat", value: 5000, appliesTo: "all", audience: "all", minAmount: 0, maxUses: 0, perUserOnce: false, active: true, note: "" });
    expect((await M.quote(null, topup, "big")).final).toBe(1);
  });
  it("checks every coupon rule and says why a code does not apply", async () => {
    const u = await user("cou@x.com");
    const base = { kind: "percent" as const, value: 10, audience: "all" as const, minAmount: 0, maxUses: 0, perUserOnce: true, active: true, note: "" };
    await M.saveCoupon({ ...base, code: "PLANS", appliesTo: "plans" });
    await M.saveCoupon({ ...base, code: "MIN500", appliesTo: "all", minAmount: 500 });
    await M.saveCoupon({ ...base, code: "ONE", appliesTo: "all", maxUses: 1 });
    await M.saveCoupon({ ...base, code: "NEWBIE", appliesTo: "all", audience: "new" });
    await M.saveCoupon({ ...base, code: "OFF", appliesTo: "all", active: false });
    expect((await M.quote(u, topup, "NOPE")).couponError).toMatch(/not valid/);
    expect((await M.quote(u, topup, "OFF")).couponError).toMatch(/not valid/);
    expect((await M.quote(u, topup, "PLANS")).couponError).toMatch(/plans only/);
    expect((await M.quote(u, topup, "MIN500")).couponError).toMatch(/₹500/);
    expect((await M.quote(u, plan, "ONE")).couponError).toBe("");
    await M.couponUsed("ONE", u, "order1", 50);
    await M.couponUsed("ONE", u, "order1", 50); // the same order twice: counted once
    expect((await M.quote(await user("other@x.com"), plan, "ONE")).couponError).toMatch(/used up/);
    expect((await M.quote(u, plan, "NEWBIE")).couponError).toBe("");
    await (await mainDb()).collection("payments").insertOne({ _id: "p1" as never, userId: u, status: "paid" });
    expect((await M.quote(u, plan, "NEWBIE")).couponError).toMatch(/first purchase/);
    await M.saveCoupon({ ...base, code: "ONCE", appliesTo: "all" });
    await M.couponUsed("ONCE", u, "order2", 10);
    expect((await M.quote(u, plan, "ONCE")).couponError).toMatch(/already/);
  });
});

describe("Shubix AI on Free", () => {
  it("credits pay for the AI Reel on Free when the admin allows it; captions stay with the plans", async () => {
    const u = await user("freebie@x.com");
    await C.wallet(u);
    await (await mainDb()).collection("wallets").updateOne({ _id: u as never }, { $set: { plan: "free", monthly: 0, extra: 20 } });
    expect((await as(u, () => C.aiAllowed(false, { credits: true }))).ok).toBe(true); // the AI Reel, Ask Shubix
    expect((await as(u, () => C.aiAllowed(false))).ok).toBe(false);                   // captions, translation
    await (await mainDb()).collection("wallets").updateOne({ _id: u as never }, { $set: { extra: 0 } });
    await expect(as(u, () => C.requireAiPlan(false, { credits: true }))).rejects.toThrow(/invit/);
    const s = await M.getMarketing();
    await M.setMarketing({ ...s, ai: { freeWithCredits: false } });
    await (await mainDb()).collection("wallets").updateOne({ _id: u as never }, { $set: { extra: 50 } });
    expect((await as(u, () => C.aiAllowed(false, { credits: true }))).ok).toBe(false);
  });
});

describe("affiliates", () => {
  it("earn their % on what the people they brought pay; the admin marks it paid", async () => {
    const aff = await user("pro@x.com"), buyer = await user("buy@x.com");
    await M.ensureUsername(aff);
    await M.noteReferral(buyer, "pro", C.grantCredits);
    await M.affiliateCommission(buyer, "o1", 499); // not an affiliate yet: nothing
    expect(await (await mainDb()).collection("affiliate_earnings").countDocuments({})).toBe(0);
    await as(aff, () => M.applyAffiliate());
    await M.updateAffiliate({ id: aff, status: "active", percent: 25 });
    await M.affiliateCommission(buyer, "o2", 400);
    await M.affiliateCommission(buyer, "o2", 400); // the same order again: once
    const list = await M.listAffiliates();
    expect(list[0]).toMatchObject({ id: aff, status: "active", percent: 25, brought: 1, due: 100, sales: 1 });
    expect((await M.markAffiliatePaid(aff, "UPI")).total).toBe(100);
    expect((await M.listAffiliates())[0]).toMatchObject({ due: 0, paid: 100 });
    await expect(M.markAffiliatePaid(aff, "")).rejects.toThrow(/Nothing is due/);
  });
  it("follow each affiliate's own link end date and months", async () => {
    const aff = await user("own@x.com"), early = await user("early@x.com"), late = await user("late@x.com");
    await M.ensureUsername(aff);
    await M.noteReferral(early, "own", C.grantCredits);
    await M.updateAffiliate({ id: aff, status: "active", percent: 10, validUntil: new Date(Date.now() + 1000).toISOString() });
    await new Promise((r) => setTimeout(r, 1200)); // the link has ended now
    await M.noteReferral(late, "own", C.grantCredits);
    await M.affiliateCommission(early, "e1", 100); // joined before the end: counts
    await M.affiliateCommission(late, "l1", 100);  // joined after: nothing
    expect((await M.listAffiliates()).find((x) => x.id === aff)).toMatchObject({ due: 10, sales: 1 });
    await (await mainDb()).collection("referrals").updateOne({ _id: early as never }, { $set: { at: new Date(Date.now() - 70 * 86400_000) } });
    await M.updateAffiliate({ id: aff, months: 2, validUntil: null }); // two months: a customer from 70 days ago no longer counts
    await M.affiliateCommission(early, "e2", 100);
    expect((await M.listAffiliates()).find((x) => x.id === aff)).toMatchObject({ due: 10, sales: 1 });
  });
  it("show the affiliate their dashboard (no emails) and the admin everything; clicks count", async () => {
    const aff = await user("dash@x.com"), buyer = await user("cust@x.com");
    await M.ensureUsername(aff); await M.ensureUsername(buyer);
    await M.linkClick("dash"); await M.linkClick("dash"); await M.linkClick("nobody-here");
    await M.noteReferral(buyer, "dash", C.grantCredits);
    expect(await as(aff, () => M.myAffiliateDashboard())).toEqual({ affiliate: null });
    await as(aff, () => M.applyAffiliate());
    await M.updateAffiliate({ id: aff, status: "active", percent: 20 });
    await M.affiliateCommission(buyer, "d1", 500);
    const mine = (await as(aff, () => M.myAffiliateDashboard())).affiliate!;
    expect(mine).toMatchObject({ username: "dash", status: "active", percent: 20, stats: { clicks: 2, clicks30: 2, customers: 1, buyers: 1, sales: 1, revenue: 500, due: 100, paid: 0 } });
    expect(mine.email).toBeUndefined();
    expect(mine.customers[0]).toMatchObject({ username: "cust", paid: 500, commission: 100 });
    expect(mine.customers[0].email).toBeUndefined();
    expect(mine.link).toContain("?ref=dash");
    const full = await M.affiliateDetail(aff, true);
    expect(full).toMatchObject({ email: "dash@x.com", customers: [{ email: "cust@x.com" }], sales: [{ customer: "cust", commission: 100, status: "due" }] });
    await M.markAffiliatePaid(aff, "UPI ref 1");
    expect((await M.affiliateDetail(aff, true)).payouts[0]).toMatchObject({ total: 100, count: 1, note: "UPI ref 1" });
    expect((await M.affiliateDetail(aff, false)).payouts[0].note).toBe("UPI ref 1"); // the partner sees the reference too
    await expect(M.affiliateDetail(buyer, true)).rejects.toThrow(/No such affiliate/);
  });

  it("keep payout details (checked; the partner sees the account's last 4), pay once even on two clicks, and only for real accounts", async () => {
    const aff = await user("payme@x.com"), buyer = await user("b2@x.com");
    await M.ensureUsername(aff);
    await M.noteReferral(buyer, "payme", C.grantCredits);
    await expect(as(aff, () => M.setPayoutDetails({ method: "upi", upi: "me@okaxis" }))).rejects.toThrow(/join the affiliate program first/);
    await as(aff, () => M.applyAffiliate());
    expect(() => M.PayoutIn.parse({ method: "upi", upi: "not a upi" })).toThrow();
    expect(() => M.PayoutIn.parse({ method: "bank", name: "A B", account: "12ab", ifsc: "SBIN0001234" })).toThrow();
    expect(() => M.PayoutIn.parse({ method: "bank", name: "A B", account: "123456789012", ifsc: "SBIN1001234" })).toThrow();
    await as(aff, () => M.setPayoutDetails(M.PayoutIn.parse({ method: "bank", name: "Asha Rao", account: "123456789012", ifsc: "sbin0001234" })));
    expect((await M.affiliateDetail(aff, false)).payout).toMatchObject({ method: "bank", account: "•••• 9012", ifsc: "SBIN0001234" });
    expect((await M.affiliateDetail(aff, true)).payout).toMatchObject({ method: "bank", name: "Asha Rao", account: "123456789012" });
    expect((await M.listAffiliates()).find((x) => x.id === aff)?.payout).toBe(true);

    await M.updateAffiliate({ id: aff, status: "active", percent: 10 });
    const since = (await M.affiliateDetail(aff, true)).since;
    await M.updateAffiliate({ id: aff, status: "paused" });
    await new Promise((r) => setTimeout(r, 20));
    await M.updateAffiliate({ id: aff, status: "active" });
    expect(new Date((await M.affiliateDetail(aff, true)).since!).getTime()).toBe(new Date(since!).getTime()); // "partner since" kept
    await expect(M.updateAffiliate({ id: new ObjectId().toHexString(), status: "active" })).rejects.toThrow(/No such account/);

    await M.affiliateCommission(buyer, "p1", 1000);
    await M.affiliateCommission(buyer, "p2", 500);
    const both = await Promise.allSettled([M.markAffiliatePaid(aff, "UTR 1"), M.markAffiliatePaid(aff, "UTR 2")]);
    const paid = both.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ total: number }>).value.total);
    expect(paid.reduce((t, n) => t + n, 0)).toBe(150); // ₹150 due, paid once in all
    expect(await (await mainDb()).collection("affiliate_payouts").countDocuments({ affiliateId: aff })).toBe(paid.length);
  });
});

describe("Ads and the store links", () => {
  it("each ad spot can be switched off; ads.txt follows the publisher id", async () => {
    const A = await import("../../src/server/ads");
    expect(Object.values((await A.getAds()).places).every(Boolean)).toBe(true);
    await A.setAds({ places: { account: false } as never });
    const a = await A.getAds();
    expect(a.places).toMatchObject({ home: true, homeEnd: true, reels: true, rewards: true, account: false });
    const { GET } = await import("../../src/routes/ads.txt/route");
    expect((await GET()).status).toBe(404);
    await A.setAds({ client: "ca-pub-1234567890123456" });
    expect(await (await GET()).text()).toBe("google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n");
    // the phone app: AdMob ad units, checked, and /app-ads.txt from their publisher id
    const app = await import("../../src/routes/app-ads.txt/route");
    expect(await (await app.GET()).text()).toBe("google.com, pub-5459735473283681, DIRECT, f08c47fec0942fa0\n"); // the built-in units
    await expect(A.setAds({ admob: { android: "ca-app-pub-123/1" } as never })).rejects.toThrow(/AdMob/);
    await A.setAds({ admob: { android: "ca-app-pub-9876543210987654/1234567890" } as never });
    expect((await A.getAds()).admob).toMatchObject({ android: "ca-app-pub-9876543210987654/1234567890", ios: "", rewarded: "ca-app-pub-5459735473283681/5578697445", rewardCredits: 2 });
    expect(await (await app.GET()).text()).toBe("google.com, pub-9876543210987654, DIRECT, f08c47fec0942fa0\n");
  });
  it("gives rewarded-ad credits only for AdMob's signed call, once per transaction, up to the daily number", async () => {
    const crypto = await import("node:crypto"), { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = publicKey.export({ type: "spki", format: "pem" }).toString(), real = globalThis.fetch;
    globalThis.fetch = (async () => Response.json({ keys: [{ keyId: 7, pem }] })) as typeof fetch;
    try {
      const { GET } = await import("../../src/routes/api/public/admob-reward/route");
      const uid = new ObjectId().toString(), start = (await balance(uid)).extra;
      const call = (tx: string, sign = true) => {
        const q = `ad_network=1&ad_unit=5578697445&reward_amount=1&reward_item=credits&timestamp=1&transaction_id=${tx}&user_id=${uid}`;
        const sig = crypto.sign("sha256", Buffer.from(q), privateKey).toString("base64url");
        return GET(new Request(`https://api.test/api/public/admob-reward?${q}&signature=${sign ? sig : sig.slice(2)}&key_id=7`), { params: Promise.resolve({}) });
      };
      expect((await call("t0", false)).status).toBe(200); // AdMob's unsigned check: answered, nothing given
      for (const tx of ["t1", "t1", "t2", "t3", "t4", "t5", "t6"]) expect((await call(tx)).status).toBe(200);
      expect((await balance(uid)).extra).toBe(start + 2 * 5); // 2 each, t1 once, 5 a day
    } finally { globalThis.fetch = real; }
  });
  it("keeps the app store links (https only); empty means Coming soon", async () => {
    const S = await import("../../src/server/site");
    expect(await S.getSite()).toMatchObject({ playStoreUrl: "", appStoreUrl: "" });
    await expect(S.setSite({ playStoreUrl: "javascript:alert(1)" })).rejects.toThrow(/https/);
    await S.setSite({ playStoreUrl: "https://play.google.com/store/apps/details?id=app.shubix" });
    expect((await S.getSite()).playStoreUrl).toBe("https://play.google.com/store/apps/details?id=app.shubix");
    await S.setSite({ playStoreUrl: "" });
    expect((await S.getSite()).playStoreUrl).toBe("");
  });
});
