import crypto from "node:crypto";
import { z } from "zod";
import { AuthRequired, currentUser } from "./core/auth";
import { settings } from "./core/config";
import { mainDb, ObjectId } from "./core/db";
import { NotFoundError, ValidationFailed } from "./core/errors";
import { esc, frame, mailParts as P, sendMail, siteUrl } from "./core/mail";

/** Admin → Messages: a message from the administrator to the people of the studio, in the bell (the site and the phone
 * app, which shows the site) and, if chosen, by email. Who gets it: everyone, the paying ones (a paid plan now), the
 * free ones, or the affiliates (active). The bell shows the last 60 days of messages meant for the person; email goes
 * once, at sending, to those who did not turn announcement emails off (the link in every one of them). */

type Doc = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const SHOW_DAYS = 60, EMAIL_MAX = 400; // Gmail sends about 500 a day: one message never takes all of it

export const AUDIENCES = ["all", "paying", "free", "affiliates"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const BroadcastIn = z.object({
  title: z.string().trim().min(2, "A title, please.").max(80),
  body: z.string().trim().min(2, "A message, please.").max(1500),
  link: z.string().trim().max(300).refine((s) => !s || /^\/[^/\\]/.test(s) || /^https:\/\//.test(s), "A link starts with / (a page of the app) or https://").default(""),
  button: z.string().trim().max(30).default(""),
  audience: z.enum(AUDIENCES),
  email: z.boolean().default(false),
  dryRun: z.boolean().default(false), // only count who would get it
});

/** the accounts of an audience (partner-only accounts, made on the partner dashboard, are only in "affiliates") */
async function recipients(audience: Audience): Promise<{ id: string; email: string; emailsOff: boolean }[]> {
  const users = await (await col("users")).find(audience === "affiliates" ? {} : { partnerOnly: { $ne: true } }, { projection: { email: 1, emailsOff: 1 } }).toArray();
  let keep: Set<string> | null = null;
  if (audience === "paying" || audience === "free") {
    const paid = await (await col("wallets")).find({ plan: { $nin: ["free", null] } }, { projection: { _id: 1 } }).toArray();
    const ids = new Set(paid.map((w) => String(w._id)));
    keep = audience === "paying" ? ids : new Set(users.map((u) => String(u._id)).filter((id) => !ids.has(id)));
  } else if (audience === "affiliates") {
    keep = new Set((await (await col("affiliates")).find({ status: "active" }, { projection: { _id: 1 } }).toArray()).map((a) => String(a._id)));
  }
  return users.filter((u) => !keep || keep.has(String(u._id))).map((u) => ({ id: String(u._id), email: String(u.email), emailsOff: !!u.emailsOff }));
}

/** does this person belong to the message's audience (now)? */
async function inAudience(uid: string, audience: Audience, partnerOnly: boolean): Promise<boolean> {
  if (audience === "affiliates") return !!(await (await col("affiliates")).findOne({ _id: uid, status: "active" }, { projection: { _id: 1 } }));
  if (partnerOnly) return false;
  if (audience === "all") return true;
  const w = await (await col("wallets")).findOne({ _id: uid }, { projection: { plan: 1 } });
  const paying = !!w?.plan && w.plan !== "free";
  return audience === "paying" ? paying : !paying;
}

// ------------------------------------------------------------------ unsubscribing from the announcement emails
const unsubSig = (uid: string) => crypto.createHmac("sha256", settings.secretKey || "unsub").update(`unsub:${uid}`).digest("base64url").slice(0, 22);
export const unsubscribeLink = (uid: string) => `${siteUrl()}/api/public/unsubscribe?u=${uid}&s=${unsubSig(uid)}`;
export async function unsubscribe(uid: string, sig: string) {
  const want = unsubSig(uid);
  if (!ObjectId.isValid(uid) || sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  await (await col("users")).updateOne({ _id: new ObjectId(uid) }, { $set: { emailsOff: true } });
  return true;
}

// ------------------------------------------------------------------ the administrator
function letterFor(b: { title: string; body: string; link: string; button: string }, uid: string) {
  const url = b.link ? (b.link.startsWith("/") ? siteUrl() + b.link : b.link) : siteUrl();
  const off = unsubscribeLink(uid);
  const html = frame(b.body.slice(0, 120),
    P.eyebrow(settings.businessName) + P.heading(b.title)
    + P.row(`<p style="margin:0;font-family:${P.SANS};font-size:15px;line-height:1.65;color:${P.BODY};white-space:pre-line">${esc(b.body)}</p>`, "0 0 24px 0")
    + P.button(b.button || "Open Shubix", url)
    + P.note(`You get this because you have a ${settings.businessName} account.`)
    + P.row(`<p style="margin:0;font-family:${P.SANS};font-size:11.5px;color:${P.SOFT}"><a href="${esc(off)}" style="color:${P.SOFT}">Stop these emails</a></p>`, "0 0 18px 0"));
  const text = `${b.title}\n\n${b.body}\n\n${b.button || "Open Shubix"}: ${url}\n\nStop these emails: ${off}\n`;
  return { html, text };
}

/** Send a message (or, dryRun, only count who gets it): saved for the bell at once; the emails go now, a few at a time. */
export async function sendBroadcast(d: z.infer<typeof BroadcastIn>) {
  const list = await recipients(d.audience), mailable = list.filter((r) => !r.emailsOff);
  const counts = { people: list.length, emails: d.email ? Math.min(mailable.length, EMAIL_MAX) : 0, emailsOff: list.length - mailable.length };
  if (d.dryRun) return { ok: true, ...counts, over: d.email && mailable.length > EMAIL_MAX };
  if (!list.length) throw new ValidationFailed("Nobody is in this group yet.", { code: "NO_RECIPIENTS" });
  const _id = crypto.randomBytes(8).toString("hex"), at = new Date();
  const b = { title: d.title, body: d.body, link: d.link, button: d.button };
  await (await col("broadcasts")).insertOne({ _id, ...b, audience: d.audience, email: d.email, people: list.length, at, by: currentUser(), emailed: 0, emailFailed: 0 });
  let sent = 0, failed = 0;
  if (d.email) {
    const queue = mailable.slice(0, EMAIL_MAX);
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const m = letterFor(b, r.id);
        if (await sendMail(r.email, d.title, m.text, m.html).catch(() => false)) sent++; else failed++;
      }
    };
    await Promise.all([worker(), worker(), worker()]); // three at a time: quick, gentle on the mail service
    await (await col("broadcasts")).updateOne({ _id }, { $set: { emailed: sent, emailFailed: failed } });
  }
  return { ok: true, id: _id, people: list.length, emailed: sent, emailFailed: failed, over: d.email && mailable.length > EMAIL_MAX };
}

export async function listBroadcasts() {
  const rows = await (await col("broadcasts")).find({}).sort({ at: -1 }).limit(100).toArray();
  return { broadcasts: rows.map((r) => ({ id: String(r._id), title: r.title, body: r.body, link: r.link ?? "", button: r.button ?? "", audience: r.audience, email: !!r.email, people: Number(r.people ?? 0), emailed: Number(r.emailed ?? 0), emailFailed: Number(r.emailFailed ?? 0), at: r.at })) };
}
/** taken off everyone's bell (emails already sent stay sent) */
export async function deleteBroadcast(id: string) {
  const r = await (await col("broadcasts")).deleteOne({ _id: id });
  if (!r.deletedCount) throw new NotFoundError("No such message.", { code: "BROADCAST_NOT_FOUND" });
  return { ok: true };
}

// ------------------------------------------------------------------ the person: their bell
export async function myNotifications() {
  const uid = currentUser(); if (!uid) throw new AuthRequired();
  const u: Doc | null = ObjectId.isValid(uid) ? await (await col("users")).findOne({ _id: new ObjectId(uid) }, { projection: { notesReadAt: 1, partnerOnly: 1 } }) : null;
  const rows = await (await col("broadcasts")).find({ at: { $gte: new Date(Date.now() - SHOW_DAYS * 864e5) } }).sort({ at: -1 }).limit(30).toArray();
  const mine = [];
  for (const r of rows) if (await inAudience(uid, r.audience as Audience, !!u?.partnerOnly)) mine.push(r);
  const readAt = u?.notesReadAt instanceof Date ? u.notesReadAt.getTime() : 0;
  const items = mine.slice(0, 15).map((r) => ({ id: String(r._id), title: String(r.title), body: String(r.body), link: String(r.link ?? ""), button: String(r.button ?? ""), at: r.at, unread: new Date(r.at).getTime() > readAt }));
  return { items, unread: items.filter((i) => i.unread).length };
}
export async function readNotifications() {
  const uid = currentUser(); if (!uid) throw new AuthRequired();
  if (ObjectId.isValid(uid)) await (await col("users")).updateOne({ _id: new ObjectId(uid) }, { $set: { notesReadAt: new Date() } });
  return { ok: true };
}
