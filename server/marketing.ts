import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { currentUser, AuthRequired } from "@/server/core/auth";
import { settings } from "@/server/core/config";
import { mainDb, ObjectId } from "@/server/core/db";
import { ConflictError, NotFoundError, ValidationFailed } from "@/server/core/errors";
import { mailAdmins, mailUser } from "@/server/core/mail";

/** Marketing, all of it set by the administrator (Admin → Marketing): invite rewards (both sides get credits), sending
 * credits to a friend by @username, affiliates (a commission on what the people they brought pay), coupon codes and
 * offers (a sale). Prices are always worked out here, never trusted from the browser. */

type Doc = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const SETTINGS_ID = "marketing";

// ------------------------------------------------------------------ the administrator's settings
export const MarketingIn = z.object({
  referral: z.object({
    on: z.boolean(), inviterCredits: z.number().int().min(0).max(10000), inviteeCredits: z.number().int().min(0).max(10000),
    inviteeOn: z.enum(["signup", "verified", "purchase"]), inviterOn: z.enum(["signup", "verified", "purchase"]), monthlyCap: z.number().int().min(0).max(10000),
  }),
  share: z.object({ on: z.boolean(), min: z.number().int().min(1).max(100000), max: z.number().int().min(1).max(100000), dailyMax: z.number().int().min(1).max(1000000), source: z.enum(["extra", "all"]) }),
  affiliate: z.object({ on: z.boolean(), percent: z.number().min(0).max(90), months: z.number().int().min(1).max(120), minPayout: z.number().int().min(0).max(10000000), applyOpen: z.boolean() }),
  ai: z.object({ freeWithCredits: z.boolean() }).default({ freeWithCredits: true }),
  emails: z.object({ notes: z.boolean(), cartReminder: z.boolean().default(true), cartHours: z.number().int().min(1).max(72).default(3) }).default({ notes: true, cartReminder: true, cartHours: 3 }),
});
export type Marketing = z.infer<typeof MarketingIn>;
export const MARKETING_DEFAULTS: Marketing = {
  // both sides get credits once the friend has verified their email (a fake email gets nothing); 20 friends a month at most
  // the friend's welcome gift once they verify their email; the inviter's reward once the friend makes a first purchase
  // (real revenue pays for it, so fake accounts earn the inviter nothing); 20 rewarded invites a month at most
  referral: { on: true, inviterCredits: 20, inviteeCredits: 10, inviteeOn: "verified", inviterOn: "purchase", monthlyCap: 20 },
  // only top-up and gift credits can be sent (a plan's monthly credits stay with the plan)
  share: { on: true, min: 1, max: 200, dailyMax: 500, source: "extra" },
  // a commission on every payment the people they brought make in their first 12 months; paid out by hand from ₹500
  affiliate: { on: true, percent: 20, months: 12, minPayout: 500, applyOpen: true },
  // Free users spend their credits (invites, gifts, top-ups) on Shubix AI: an AI Reel and Ask Shubix, charged as on any
  // plan. Captions, translation and the Editor / Pro tools stay with those plans.
  ai: { freeWithCredits: true },
  // email notes: affiliate approved / paused / paid, credits received, invite rewards, new affiliate requests (to the
  // admins). Off: people see them in the app only. Sign-up and password codes are always emailed.
  emails: { notes: true, cartReminder: true, cartHours: 3 }, // + one reminder 3 hours after an unfinished checkout
};
export async function getMarketing(): Promise<Marketing> {
  const d = (await (await col("app_settings")).findOne({ _id: SETTINGS_ID })) as (Partial<Marketing> & { referral?: { rewardOn?: Marketing["referral"]["inviteeOn"] } }) | null;
  const old = d?.referral?.rewardOn;
  if (d?.referral && old) d.referral = Object.assign({ inviteeOn: old, inviterOn: old }, d.referral);
  return { referral: { ...MARKETING_DEFAULTS.referral, ...(d?.referral ?? {}) }, share: { ...MARKETING_DEFAULTS.share, ...(d?.share ?? {}) }, affiliate: { ...MARKETING_DEFAULTS.affiliate, ...(d?.affiliate ?? {}) },
    ai: { ...MARKETING_DEFAULTS.ai, ...(d?.ai ?? {}) }, emails: { ...MARKETING_DEFAULTS.emails, ...(d?.emails ?? {}) } };
}
export async function setMarketing(m: Marketing) {
  if (m.share.min > m.share.max) throw new ValidationFailed("The smallest amount to send is more than the largest.", { code: "INVALID_MARKETING" });
  await (await col("app_settings")).updateOne({ _id: SETTINGS_ID }, { $set: { ...m, updatedAt: new Date() } }, { upsert: true });
  return getMarketing();
}

// ------------------------------------------------------------------ usernames (unique; also the invite code)
const USERNAME = /^[a-z0-9](?:[a-z0-9._]{1,18}[a-z0-9])$/;
const RESERVED = new Set(["admin", "administrator", "shubix", "support", "help", "root", "system", "official", "team", "billing", "payments", "api", "www", "mail"]);
const uidObj = (uid: string) => { if (!ObjectId.isValid(uid)) throw new NotFoundError("No such account.", { code: "USER_NOT_FOUND" }); return new ObjectId(uid); };
export function cleanUsername(s: string) { return s.trim().replace(/^@/, "").toLowerCase(); }
/** A user's username, made from their email the first time (sam.k@… → "sam.k", then "sam.k7", "sam.k42" if taken). */
export async function ensureUsername(uid: string): Promise<string> {
  const users = await col("users"), u = await users.findOne({ _id: uidObj(uid) }, { projection: { username: 1, email: 1 } });
  if (!u) throw new NotFoundError("No such account.", { code: "USER_NOT_FOUND" });
  if (u.username) return String(u.username);
  let base = String(u.email ?? "user").split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").replace(/^[._]+|[._]+$/g, "").slice(0, 16);
  if (base.length < 3 || RESERVED.has(base)) base = (base + "user").slice(0, 16);
  for (let i = 0; i < 25; i++) {
    const name = i === 0 ? base : `${base}${crypto.randomInt(i < 5 ? 10 : i < 15 ? 1000 : 100000)}`;
    if (!USERNAME.test(name)) continue;
    try { const r = await users.updateOne({ _id: u._id, username: { $exists: false } }, { $set: { username: name } }); if (r.modifiedCount) return name; const again = await users.findOne({ _id: u._id }, { projection: { username: 1 } }); if (again?.username) return String(again.username); }
    catch (e) { if ((e as { code?: number }).code !== 11000) throw e; } // taken: try another
  }
  throw new ConflictError("Could not make a username. Choose one in My account.", { code: "USERNAME_FAILED" });
}
export async function setUsername(name0: string) {
  const uid = currentUser(); if (!uid) throw new AuthRequired();
  const name = cleanUsername(name0);
  if (!USERNAME.test(name)) throw new ValidationFailed("Use 3 to 20 letters, numbers, dots or underscores (not at the start or end).", { code: "INVALID_USERNAME" });
  if (RESERVED.has(name)) throw new ConflictError("That username is taken. Try another.", { code: "USERNAME_TAKEN" });
  try { await (await col("users")).updateOne({ _id: uidObj(uid) }, { $set: { username: name } }); }
  catch (e) { if ((e as { code?: number }).code === 11000) throw new ConflictError("That username is taken. Try another.", { code: "USERNAME_TAKEN" }); throw e; }
  return { username: name };
}
export async function userByUsername(name: string): Promise<{ id: string; username: string } | null> {
  const u = await (await col("users")).findOne({ username: cleanUsername(name) }, { projection: { username: 1 } });
  return u ? { id: String(u._id), username: String(u.username) } : null;
}

// ------------------------------------------------------------------ invites: both get credits
const RANK = { signup: 0, verified: 1, purchase: 2 } as const;
type Grant = (userId: string, credits: number, reason: string, ref: string) => Promise<void>;
/** A new account that came with ?ref=username: who invited them is kept, then the rewards follow (rewardFor). */
export async function noteReferral(inviteeId: string, ref: string | undefined, grant: Grant) {
  const m = await getMarketing();
  if (!ref || !m.referral.on) return;
  const inviter = await userByUsername(ref);
  if (!inviter || inviter.id === inviteeId) return; // no such person, or yourself
  try { await (await col("referrals")).insertOne({ _id: inviteeId, inviterId: inviter.id, at: new Date(), inviteeRewarded: false, inviterRewarded: false }); } catch { return; } // already noted
  await (await col("users")).updateOne({ _id: uidObj(inviteeId) }, { $set: { referredBy: inviter.id } });
  await rewardFor(inviteeId, "signup", grant);
}
/** The invite's rewards, once: when the friend reaches the step the administrator chose (signed up, verified, paid). */
/** An invite's two rewards, each once and on its own step (Admin → Marketing): the friend's (default: once they verify
 * their email) and the inviter's (default: once the friend makes a first purchase). The inviter's month cap counts. */
export async function rewardFor(inviteeId: string, event: keyof typeof RANK, grant: Grant) {
  const m = await getMarketing(); if (!m.referral.on) return;
  const refs = await col("referrals"), r = await refs.findOne({ _id: inviteeId });
  if (!r) return;
  const names = async () => {
    const list = await (await col("users")).find({ _id: { $in: [uidObj(String(r.inviterId)), uidObj(inviteeId)] } }, { projection: { username: 1 } }).toArray();
    return (id: string) => `@${list.find((u) => String(u._id) === id)?.username ?? "a friend"}`;
  };
  // (an invite rewarded before the two steps were split counts as both rewarded)
  const notYet = (field: string) => ({ _id: inviteeId, [field]: { $ne: true }, rewarded: { $ne: true } });
  if (RANK[event] >= RANK[m.referral.inviteeOn] && m.referral.inviteeCredits) {
    const claimed = await refs.findOneAndUpdate(notYet("inviteeRewarded"), { $set: { inviteeRewarded: true, inviteeRewardedAt: new Date(), inviteeCredits: m.referral.inviteeCredits } });
    if (claimed) await grant(inviteeId, m.referral.inviteeCredits, `Welcome gift: invited by ${(await names())(String(r.inviterId))}`, `ref:${inviteeId}:invitee`);
  }
  if (RANK[event] >= RANK[m.referral.inviterOn]) {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const thisMonth = await refs.countDocuments({ inviterId: r.inviterId, inviterRewarded: true, inviterRewardedAt: { $gte: monthStart } });
    const gets = m.referral.monthlyCap && thisMonth >= m.referral.monthlyCap ? 0 : m.referral.inviterCredits; // over the month's cap: nothing for this one
    const claimed = await refs.findOneAndUpdate(notYet("inviterRewarded"), { $set: { inviterRewarded: true, inviterRewardedAt: new Date(), inviterCredits: gets } });
    const why = event === "purchase" ? "made a first purchase" : event === "verified" ? "joined" : "signed up";
    if (claimed && gets) {
      const who = (await names())(inviteeId);
      await grant(String(r.inviterId), gets, `Invite reward: ${who} ${why}`, `ref:${inviteeId}:inviter`);
      void mailUser(String(r.inviterId), `You earned ${gets} credits`, `${gets} credits for inviting ${who}`, `${who} ${why}, so ${gets} credits were added to your account. Keep sharing your link to earn more.`, "Invite more friends", "/rewards");
    }
  }
}

// ------------------------------------------------------------------ coupons and offers
export const CouponIn = z.object({
  code: z.string().trim().min(3).max(24).regex(/^[A-Za-z0-9_-]+$/, "Letters, numbers, - and _ only"),
  kind: z.enum(["percent", "flat"]), value: z.number().positive().max(100000),
  appliesTo: z.enum(["all", "plans", "topups"]), audience: z.enum(["all", "new"]),
  minAmount: z.number().min(0).max(1000000).default(0), maxUses: z.number().int().min(0).max(10000000).default(0), perUserOnce: z.boolean().default(true),
  starts: z.string().nullable().optional(), ends: z.string().nullable().optional(), active: z.boolean().default(true), note: z.string().max(200).default(""),
});
export const OfferIn = z.object({
  id: z.string().max(40).optional(), title: z.string().trim().min(2).max(60), banner: z.string().trim().max(140).default(""),
  percent: z.number().min(1).max(90), appliesTo: z.enum(["all", "plans", "topups"]), audience: z.enum(["all", "new"]),
  starts: z.string().nullable().optional(), ends: z.string().nullable().optional(), active: z.boolean().default(true),
});
const dateOrNull = (s?: string | null) => (s ? new Date(s) : null);
const live = (d: Doc, now = Date.now()) => d.active !== false && (!d.starts || new Date(d.starts as string).getTime() <= now) && (!d.ends || new Date(d.ends as string).getTime() > now);
const fits = (appliesTo: unknown, kind: string) => appliesTo === "all" || (appliesTo === "plans" && kind === "plan") || (appliesTo === "topups" && kind === "topup");

export async function listCoupons() {
  return (await (await col("coupons")).find({}).sort({ createdAt: -1 }).limit(500).toArray()).map((c) => ({ ...c, code: String(c._id), _id: undefined, live: live(c) }));
}
export async function saveCoupon(c: z.infer<typeof CouponIn>) {
  if (c.kind === "percent" && c.value > 90) throw new ValidationFailed("A percent coupon can take at most 90% off.", { code: "INVALID_COUPON" });
  const code = c.code.toUpperCase(), { code: _c, ...rest } = c; void _c;
  await (await col("coupons")).updateOne({ _id: code }, { $set: { ...rest, starts: dateOrNull(c.starts), ends: dateOrNull(c.ends), updatedAt: new Date() }, $setOnInsert: { uses: 0, createdAt: new Date() } }, { upsert: true });
  return { ok: true, code };
}
export async function deleteCoupon(code: string) { await (await col("coupons")).deleteOne({ _id: code.toUpperCase() }); return { ok: true }; }

export async function listOffers() {
  return (await (await col("offers")).find({}).sort({ createdAt: -1 }).limit(200).toArray()).map((o) => ({ ...o, id: String(o._id), _id: undefined, live: live(o) }));
}
export async function saveOffer(o: z.infer<typeof OfferIn>) {
  const id = o.id || crypto.randomBytes(6).toString("hex"), { id: _i, ...rest } = o; void _i;
  await (await col("offers")).updateOne({ _id: id }, { $set: { ...rest, starts: dateOrNull(o.starts), ends: dateOrNull(o.ends), updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  return { ok: true, id };
}
export async function deleteOffer(id: string) { await (await col("offers")).deleteOne({ _id: id }); return { ok: true }; }

/** Has this person paid before? ("new" offers and coupons are for a first purchase) */
async function isNewCustomer(uid: string | null) { return !uid || !(await (await col("payments")).findOne({ userId: uid, status: "paid" }, { projection: { _id: 1 } })); }
/** The best live offer for a kind of item ("plan" / "topup") and this person. */
async function bestOffer(kind: string, isNew: boolean) {
  const all = await (await col("offers")).find({ active: { $ne: false } }).toArray();
  return all.filter((o) => live(o) && fits(o.appliesTo, kind) && (o.audience !== "new" || isNew)).sort((a, b) => Number(b.percent) - Number(a.percent))[0] ?? null;
}
/** The offer the pricing page and the banner show (the best live one this person can have; any kind). */
export async function currentOffer() {
  const uid = currentUser(), isNew = await isNewCustomer(uid);
  const all = (await (await col("offers")).find({ active: { $ne: false } }).toArray()).filter((o) => live(o) && (o.audience !== "new" || isNew));
  const o = all.sort((a, b) => Number(b.percent) - Number(a.percent))[0];
  return o ? { id: String(o._id), title: String(o.title), banner: String(o.banner ?? ""), percent: Number(o.percent), appliesTo: String(o.appliesTo), audience: String(o.audience), ends: o.ends ?? null } : null;
}
const round2 = (n: number) => Math.round(n * 100) / 100;
/** The price of an item for this person: the base, the best offer, then a coupon (checked: live, its kind, its
 * audience, its minimum, its uses, once per person); at least ₹1. `couponError` says why a code did not apply. */
export async function quote(uid: string | null, item: { kind: string; rupees: number }, couponCode?: string | null) {
  const isNew = await isNewCustomer(uid), base = item.rupees;
  const offer = await bestOffer(item.kind, isNew);
  const offerOff = offer ? round2((base * Number(offer.percent)) / 100) : 0;
  let after = base - offerOff, coupon: { code: string; off: number; label: string } | null = null, couponError = "";
  const code = (couponCode ?? "").trim().toUpperCase();
  if (code) {
    const c = await (await col("coupons")).findOne({ _id: code });
    if (!c || !live(c)) couponError = "This code is not valid or has ended.";
    else if (!fits(c.appliesTo, item.kind)) couponError = c.appliesTo === "plans" ? "This code is for plans only." : "This code is for credit top-ups only.";
    else if (c.audience === "new" && !isNew) couponError = "This code is for a first purchase.";
    else if (Number(c.minAmount ?? 0) > after) couponError = `This code needs a purchase of ₹${Number(c.minAmount)} or more.`;
    else if (Number(c.maxUses ?? 0) && Number(c.uses ?? 0) >= Number(c.maxUses)) couponError = "This code has been used up.";
    else if (c.perUserOnce !== false && uid && (await (await col("coupon_uses")).findOne({ code, userId: uid }))) couponError = "You have used this code already.";
    else {
      const off = round2(Math.min(after - 1, c.kind === "percent" ? (after * Number(c.value)) / 100 : Number(c.value)));
      coupon = { code, off: Math.max(0, off), label: c.kind === "percent" ? `${Number(c.value)}% off` : `₹${Number(c.value)} off` };
      after -= coupon.off;
    }
  }
  const final = Math.max(1, Math.round(after)); // whole rupees (Razorpay takes paise; the app's prices are whole)
  return { base, offer: offer ? { id: String(offer._id), title: String(offer.title), percent: Number(offer.percent), off: offerOff } : null, coupon, couponError, final };
}
/** A paid order with a coupon: its use counted, once. */
export async function couponUsed(code: string, uid: string, orderId: string, off: number) {
  try { await (await col("coupon_uses")).insertOne({ _id: orderId, code, userId: uid, off, at: new Date() }); } catch { return; }
  await (await col("coupons")).updateOne({ _id: code }, { $inc: { uses: 1 } });
}

// ------------------------------------------------------------------ affiliates
/** A paid order of someone an active affiliate brought (within the months the administrator set): their commission. */
export async function affiliateCommission(payerId: string, orderId: string, paidRupees: number) {
  const m = await getMarketing(); if (!m.affiliate.on) return;
  const ref = await (await col("referrals")).findOne({ _id: payerId }); if (!ref) return;
  const a = await (await col("affiliates")).findOne({ _id: String(ref.inviterId), status: "active" }); if (!a) return;
  // this affiliate's own rules (Admin → Marketing → Affiliates), else the program's: how long a customer counts, and until
  // when their link brings new customers (people who joined after it ended earn them nothing; earlier ones still count)
  const months = Number(a.months ?? 0) || m.affiliate.months;
  if (a.validUntil && new Date(ref.at).getTime() > new Date(a.validUntil).getTime()) return;
  if (Date.now() - new Date(ref.at).getTime() > months * 30.4 * 86400_000) return;
  const percent = Number(a.percent ?? m.affiliate.percent), commission = round2((paidRupees * percent) / 100);
  if (commission <= 0) return;
  try { await (await col("affiliate_earnings")).insertOne({ _id: orderId, affiliateId: String(ref.inviterId), payerId, paid: paidRupees, percent, commission, status: "due", at: new Date() }); } catch { /* counted already */ }
}
/** uid: the Shubix account (its session) or the partner-only one (the partner dashboard's emailed code); note: how they
 * will promote (an Instagram page, a website…), for the administrator deciding. */
export async function applyAffiliate(uid = currentUser(), note = "") {
  if (!uid) throw new AuthRequired();
  const m = await getMarketing();
  if (!m.affiliate.on || !m.affiliate.applyOpen) throw new ValidationFailed("The affiliate program is not taking new partners right now.", { code: "AFFILIATE_CLOSED" });
  const r = await (await col("affiliates")).updateOne({ _id: uid }, { $setOnInsert: { status: "pending", percent: m.affiliate.percent, createdAt: new Date(), ...(note.trim() ? { note: note.trim() } : {}) } }, { upsert: true });
  if (r.upsertedCount) {
    const name = await ensureUsername(uid), u = await (await col("users")).findOne({ _id: uidObj(uid) }, { projection: { email: 1 } });
    void mailAdmins(`New affiliate request: @${name}`, "A new affiliate request", `@${name}${u?.email ? ` (${String(u.email)})` : ""} asked to join the affiliate program.${note.trim() ? ` They said: “${note.trim()}”.` : ""} Approve or decline them in Admin → Marketing → Affiliate program.`, "Open Marketing", "/admin#marketing");
  }
  return { ok: true };
}
export async function listAffiliates() {
  const all = await (await col("affiliates")).find({}).sort({ createdAt: -1 }).limit(500).toArray();
  if (!all.length) return [];
  const ids = all.map((a) => String(a._id));
  const users = await (await col("users")).find({ _id: { $in: ids.filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i)) } }, { projection: { email: 1, username: 1, partnerOnly: 1 } }).toArray();
  const earn = await (await col("affiliate_earnings")).aggregate<{ _id: { a: string; s: string }; sum: number; n: number }>([{ $match: { affiliateId: { $in: ids } } }, { $group: { _id: { a: "$affiliateId", s: "$status" }, sum: { $sum: "$commission" }, n: { $sum: 1 } } }]).toArray();
  const brought = await (await col("referrals")).aggregate<{ _id: string; n: number }>([{ $match: { inviterId: { $in: ids } } }, { $group: { _id: "$inviterId", n: { $sum: 1 } } }]).toArray();
  return all.map((a) => {
    const id = String(a._id), u = users.find((x) => String(x._id) === id), e = (s: string) => earn.find((x) => x._id.a === id && x._id.s === s);
    return { id, email: u?.email ?? "", username: u?.username ?? "", status: a.status, percent: Number(a.percent), months: a.months ? Number(a.months) : null, validUntil: a.validUntil ?? null,
      createdAt: a.createdAt, note: a.note ?? "", partnerOnly: !!u?.partnerOnly, brought: brought.find((b) => b._id === id)?.n ?? 0,
      due: round2(e("due")?.sum ?? 0), paid: round2(e("paid")?.sum ?? 0), sales: (e("due")?.n ?? 0) + (e("paid")?.n ?? 0), payout: !!a.payout };
  });
}
export const AffiliateIn = z.object({ id: z.string().max(40), status: z.enum(["pending", "active", "paused"]).optional(), percent: z.number().min(0).max(90).optional(),
  months: z.number().int().min(0).max(120).optional(), validUntil: z.string().nullable().optional() }); // months 0 = the program's; validUntil null = no end
export async function updateAffiliate(d: z.infer<typeof AffiliateIn>) {
  const who = ObjectId.isValid(d.id) ? await (await col("users")).findOne({ _id: new ObjectId(d.id) }, { projection: { email: 1 } }) : null;
  if (!who) throw new NotFoundError("No such account.", { code: "USER_NOT_FOUND" });
  const dash = dashPath(who.email); // the partner dashboard, their email filled in (signed out there: a code, and in)
  const affs = await col("affiliates"), before = await affs.findOne({ _id: d.id });
  const set: Doc = { updatedAt: new Date() };
  if (d.status) { set.status = d.status; if (d.status === "active" && !before?.approvedAt) set.approvedAt = new Date(); } // "partner since": the first approval
  if (d.percent !== undefined) set.percent = d.percent;
  if (d.months !== undefined) set.months = d.months || null;
  if (d.validUntil !== undefined) set.validUntil = d.validUntil ? new Date(d.validUntil) : null;
  await affs.updateOne({ _id: d.id }, { $set: set, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  if (d.status && d.status !== before?.status) {
    const pct = d.percent ?? Number(before?.percent ?? (await getMarketing()).affiliate.percent);
    if (d.status === "active")
      void mailUser(d.id, "You are a Shubix affiliate", before?.status === "paused" ? "Your affiliate link is active again" : "You are approved as an affiliate",
        `Share your link: you earn ${pct}% of what the people you bring pay. Your dashboard shows your clicks, customers and earnings.`, "Open my dashboard", dash);
    if (d.status === "paused")
      void mailUser(d.id, "Your affiliate link is paused", "Your affiliate link is paused",
        "New purchases through your link earn no commission for now. What is already due to you stays due. Reply to this email if you have questions.", "Open my dashboard", dash);
  }
  return { ok: true };
}

/** Where an affiliate is paid: a UPI ID, or a bank account (name, number, IFSC). Only they set it; the admin sees it to pay. */
export const PayoutIn = z.discriminatedUnion("method", [
  z.object({ method: z.literal("upi"), upi: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,30}$/, "That does not look like a UPI ID (name@bank).") }),
  z.object({ method: z.literal("bank"), name: z.string().trim().min(2, "The account holder's name, please.").max(80),
    account: z.string().trim().regex(/^\d{9,18}$/, "An account number is 9 to 18 digits."),
    ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "That does not look like an IFSC code (like SBIN0001234).") }),
]);
export type Payout = z.infer<typeof PayoutIn>;
export async function setPayoutDetails(d: Payout, uid = currentUser()) {
  if (!uid) throw new AuthRequired();
  const r = await (await col("affiliates")).updateOne({ _id: uid }, { $set: { payout: { ...d, updatedAt: new Date() } } });
  if (!r.matchedCount) throw new NotFoundError("Ask to join the affiliate program first.", { code: "AFFILIATE_NOT_FOUND" });
  return { ok: true };
}
/** the payout details as shown: in full to the administrator (to pay), the account number hidden but its last 4 to the partner */
function payoutOut(p: Doc | undefined, full: boolean) {
  if (!p?.method) return null;
  if (p.method === "upi") return { method: "upi" as const, upi: String(p.upi), updatedAt: p.updatedAt ?? null };
  const acc = String(p.account ?? "");
  return { method: "bank" as const, name: String(p.name ?? ""), account: full ? acc : `•••• ${acc.slice(-4)}`, ifsc: String(p.ifsc ?? ""), updatedAt: p.updatedAt ?? null };
}
// ------------------------------------------------------------------ link clicks and the full picture of one affiliate
const day = (d = new Date()) => d.toISOString().slice(0, 10);
/** Someone opened the app with ?ref=username (once per browser, the page decides): a click for that person's link. */
export async function linkClick(ref: string) {
  const u = await userByUsername(ref); if (!u) return { ok: true };
  await (await col("link_clicks")).updateOne({ _id: `${u.id}:${day()}` }, { $inc: { n: 1 }, $setOnInsert: { userId: u.id, day: day() } }, { upsert: true });
  return { ok: true };
}
/** One affiliate, everything: terms, link, clicks, customers (full for the admin, usernames only for the affiliate),
 * sales with their commission, payouts. */
export async function affiliateDetail(id: string, forAdmin: boolean) {
  const m = await getMarketing(), a = await (await col("affiliates")).findOne({ _id: id });
  if (!a) throw new NotFoundError("No such affiliate.", { code: "AFFILIATE_NOT_FOUND" });
  const users = await col("users"), me = await users.findOne({ _id: uidObj(id) }, { projection: { email: 1, username: 1, createdAt: 1 } });
  const username = me?.username ? String(me.username) : await ensureUsername(id);
  const months = Number(a.months ?? 0) || m.affiliate.months;
  const refs = await (await col("referrals")).find({ inviterId: id }).sort({ at: -1 }).limit(500).toArray();
  const people = refs.length ? await users.find({ _id: { $in: refs.map((r) => uidObj(String(r._id))) } }, { projection: { email: 1, username: 1 } }).toArray() : [];
  const earnings = await (await col("affiliate_earnings")).find({ affiliateId: id }).sort({ at: -1 }).limit(500).toArray();
  const payouts = await (await col("affiliate_payouts")).find({ affiliateId: id }).sort({ at: -1 }).limit(100).toArray();
  const clicks = await (await col("link_clicks")).find({ userId: id }).toArray();
  const since30 = day(new Date(Date.now() - 30 * 86400_000));
  const byPayer = new Map<string, { paid: number; commission: number }>();
  for (const e of earnings) { const k = String(e.payerId), x = byPayer.get(k) ?? { paid: 0, commission: 0 }; x.paid += Number(e.paid); x.commission += Number(e.commission); byPayer.set(k, x); }
  const sum = (s: string) => round2(earnings.filter((e) => e.status === s).reduce((t, e) => t + Number(e.commission), 0));
  return {
    id, username, email: forAdmin ? String(me?.email ?? "") : undefined, status: String(a.status), percent: Number(a.percent ?? m.affiliate.percent),
    months, monthsOwn: a.months ? Number(a.months) : null, validUntil: a.validUntil ?? null, since: a.approvedAt ?? a.createdAt ?? null,
    link: `${settings.publicBaseUrl || ""}/?ref=${encodeURIComponent(username)}`, minPayout: m.affiliate.minPayout,
    stats: { clicks: clicks.reduce((t, c) => t + Number(c.n), 0), clicks30: clicks.filter((c) => String(c.day) >= since30).reduce((t, c) => t + Number(c.n), 0),
      customers: refs.length, buyers: byPayer.size, sales: earnings.length, revenue: round2(earnings.reduce((t, e) => t + Number(e.paid), 0)), due: sum("due"), paid: sum("paid") },
    customers: refs.map((r) => {
      const p = people.find((x) => String(x._id) === String(r._id)), b = byPayer.get(String(r._id));
      const counts = (!a.validUntil || new Date(r.at).getTime() <= new Date(a.validUntil).getTime()) ? new Date(new Date(r.at).getTime() + months * 30.4 * 86400_000) : null;
      return { username: p?.username ? String(p.username) : "", email: forAdmin ? String(p?.email ?? "") : undefined, joined: r.at, paid: round2(b?.paid ?? 0), commission: round2(b?.commission ?? 0), countsUntil: counts };
    }),
    sales: earnings.map((e) => ({ id: String(e._id), at: e.at, customer: people.find((x) => String(x._id) === String(e.payerId))?.username ?? "", paid: Number(e.paid), percent: Number(e.percent), commission: Number(e.commission), status: String(e.status), paidAt: e.paidAt ?? null })),
    payouts: payouts.map((p) => ({ id: String(p._id), at: p.at, total: Number(p.total), count: Number(p.count), note: String(p.note ?? "") })), // the reference: for both
    payout: payoutOut(a.payout as Doc | undefined, forAdmin),
  };
}
/** The affiliate's own dashboard (active or not: a pending one sees its status). */
export async function myAffiliateDashboard(uid = currentUser()) {
  if (!uid) throw new AuthRequired();
  const a = await (await col("affiliates")).findOne({ _id: uid });
  if (!a) return { affiliate: null };
  return { affiliate: await affiliateDetail(uid, false) };
}

/** The administrator paid an affiliate (by hand: bank, UPI): their due commission is marked paid. */
/** the partner dashboard's address in an email: the person's email filled in on its sign-in step */
const dashPath = (email: unknown) => `/affiliate${email ? `?email=${encodeURIComponent(String(email))}` : ""}`;
export async function markAffiliatePaid(id: string, note: string) {
  const earnings = await col("affiliate_earnings"), payoutId = crypto.randomBytes(6).toString("hex"), at = new Date();
  // each due sale is flipped once, by one payout: a second click (or a second admin) at the same moment finds nothing left
  await earnings.updateMany({ affiliateId: id, status: "due" }, { $set: { status: "paid", paidAt: at, payoutId } });
  const mine = await earnings.find({ payoutId }).toArray();
  const total = round2(mine.reduce((s, e) => s + Number(e.commission), 0));
  if (!mine.length) throw new ValidationFailed("Nothing is due to this affiliate.", { code: "NOTHING_DUE" });
  const ref = note.trim().slice(0, 120);
  await (await col("affiliate_payouts")).insertOne({ _id: payoutId, affiliateId: id, total, count: mine.length, note: ref, at });
  void mailUser(id, `You were paid ₹${total}`, `₹${total.toLocaleString("en-IN")} paid to you`,
    `We sent your affiliate commission for ${mine.length} sale${mine.length === 1 ? "" : "s"}${ref ? ` (reference: ${ref})` : ""}. It can take a little while to show in your account.`, "See my payouts", "/affiliate");
  return { ok: true, total };
}

// ------------------------------------------------------------------ what a person sees (Invite & earn)
export async function myMarketing() {
  const uid = currentUser(); if (!uid) throw new AuthRequired();
  const [m, username] = await Promise.all([getMarketing(), ensureUsername(uid)]);
  const w = await (await col("wallets")).findOne({ _id: uid }), pricing = await (await col("app_settings")).findOne({ _id: "pricing" });
  const planAi = ((pricing?.plans as Doc[] | undefined)?.find((p) => p.id === (w?.plan ?? "free"))?.ai ?? (w?.plan && w.plan !== "free")) === true;
  const reelCost = Number((pricing?.costs as Doc | undefined)?.studio_ai ?? 10);
  const refs = await col("referrals"), invited = await refs.countDocuments({ inviterId: uid }), rewarded = await refs.find({ inviterId: uid, $or: [{ inviterRewarded: true }, { rewarded: true }] }, { projection: { inviterCredits: 1 } }).toArray();
  const a = await (await col("affiliates")).findOne({ _id: uid });
  let affiliate: Doc | null = null;
  if (a) {
    const e = await (await col("affiliate_earnings")).find({ affiliateId: uid }).sort({ at: -1 }).limit(20).toArray();
    affiliate = { status: a.status, percent: Number(a.percent), months: Number(a.months ?? 0) || m.affiliate.months, validUntil: a.validUntil ?? null, due: round2(e.filter((x) => x.status === "due").reduce((s, x) => s + Number(x.commission), 0)),
      paid: round2(e.filter((x) => x.status === "paid").reduce((s, x) => s + Number(x.commission), 0)), sales: e.length,
      recent: e.slice(0, 8).map((x) => ({ at: x.at, paid: x.paid, commission: x.commission, status: x.status })) };
  }
  const sent = await (await col("credit_transfers")).aggregate<{ _id: null; n: number }>([{ $match: { from: uid, at: { $gte: startOfDay() } } }, { $group: { _id: null, n: { $sum: "$amount" } } }]).toArray();
  return {
    username, link: `${settings.publicBaseUrl || ""}/?ref=${encodeURIComponent(username)}`,
    referral: { on: m.referral.on, inviterCredits: m.referral.inviterCredits, inviteeCredits: m.referral.inviteeCredits, inviteeOn: m.referral.inviteeOn, inviterOn: m.referral.inviterOn, invited, rewarded: rewarded.length, earned: rewarded.reduce((s, r) => s + Number(r.inviterCredits ?? 0), 0) },
    share: { on: m.share.on, min: m.share.min, max: m.share.max, dailyMax: m.share.dailyMax, source: m.share.source, sentToday: sent[0]?.n ?? 0 },
    affiliate: { on: m.affiliate.on, applyOpen: m.affiliate.applyOpen, percent: m.affiliate.percent, months: m.affiliate.months, minPayout: m.affiliate.minPayout, me: affiliate },
    ai: { planAi, freeWithCredits: m.ai.freeWithCredits, reelCost }, // what credits do for this person (Free: pay for Shubix AI, or kept for later)
  };
}
export function startOfDay() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }

/** Admin → Marketing → Report: how the programs are doing. */
export async function marketingReport() {
  const since = new Date(Date.now() - 30 * 86400_000);
  const [refs, refs30, rewarded, coupons, uses30, transfers30, earnDue, earnPaid] = await Promise.all([
    (await col("referrals")).countDocuments({}), (await col("referrals")).countDocuments({ at: { $gte: since } }), (await col("referrals")).countDocuments({ $or: [{ inviterRewarded: true }, { rewarded: true }] }),
    (await col("coupons")).countDocuments({}), (await col("coupon_uses")).aggregate<{ _id: null; n: number; off: number }>([{ $match: { at: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, off: { $sum: "$off" } } }]).toArray(),
    (await col("credit_transfers")).aggregate<{ _id: null; n: number; credits: number }>([{ $match: { at: { $gte: since } } }, { $group: { _id: null, n: { $sum: 1 }, credits: { $sum: "$amount" } } }]).toArray(),
    (await col("affiliate_earnings")).aggregate<{ _id: null; s: number }>([{ $match: { status: "due" } }, { $group: { _id: null, s: { $sum: "$commission" } } }]).toArray(),
    (await col("affiliate_earnings")).aggregate<{ _id: null; s: number }>([{ $match: { status: "paid" } }, { $group: { _id: null, s: { $sum: "$commission" } } }]).toArray(),
  ]);
  const top = await (await col("referrals")).aggregate<{ _id: string; n: number }>([{ $group: { _id: "$inviterId", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 5 }]).toArray();
  const names = await (await col("users")).find({ _id: { $in: top.filter((t) => ObjectId.isValid(t._id)).map((t) => new ObjectId(t._id)) } }, { projection: { username: 1, email: 1 } }).toArray();
  return {
    referrals: { total: refs, last30: refs30, rewarded }, coupons: { total: coupons, uses30: uses30[0]?.n ?? 0, discount30: round2(uses30[0]?.off ?? 0) },
    transfers: { count30: transfers30[0]?.n ?? 0, credits30: transfers30[0]?.credits ?? 0 }, affiliates: { due: round2(earnDue[0]?.s ?? 0), paid: round2(earnPaid[0]?.s ?? 0) },
    topInviters: top.map((t) => { const u = names.find((x) => String(x._id) === t._id); return { username: u?.username ?? "", email: u?.email ?? "", invited: t.n }; }),
  };
}
