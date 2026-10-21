import "server-only";
import { z } from "zod";
import { currentUser } from "@/server/core/auth";
import { mainDb, ObjectId, OWNER, parseId } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";
import { adjustCredits, enabled as billingOn, wallet } from "@/server/credits";
import { getPricing } from "@/server/workspace";

/** The admin dashboard (Administration → Overview / Users): who is on the site right now, who signed up, who paid what,
 * how many credits each person has left. Presence: every open tab pings /api/public/ping about every 30 s (signed in or
 * not); a visitor seen in the last ONLINE_MS is "online now". Visits are kept 30 days (a TTL index) for the day counts. */

type Doc = Record<string, unknown>;
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone; // days and months as the server's clock counts them
const ONLINE_MS = 6 * 60_000, DAY = 86400_000, SEEN_EVERY = 5 * 60_000, KEEP_DAYS = 30;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
let indexed = false;
const lastSeenWrite = new Map<string, number>(), iosAppWrite = new Map<string, number>();

/** app: the page runs as the installed app (home screen), so an iPhone's Safari can tell it is installed (accounts.ts me) */
export const pingBody = z.object({ visitor: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), path: z.string().max(300).default("/"), app: z.boolean().default(false) });

/** One open tab says it is still here. */
export async function ping(visitor: string, path: string, userAgent: string, app = false) {
  const presence = await col("presence"), now = new Date(), uid = currentUser();
  if (!indexed) { indexed = true; await presence.createIndex({ at: 1 }, { expireAfterSeconds: KEEP_DAYS * 86400 }).catch(() => { indexed = false; }); }
  const device = /mobile|android|iphone|ipad/i.test(userAgent) ? "phone" : "computer";
  await presence.updateOne({ _id: visitor }, { $set: { at: now, path, uid, device }, $setOnInsert: { firstAt: now } }, { upsert: true });
  // the app opened on an iPhone: noted at once (then once an hour), so its Safari stops offering to install it
  const iosApp = !!uid && app && /iphone|ipad|ipod/i.test(userAgent) && now.getTime() - (iosAppWrite.get(uid) ?? 0) > 3600_000;
  if (uid && ObjectId.isValid(uid) && (iosApp || now.getTime() - (lastSeenWrite.get(uid) ?? 0) > SEEN_EVERY)) {
    lastSeenWrite.set(uid, now.getTime());
    if (iosApp) iosAppWrite.set(uid, now.getTime());
    await (await col("users")).updateOne({ _id: new ObjectId(uid) }, { $set: { lastSeenAt: now, ...(iosApp ? { iosAppAt: now } : {}) } });
  }
  return { ok: true };
}

const startOfDay = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function emailsById(ids: string[]): Promise<Map<string, string>> {
  const oids = [...new Set(ids)].filter((i) => ObjectId.isValid(i)).map((i) => new ObjectId(i));
  if (!oids.length) return new Map();
  return new Map((await (await col("users")).find({ _id: { $in: oids } }, { projection: { email: 1 } }).toArray()).map((u) => [String(u._id), String(u.email)]));
}

/** Who is on the site right now (newest first), signed in or guest. */
async function onlineNow() {
  const rows = await (await col("presence")).find({ at: { $gte: new Date(Date.now() - ONLINE_MS) } }).sort({ at: -1 }).limit(500).toArray();
  const emails = await emailsById(rows.filter((r) => r.uid).map((r) => String(r.uid)));
  const visitors = rows.map((r) => ({ id: String(r._id), email: r.uid ? (emails.get(String(r.uid)) ?? null) : null, path: String(r.path ?? "/"), device: String(r.device ?? "computer"), at: r.at, since: r.firstAt ?? r.at }));
  return { total: visitors.length, signedIn: new Set(rows.filter((r) => r.uid).map((r) => String(r.uid))).size, guests: visitors.filter((v) => !v.email).length, visitors: visitors.slice(0, 50) };
}

export async function overview() {
  const now = Date.now(), today = startOfDay(), week = new Date(now - 7 * DAY), month = new Date(now - 30 * DAY);
  const [users, presence, payments, wallets, ledger, reels] = await Promise.all(["users", "presence", "payments", "wallets", "credit_ledger", "studio_reels"].map(col));
  const yearAgo = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1), twoWeeks = startOfDay(new Date(now - 13 * DAY));
  const [totalUsers, newToday, newWeek, visitorsToday, visitorsWeek, online, paid, signupDays, revenueMonths, walletSum, plans, used, savedReels, recentUsers, recentPayments, pricing] = await Promise.all([
    users.countDocuments({}),
    users.countDocuments({ createdAt: { $gte: today } }),
    users.countDocuments({ createdAt: { $gte: week } }),
    presence.countDocuments({ at: { $gte: today } }),
    presence.countDocuments({ at: { $gte: week } }),
    onlineNow(),
    payments.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 }, buyers: { $addToSet: "$userId" }, month: { $sum: { $cond: [{ $gte: ["$paidAt", month] }, "$amount", 0] } } } }]).toArray(),
    users.aggregate([{ $match: { createdAt: { $gte: twoWeeks } } }, { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: TZ } }, n: { $sum: 1 } } }]).toArray(),
    payments.aggregate([{ $match: { status: "paid", paidAt: { $gte: yearAgo } } }, { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt", timezone: TZ } }, total: { $sum: "$amount" }, n: { $sum: 1 } } }]).toArray(),
    wallets.aggregate([{ $group: { _id: null, credits: { $sum: { $add: [{ $ifNull: ["$monthly", 0] }, { $ifNull: ["$extra", 0] }] } } } }]).toArray(),
    wallets.aggregate([{ $group: { _id: "$plan", n: { $sum: 1 } } }]).toArray(),
    ledger.aggregate([{ $match: { delta: { $lt: 0 }, refunded: { $ne: true }, at: { $gte: month } } }, { $group: { _id: null, credits: { $sum: "$delta" } } }]).toArray(),
    reels.countDocuments({ status: "ready" }),
    users.find({}, { projection: { email: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(6).toArray(),
    payments.find({ status: "paid" }).sort({ paidAt: -1 }).limit(6).toArray(),
    getPricing(),
  ]);
  const names = new Map(pricing.plans.map((p) => [p.id, p.name])), payEmails = await emailsById(recentPayments.map((p) => String(p.userId ?? "")));
  const signups = new Map(signupDays.map((d) => [String(d._id), Number(d.n)])), revenue = new Map(revenueMonths.map((m) => [String(m._id), Number(m.total) / 100]));
  const p = paid[0] ?? { total: 0, count: 0, buyers: [], month: 0 };
  return {
    billing: billingOn(),
    users: { total: totalUsers, today: newToday, week: newWeek, buyers: (p.buyers as unknown[]).filter(Boolean).length },
    visitors: { online: online.total, onlineSignedIn: online.signedIn, onlineGuests: online.guests, today: visitorsToday, week: visitorsWeek },
    online: online.visitors,
    revenue: { total: Number(p.total) / 100, month: Number(p.month) / 100, payments: Number(p.count) },
    credits: { left: Number(walletSum[0]?.credits ?? 0), used30d: -Number(used[0]?.credits ?? 0) },
    reels: { total: savedReels },
    plans: plans.map((x) => ({ plan: String(x._id ?? "free"), name: names.get(String(x._id)) ?? String(x._id ?? "Free"), users: Number(x.n) })).sort((a, b) => b.users - a.users),
    signupsByDay: Array.from({ length: 14 }, (_, i) => { const d = dayKey(new Date(twoWeeks.getTime() + i * DAY)); return { day: d, users: signups.get(d) ?? 0 }; }),
    revenueByMonth: Array.from({ length: 12 }, (_, i) => { const m = monthKey(new Date(yearAgo.getFullYear(), yearAgo.getMonth() + i, 1)); return { month: m, rupees: revenue.get(m) ?? 0 }; }),
    recentUsers: recentUsers.map((u) => ({ id: String(u._id), email: String(u.email), createdAt: u.createdAt ?? null })),
    recentPayments: recentPayments.map((x) => ({ id: String(x._id), email: payEmails.get(String(x.userId)) ?? (x.accountDeleted ? "Deleted account" : "—"), label: String((x.item as Doc)?.label ?? ""), rupees: Number(x.amount) / 100, paidAt: x.paidAt ?? null })),
  };
}

/** Every account with its logins, purchases, credits and Reels (a studio of up to a few thousand people). */
export async function listUsers() {
  const [list, paid, ws, used, made, online, pricing] = await Promise.all([
    (await col("users")).find({}, { projection: { email: 1, createdAt: 1, lastLoginAt: 1, lastSeenAt: 1, loginCount: 1 } }).sort({ createdAt: -1 }).limit(5000).toArray(),
    (await col("payments")).aggregate([{ $match: { status: "paid" } }, { $group: { _id: "$userId", rupees: { $sum: "$amount" }, n: { $sum: 1 }, last: { $max: "$paidAt" } } }]).toArray(),
    (await col("wallets")).find({}).toArray(),
    (await col("credit_ledger")).aggregate([{ $match: { delta: { $lt: 0 }, refunded: { $ne: true } } }, { $group: { _id: "$userId", credits: { $sum: "$delta" } } }]).toArray(),
    (await col("studio_reels")).aggregate([{ $match: { status: "ready" } }, { $group: { _id: `$${OWNER}`, n: { $sum: 1 } } }]).toArray(),
    (await col("presence")).distinct("uid", { at: { $gte: new Date(Date.now() - ONLINE_MS) }, uid: { $ne: null } }),
    getPricing(),
  ]);
  const by = <T extends Doc>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r]));
  const P = by(paid), W = by(ws), U = by(used), M = by(made), on = new Set(online.map(String)), names = new Map(pricing.plans.map((p) => [p.id, p.name]));
  return list.map((u) => {
    const id = String(u._id), w = W.get(id), pay = P.get(id);
    return {
      id, email: String(u.email), createdAt: u.createdAt ?? null, lastLoginAt: u.lastLoginAt ?? null, lastSeenAt: u.lastSeenAt ?? null, logins: Number(u.loginCount ?? 0), online: on.has(id),
      plan: String(w?.plan ?? "free"), planName: names.get(String(w?.plan ?? "free")) ?? String(w?.plan ?? "Free"), planEnds: w?.planEnds ?? null,
      credits: w ? Number(w.monthly ?? 0) + Number(w.extra ?? 0) : null, creditsUsed: -Number(U.get(id)?.credits ?? 0),
      spent: Number(pay?.rupees ?? 0) / 100, purchases: Number(pay?.n ?? 0), lastPurchase: pay?.last ?? null, reels: Number(M.get(id)?.n ?? 0),
    };
  });
}

/** One person, in full: payments, credit history, recent Reels, devices online now. */
export async function userDetail(id: string) {
  const oid = parseId(id, "User"), u = await (await col("users")).findOne({ _id: oid }, { projection: { password: 0, reset: 0 } });
  if (!u) throw new NotFoundError("User not found.", { code: "USER_NOT_FOUND" });
  const [payments, history, reels, devices] = await Promise.all([
    (await col("payments")).find({ userId: id }).sort({ createdAt: -1 }).limit(50).toArray(),
    (await col("credit_ledger")).find({ userId: id }).sort({ at: -1 }).limit(50).toArray(),
    (await col("studio_reels")).find({ [OWNER]: id, status: "ready" }, { projection: { name: 1, status: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(12).toArray(),
    (await col("presence")).find({ uid: id }).sort({ at: -1 }).limit(10).toArray(),
  ]);
  const w = billingOn() ? await wallet(id) : null, names = new Map((await getPricing()).plans.map((p) => [p.id, p.name]));
  return {
    id, email: String(u.email), createdAt: u.createdAt ?? null, lastLoginAt: u.lastLoginAt ?? null, lastSeenAt: u.lastSeenAt ?? null, logins: Number(u.loginCount ?? 0),
    wallet: w ? { plan: String(w.plan), planName: names.get(String(w.plan)) ?? String(w.plan), period: w.period ?? null, monthly: Number(w.monthly ?? 0), extra: Number(w.extra ?? 0), balance: Number(w.monthly ?? 0) + Number(w.extra ?? 0), planEnds: w.planEnds ?? null, renews: w.cycleEnds ?? null } : null,
    payments: payments.map((p) => ({ id: String(p._id), label: String((p.item as Doc)?.label ?? ""), rupees: Number(p.amount) / 100, status: String(p.status), createdAt: p.createdAt ?? null, paidAt: p.paidAt ?? null, via: p.via ?? null })),
    history: history.map((e) => ({ delta: Number(e.delta), reason: String(e.reason ?? ""), at: e.at ?? null, balance: e.balance ?? null, refunded: Boolean(e.refunded) })),
    reels: reels.map((r) => ({ id: String(r._id), name: String(r.name ?? "Untitled"), status: String(r.status ?? ""), createdAt: r.createdAt ?? null })),
    devices: devices.map((d) => ({ device: String(d.device ?? "computer"), path: String(d.path ?? "/"), at: d.at ?? null, online: d.at && new Date(d.at).getTime() > Date.now() - ONLINE_MS })),
  };
}

export const creditsBody = z.object({ credits: z.number().int().min(-100_000).max(100_000).refine((n) => n !== 0, "Enter a number of credits other than 0."), note: z.string().trim().max(120).default("") });

/** Give (or take back) credits by hand, e.g. a goodwill top-up; logged in the person's credit history. */
export async function giveCredits(id: string, credits: number, note: string) {
  parseId(id, "User");
  if (!(await (await col("users")).findOne({ _id: new ObjectId(id) }, { projection: { _id: 1 } }))) throw new NotFoundError("User not found.", { code: "USER_NOT_FOUND" });
  await adjustCredits(id, credits, note || (credits > 0 ? "Credits from the studio" : "Credits removed by the studio"));
  return userDetail(id);
}
