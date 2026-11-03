import crypto from "node:crypto";
import { AuthRequired, currentUser } from "./core/auth";
import { isAdminUser } from "./core/admin";
import { settings } from "./core/config";
import { mainDb, ObjectId } from "./core/db";
import { AppError, NotFoundError, ValidationFailed } from "./core/errors";
import { getPricing, paymentsOpen } from "./workspace";
import { mailUser } from "./core/mail";
import { sendReceipt } from "./receipts";
import { affiliateCommission, couponUsed, getMarketing, quote, rewardFor, startOfDay, userByUsername } from "./marketing";

/** Credits and payments (were services/credits.py and api/billing.py). A wallet (`wallets`, _id = user id) has
 * `monthly` (the plan's credits for this month, replaced when it renews) and `extra` (starter credits and top-ups, never
 * expiring); credits come from monthly first, every change is a `credit_ledger` line. Only active with billing AND
 * accounts on: a local single-person studio never counts credits. Payments: Razorpay Standard Checkout, applied once. */

type Doc = Record<string, unknown>;
const CYCLE = 30 * 86400_000, YEARLY_MONTHS_CHARGED = 10, RAZORPAY = "https://api.razorpay.com/v1";
export class NotEnoughCredits extends AppError {
  constructor(message: string, details: unknown) { super(message, { code: "INSUFFICIENT_CREDITS", status: 402, details }); }
}
export const enabled = () => Boolean(settings.billingEnabled && settings.authEnabled);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const plansById = async () => new Map((await getPricing()).plans.map((p) => [p.id, p]));
const balanceOf = (w: Doc) => Number(w.monthly ?? 0) + Number(w.extra ?? 0);
async function log(userId: string, delta: number, reason: string, ref: string, w: Doc, extra: Doc = {}) {
  await (await col("credit_ledger")).insertOne({ userId, delta, reason, ref, balance: balanceOf(w), at: new Date(), ...extra });
}
/** The user's wallet, created with the free starter credits, renewed / expired as the dates say. */
export async function wallet(userId: string): Promise<Doc> {
  const wallets = await col("wallets"), now = new Date();
  let w = await wallets.findOne({ _id: userId });
  if (!w) {
    const free = Number((await plansById()).get("free")?.credits ?? 0);
    w = { _id: userId, plan: "free", period: null, monthly: 0, extra: free, planEnds: null, cycleEnds: null, createdAt: now, updatedAt: now };
    try { await wallets.insertOne(w); await log(userId, free, "Free starter credits", "signup", w); } catch { w = await wallets.findOne({ _id: userId }); }
  }
  const planEnds = w.planEnds ? new Date(w.planEnds) : null, cycleEnds = w.cycleEnds ? new Date(w.cycleEnds) : null;
  if (w.plan !== "free" && planEnds && now >= planEnds) { // the paid period is over: back to free (top-ups stay)
    await wallets.updateOne({ _id: userId }, { $set: { plan: "free", period: null, monthly: 0, planEnds: null, cycleEnds: null, updatedAt: now } });
    w = await wallets.findOne({ _id: userId });
  } else if (w.plan !== "free" && cycleEnds && now >= cycleEnds) { // a new month inside a yearly plan
    const credits = Number((await plansById()).get(String(w.plan))?.credits ?? 0);
    let next = cycleEnds.getTime();
    while (next <= now.getTime()) next += CYCLE;
    const res = await wallets.findOneAndUpdate({ _id: userId, cycleEnds: w.cycleEnds }, { $set: { monthly: credits, cycleEnds: new Date(next), updatedAt: now } }, { returnDocument: "after" });
    if (res) await log(userId, credits, "Monthly credits renewed", "renewal", res);
    w = await wallets.findOne({ _id: userId });
  }
  return w as Doc;
}
export async function costOf(action: string, times = 1) { return Number((await getPricing()).costs[action] ?? 0) * Math.max(times, 0); }
/** Take the credits for an action from the signed-in user, or 402 INSUFFICIENT_CREDITS; returns what was taken. */
export async function charge(action: string, ref: string, reason: string, times = 1): Promise<number> {
  const uid = currentUser();
  if (!enabled() || !uid || (await isAdminUser(uid))) return 0; // the administrator: everything open, nothing taken
  const cost = await costOf(action, times);
  if (cost <= 0) return 0;
  const wallets = await col("wallets");
  for (let i = 0; i < 5; i++) { // optimistic: retry if another request changed the wallet in between
    const w = await wallet(uid), monthly = Number(w.monthly ?? 0), extra = Number(w.extra ?? 0);
    if (monthly + extra < cost) throw new NotEnoughCredits(`This needs ${cost} credit${cost > 1 ? "s" : ""}, you have ${monthly + extra}. Top up or choose a plan to continue.`, { needed: cost, balance: monthly + extra });
    const fromMonthly = Math.min(monthly, cost);
    const res = await wallets.findOneAndUpdate({ _id: uid, monthly, extra }, { $set: { monthly: monthly - fromMonthly, extra: extra - (cost - fromMonthly), updatedAt: new Date() } }, { returnDocument: "after" });
    if (res) { await log(uid, -cost, reason, ref, res, { fromMonthly }); return cost; }
  }
  throw new AppError("Your credits are being updated by another request. Try again.", { code: "CREDITS_BUSY" });
}
// ------------------------------------------------------------------ Shubix AI by plan, and per Reel
export class PlanNeeded extends AppError {
  constructor(message: string, details: unknown) { super(message, { code: "PLAN_NEEDED", status: 402, details }); }
}
/** Has this person's plan Shubix AI? Billing off (a private studio) or the administrator: always. */
/** `credits`: an AI action paid with credits (an AI Reel, Ask Shubix): on a plan without Shubix AI (Free) it is open
 * too when the administrator lets credits pay for it (Admin → Marketing) and the person has credits (viaCredits).
 * Without it (captions, translation…) only a plan with Shubix AI opens it. */
export async function aiAllowed(admin = false, o: { credits?: boolean } = {}): Promise<{ ok: boolean; plan: string; planName: string; balance: number | null; freeChats: number; viaCredits?: boolean }> {
  const uid = currentUser();
  if (!enabled() || admin) return { ok: true, plan: "", planName: "", balance: null, freeChats: 0 };
  if (!uid) return { ok: false, plan: "free", planName: "Free", balance: 0, freeChats: 0 };
  const w = await wallet(uid), plan = (await plansById()).get(String(w.plan)) as { ai?: boolean; name?: string; freeChats?: number } | undefined;
  const out = { ok: !!plan?.ai, plan: String(w.plan), planName: plan?.name ?? String(w.plan), balance: balanceOf(w), freeChats: Number(plan?.freeChats ?? 0) };
  if (!out.ok && o.credits && out.balance > 0 && (await getMarketing()).ai.freeWithCredits) return { ...out, ok: true, viaCredits: true };
  return out;
}
export async function requireAiPlan(admin = false, o: { credits?: boolean } = {}) {
  const a = await aiAllowed(admin, o);
  if (!a.ok) {
    const withCredits = o.credits && (await getMarketing()).ai.freeWithCredits;
    throw new PlanNeeded(withCredits ? "Shubix AI uses credits: earn them by inviting friends (Invite & earn), top up, or choose Editor or Pro. Your Reel is still edited on your phone, free."
      : "Shubix AI is part of the Editor and Pro plans. Your Reel is still edited on your phone, free.", { plan: a.plan });
  }
  return a;
}
/** What the signed-in person has: their balance (null: credits are not counted here). */
export async function balanceNow(): Promise<number | null> { const uid = currentUser(); if (!enabled() || !uid) return null; return balanceOf(await wallet(uid)); }
/** Charge once for a key (an AI Reel, one chat message): asking again with the same key (more clips, a retry, a long
 * Reel planned in parts) takes nothing more. A refunded charge counts as not taken. */
export async function chargeOnce(action: string, key: string, reason: string): Promise<{ taken: number; ref: string }> {
  const uid = currentUser();
  if (!enabled() || !uid || (await isAdminUser(uid))) return { taken: 0, ref: "" };
  const ref = `${action}:${uid}:${key}`;
  if (await (await col("credit_ledger")).findOne({ ref, delta: { $lt: 0 }, refunded: { $ne: true } })) return { taken: 0, ref };
  return { taken: await charge(action, ref, reason), ref };
}
/** One Ask Shubix message on a Reel: the plan's first few per Reel (freeChats: Editor 2, Pro 5) use no credits, the
 * rest are charged (small or whole-Reel). Counted on the server per person and Reel by message id, so a retry of the
 * same message is the same turn and a Reel opened again keeps its count. `undo` gives a failed turn back. */
export async function chatTurn(reelId: string, msgId: string, action: string, reason: string) {
  const uid = currentUser();
  if (!enabled() || !uid || (await isAdminUser(uid))) return { taken: 0, ref: "", free: true, used: 0, left: 0, undo: async () => {} };
  const w = await wallet(uid), freeChats = Number(((await plansById()).get(String(w.plan)) as { freeChats?: number } | undefined)?.freeChats ?? 0);
  const chats = await col("reel_chats"), _id = `${uid}:${reelId}` as unknown as ObjectId;
  const doc = (await chats.findOneAndUpdate({ _id }, { $addToSet: { ids: msgId }, $set: { at: new Date() } }, { upsert: true, returnDocument: "after" })) as { ids?: string[] } | null;
  const ids = doc?.ids ?? [msgId], i = ids.indexOf(msgId), used = ids.length, left = Math.max(0, freeChats - used);
  if (i < freeChats) return { taken: 0, ref: "", free: true, used, left, undo: async () => { await chats.updateOne({ _id }, { $pull: { ids: msgId } } as never); } };
  const c = await chargeOnce(action, `${reelId}:chat:${msgId}`, reason);
  return { ...c, free: false, used, left, undo: async () => { await chats.updateOne({ _id }, { $pull: { ids: msgId } } as never); if (c.taken) await refund(c.ref); } };
}
/** The AI's price list for the phone: an AI Reel, a small and a whole-Reel chat change, Change Reel's versions */
export async function aiCosts() { const [reel, small, big, mix] = await Promise.all(["studio_ai", "studio_chat_small", "studio_chat_big", "studio_mix"].map((k) => costOf(k))); return { reel, small, big, mix }; }
/** Admin: put a person on a plan by hand (no payment): Free, or a paid plan for 1 or 12 months with its credits. */
export async function setPlanByAdmin(userId: string, planId: string, months: number) {
  const plans = await plansById();
  if (!plans.has(planId)) throw new ValidationFailed("Unknown plan.", { code: "UNKNOWN_PLAN" });
  await wallet(userId);
  if (planId === "free") {
    const res = await (await col("wallets")).findOneAndUpdate({ _id: userId }, { $set: { plan: "free", period: null, monthly: 0, planEnds: null, cycleEnds: null, updatedAt: new Date() } }, { returnDocument: "after" });
    await log(userId, 0, "Moved to the Free plan by the administrator", "admin", res);
  } else await givePlan(userId, planId, months >= 12 ? "yearly" : "monthly", "admin");
  return summary(userId);
}
/** An AI Reel's credits pay for its plan: once the plan is delivered the charge stays (marked here); a charge whose plan
 * never came (the AI failed, answered only a part) is given back by refundUndelivered. */
export async function markDelivered(ref: string) {
  if (ref) await (await col("credit_ledger")).updateOne({ ref, delta: { $lt: 0 } }, { $set: { delivered: true } });
}
export async function refundUndelivered(ref: string): Promise<number> {
  if (!ref) return 0;
  const e = await (await col("credit_ledger")).findOne({ ref, delta: { $lt: 0 }, refunded: { $ne: true } });
  return !e || e.delivered ? 0 : refund(ref);
}
/** Give back what a job took (it failed or was cancelled); each charge is refunded at most once. */
export async function refund(ref: string): Promise<number> {
  const entry = await (await col("credit_ledger")).findOneAndUpdate({ ref, delta: { $lt: 0 }, refunded: { $ne: true } }, { $set: { refunded: true } });
  if (!entry) return 0;
  const amount = -Number(entry.delta), back = Math.min(Number(entry.fromMonthly ?? 0), amount);
  const res = await (await col("wallets")).findOneAndUpdate({ _id: entry.userId }, { $inc: { monthly: back, extra: amount - back }, $set: { updatedAt: new Date() } }, { returnDocument: "after" });
  if (res) await log(String(entry.userId), amount, "Refund: the Reel could not be made", ref, res);
  return amount;
}
async function givePlan(userId: string, planId: string, period: string, ref: string) {
  const plan = (await plansById()).get(planId)!, w = await wallet(userId), now = Date.now();
  const start = w.plan === planId && w.planEnds && new Date(w.planEnds as Date).getTime() > now ? new Date(w.planEnds as Date).getTime() : now;
  const ends = start + (period === "yearly" ? 365 * 86400_000 : CYCLE);
  const res = await (await col("wallets")).findOneAndUpdate({ _id: userId }, { $set: { plan: planId, period, monthly: Number(plan.credits), planEnds: new Date(ends), cycleEnds: new Date(Math.min(now + CYCLE, ends)), updatedAt: new Date() } }, { returnDocument: "after" });
  await log(userId, Number(plan.credits), `${plan.name} plan (${period})`, ref, res);
}
async function giveExtra(userId: string, credits: number, reason: string, ref: string) {
  await wallet(userId);
  const res = await (await col("wallets")).findOneAndUpdate({ _id: userId }, { $inc: { extra: credits }, $set: { updatedAt: new Date() } }, { returnDocument: "after" });
  await log(userId, credits, reason, ref, res);
}
/** Credits given by the app itself (an invite reward): to `extra`, never expiring; once per `ref`. */
export async function grantCredits(userId: string, credits: number, reason: string, ref: string) {
  if (!enabled() || credits <= 0) return;
  if (await (await col("credit_ledger")).findOne({ ref, userId, delta: { $gt: 0 } })) return;
  await giveExtra(userId, credits, reason, ref);
}
/** Send credits to a friend by @username (Invite & earn): the administrator's limits (on, the smallest and largest
 * amount, a day's total) and which credits may go (top-up and gift credits only, or all). Taken and given together. */
export async function sendCredits(toName: string, amount: number, note = "") {
  const uid = currentUser(); if (!uid) throw new AuthRequired();
  if (!enabled()) throw new ValidationFailed("Credits are not counted in this studio.", { code: "BILLING_OFF" });
  const m = (await getMarketing()).share;
  if (!m.on) throw new ValidationFailed("Sending credits is turned off right now.", { code: "SHARE_OFF" });
  if (!Number.isInteger(amount) || amount < m.min || amount > m.max) throw new ValidationFailed(`Send between ${m.min} and ${m.max} credits at a time.`, { code: "SHARE_AMOUNT" });
  const to = await userByUsername(toName);
  if (!to) throw new NotFoundError("No one has that username. Check it and try again.", { code: "USER_NOT_FOUND" });
  if (to.id === uid) throw new ValidationFailed("You cannot send credits to yourself.", { code: "SHARE_SELF" });
  const today = await (await col("credit_transfers")).aggregate<{ _id: null; n: number }>([{ $match: { from: uid, at: { $gte: startOfDay() } } }, { $group: { _id: null, n: { $sum: "$amount" } } }]).toArray();
  if ((today[0]?.n ?? 0) + amount > m.dailyMax) throw new ValidationFailed(`You can send up to ${m.dailyMax} credits a day (${Math.max(0, m.dailyMax - (today[0]?.n ?? 0))} left today).`, { code: "SHARE_DAILY" });
  const wallets = await col("wallets");
  for (let i = 0; i < 5; i++) { // optimistic, as charge(): retry if the wallet changed in between
    const w = await wallet(uid), monthly = Number(w.monthly ?? 0), extra = Number(w.extra ?? 0), can = m.source === "extra" ? extra : monthly + extra;
    if (can < amount) throw new ValidationFailed(m.source === "extra" ? `You have ${extra} top-up or gift credits to send (a plan's monthly credits stay with the plan).` : `You have ${can} credits.`, { code: "SHARE_NOT_ENOUGH" });
    const fromExtra = Math.min(extra, amount);
    const res = await wallets.findOneAndUpdate({ _id: uid, monthly, extra }, { $set: { extra: extra - fromExtra, monthly: monthly - (amount - fromExtra), updatedAt: new Date() } }, { returnDocument: "after" });
    if (!res) continue;
    const id = crypto.randomBytes(8).toString("hex"), me = await (await col("users")).findOne({ _id: new ObjectId(uid) }, { projection: { username: 1 } });
    await log(uid, -amount, `Sent to @${to.username}`, `send:${id}`, res);
    await giveExtra(to.id, amount, `Gift from @${me?.username ?? "a friend"}`, `send:${id}`);
    await (await col("credit_transfers")).insertOne({ _id: id, from: uid, to: to.id, amount, note: note.slice(0, 140), at: new Date() });
    const from = `@${me?.username ?? "a friend"}`;
    void mailUser(to.id, `${from} sent you ${amount} credits`, `${amount} credits from ${from}`,
      `${from} sent you ${amount} credits${note.trim() ? `: “${note.trim().slice(0, 140)}”` : ""}. They are in your account now; use them for Shubix AI.`, "Make a Reel", "/");
    return { ok: true, sent: amount, to: to.username, balance: balanceOf(await wallet(uid)) };
  }
  throw new AppError("Your credits are being updated by another request. Try again.", { code: "CREDITS_BUSY" });
}
/** The administrator gives credits (to `extra`, never expiring) or takes them back (from `extra`, then `monthly`, never below 0). */
export async function adjustCredits(userId: string, credits: number, reason: string) {
  const w = await wallet(userId), monthly = Number(w.monthly ?? 0), extra = Number(w.extra ?? 0);
  if (credits > 0) return giveExtra(userId, credits, reason, "admin");
  const take = Math.min(-credits, monthly + extra), fromExtra = Math.min(extra, take);
  const res = await (await col("wallets")).findOneAndUpdate({ _id: userId }, { $set: { extra: extra - fromExtra, monthly: monthly - (take - fromExtra), updatedAt: new Date() } }, { returnDocument: "after" });
  await log(userId, -take, reason, "admin", res);
}
export async function summary(userId: string) {
  const w = await wallet(userId), plans = await plansById();
  const history = (await (await col("credit_ledger")).find({ userId }).sort({ at: -1 }).limit(30).toArray()).map((e) => ({ delta: e.delta, reason: e.reason, at: e.at, balance: e.balance ?? null }));
  return { enabled: true, balance: balanceOf(w), monthly: Number(w.monthly ?? 0), extra: Number(w.extra ?? 0), plan: w.plan, planName: plans.get(String(w.plan))?.name ?? w.plan, period: w.period ?? null,
    planEnds: w.planEnds ?? null, renews: w.cycleEnds ?? null, history };
}
/** billing: true when billing is on but nobody is signed in (the studio then follows the free plan, not "everything open") */
export async function myCredits() { const uid = currentUser(); return !enabled() || !uid ? { enabled: false, billing: enabled() } : summary(uid); }

// ------------------------------------------------------------------ payments
function uidOrThrow() { const uid = currentUser(); if (!uid) throw new AuthRequired("Please sign in to buy a plan or credits."); return uid; }
/** What an item is and costs, from the server's own prices (never the browser's). */
async function describe(item: string) {
  const p = await getPricing(), parts = item.split(":");
  if (parts[0] === "plan" && parts.length === 3 && ["monthly", "yearly"].includes(parts[2])) {
    const plan = p.plans.find((x) => x.id === parts[1] && x.monthly > 0);
    if (plan) return { kind: "plan", plan: plan.id, period: parts[2], rupees: plan.monthly * (parts[2] === "yearly" ? YEARLY_MONTHS_CHARGED : 1), label: `${plan.name} plan · ${parts[2] === "yearly" ? "1 year" : "1 month"}` };
  }
  if (parts[0] === "topup" && parts.length === 2) {
    const t = p.topUps.find((x) => x.id === parts[1]);
    if (t) return { kind: "topup", credits: t.credits, rupees: t.price, label: `${t.credits} credits` };
  }
  throw new ValidationFailed("Unknown plan or top-up.", { code: "UNKNOWN_ITEM" });
}
/** What this person pays for an item (the best offer, then a coupon), shown before the payment window opens. */
export async function quoteItem(itemKey: string, coupon?: string | null) {
  const item = await describe(itemKey), q = await quote(currentUser(), item, coupon);
  return { item: itemKey, label: item.label, ...q };
}
const hmacHex = (secret: string, data: string | Buffer) => crypto.createHmac("sha256", secret).update(data).digest("hex");
const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Apply a paid order exactly once (the browser and the webhook may both report it). */
async function fulfil(orderId: string, paymentId: string, via: string) {
  const payments = await col("payments");
  const pay = await payments.findOneAndUpdate({ _id: orderId, status: "created" }, { $set: { status: "paid", paymentId, paidAt: new Date(), via } }, { returnDocument: "after" });
  if (!pay) { if (!(await payments.findOne({ _id: orderId }))) throw new NotFoundError("Payment not found.", { code: "PAYMENT_NOT_FOUND" }); return; }
  const item = pay.item as Doc, uid = String(pay.userId);
  if (item.kind === "plan") await givePlan(uid, String(item.plan), String(item.period), orderId);
  else await giveExtra(uid, Number(item.credits), `Top-up: ${item.label}`, orderId);
  // marketing, never in the way of the purchase itself: the coupon's use, an invite rewarded on a purchase, the affiliate's commission
  const coupon = (pay.price as Doc | undefined)?.coupon as Doc | null | undefined;
  await Promise.allSettled([
    coupon ? couponUsed(String(coupon.code), uid, orderId, Number(coupon.off)) : Promise.resolve(),
    rewardFor(uid, "purchase", grantCredits),
    affiliateCommission(uid, orderId, Number(pay.amount) / 100),
    sendReceipt(orderId), // the receipt by email (server/receipts.ts)
  ]);
}
export async function createOrder(itemKey: string, couponCode?: string | null) {
  if (!paymentsOpen()) throw new ValidationFailed("Online payment is not open yet.", { code: "PAYMENTS_CLOSED" });
  const uid = uidOrThrow(), base = await describe(itemKey), price = await quote(uid, base, couponCode);
  if (couponCode && price.couponError) throw new ValidationFailed(price.couponError, { code: "COUPON_INVALID" });
  const item = { ...base, rupees: price.final };
  const user = ObjectId.isValid(uid) ? await (await col("users")).findOne({ _id: new ObjectId(uid) }) : null;
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(2, 14);
  let order: Doc;
  try {
    const r = await fetch(`${RAZORPAY}/orders`, { method: "POST", headers: { Authorization: `Basic ${Buffer.from(`${settings.razorpayKeyId}:${settings.razorpayKeySecret}`).toString("base64")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Math.trunc(item.rupees) * 100, currency: "INR", receipt: `u${uid.slice(-8)}_${ts}`, notes: { userId: uid, item: itemKey } }), signal: AbortSignal.timeout(30_000) });
    if (r.status >= 300) { console.warn(`razorpay order failed: ${r.status} ${(await r.text()).slice(0, 200)}`); throw new AppError("The payment could not be started. Try again in a minute.", { code: "PAYMENT_START_FAILED" }); }
    order = (await r.json()) as Doc;
  } catch (e) { if (e instanceof AppError) throw e; throw new AppError("The payment service could not be reached. Try again in a minute.", { code: "PAYMENT_START_FAILED" }); }
  await (await col("payments")).insertOne({ _id: order.id, userId: uid, item, itemKey, amount: order.amount, currency: "INR", status: "created", createdAt: new Date(),
    price: { base: price.base, offer: price.offer, coupon: price.coupon, final: price.final } }); // the receipt shows the discount
  return { orderId: order.id, keyId: settings.razorpayKeyId, amount: order.amount, currency: "INR", label: item.label, email: user?.email ?? "" };
}
export async function verifyPayment(orderId: string, paymentId: string, signature: string) {
  const uid = uidOrThrow(), pay = await (await col("payments")).findOne({ _id: orderId });
  if (!pay || pay.userId !== uid) throw new NotFoundError("Payment not found.", { code: "PAYMENT_NOT_FOUND" });
  if (!same(hmacHex(settings.razorpayKeySecret, `${orderId}|${paymentId}`), signature)) throw new ValidationFailed("The payment could not be verified. If money was taken, it will be credited automatically.", { code: "PAYMENT_UNVERIFIED" });
  await fulfil(orderId, paymentId, "checkout");
  return summary(uid);
}
/** Razorpay's own report (signed with the webhook secret; public: the signature is the proof). */
export async function webhook(req: Request) {
  const secret = settings.razorpayWebhookSecret, body = Buffer.from(await req.arrayBuffer()), sig = req.headers.get("x-razorpay-signature") ?? "";
  if (!secret || !same(hmacHex(secret, body), sig)) throw new ValidationFailed("Bad signature.", { code: "WEBHOOK_UNVERIFIED" });
  const event = JSON.parse(body.toString("utf8")) as Doc;
  if (event.event === "payment.captured" || event.event === "order.paid") {
    const entity = ((((event.payload as Doc)?.payment as Doc) ?? {}).entity ?? {}) as Doc;
    if (entity.order_id && entity.id) { try { await fulfil(String(entity.order_id), String(entity.id), "webhook"); } catch (e) { if (!(e instanceof NotFoundError)) throw e; console.warn(`webhook for an unknown order ${entity.order_id}`); } }
  }
  return { ok: true };
}
export async function myPayments() {
  const uid = uidOrThrow();
  return (await (await col("payments")).find({ userId: uid }).sort({ createdAt: -1 }).limit(30).toArray()).map((p) => ({ id: p._id, label: (p.item as Doc).label, amount: Number(p.amount) / 100, status: p.status, createdAt: p.createdAt, paidAt: p.paidAt ?? null, receiptNo: p.receiptNo ?? null, paymentId: p.paymentId ?? null }));
}
/** Credits for watching a rewarded ad (the phone's "Watch an ad"): once per AdMob transaction, at most `daily` a day. */
export async function adRewardCredits(userId: string, credits: number, daily: number, transaction: string): Promise<boolean> {
  if (!enabled() || !userId || !(await (await col("wallets")).findOne({ _id: userId }))) return false;
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  if (await (await col("credit_ledger")).countDocuments({ userId, ref: /^admob:/, delta: { $gt: 0 }, at: { $gte: since } }) >= daily) return false;
  await grantCredits(userId, credits, "Watched an ad", `admob:${transaction}`);
  return true;
}
