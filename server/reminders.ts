import "server-only";
import { mainDb, ObjectId } from "@/server/core/db";
import { esc, frame, mailParts as P, sendMail, siteUrl } from "@/server/core/mail";
import { currentOffer, getMarketing } from "@/server/marketing";

/** "You left something in checkout": someone opened the payment for a plan or top-up and did not pay. One email, a few
 * hours later (Admin → Marketing → Email notes: on/off and how many hours), only if they have not bought anything since,
 * at most one a week per person, and only for checkouts of the last 7 days. There is no cart: a purchase is one plan or
 * one top-up, so the checkout itself is what is remembered. The sweep runs by itself as people use the site
 * (`sweepSoon`, every 10 minutes at most) or from /api/cron/reminders. */

type Doc = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const WEEK = 7 * 86400_000;

export async function remindAbandoned(now = Date.now()) {
  const m = await getMarketing();
  if (!m.emails.cartReminder) return { sent: 0 };
  const pays = await col("payments");
  const due = await pays.find({ status: "created", reminderSentAt: { $exists: false }, createdAt: { $gte: new Date(now - WEEK), $lte: new Date(now - m.emails.cartHours * 3600_000) } })
    .sort({ createdAt: -1 }).limit(200).toArray();
  const seen = new Set<string>();
  let sent = 0;
  for (const p of due) {
    const uid = String(p.userId);
    if (seen.has(uid) || sent >= 50) continue; // the latest checkout per person; a few at a time
    seen.add(uid);
    // bought since, or reminded this week: nothing
    if (await pays.findOne({ userId: uid, status: "paid", paidAt: { $gte: p.createdAt } }, { projection: { _id: 1 } })) continue;
    if (await pays.findOne({ userId: uid, reminderSentAt: { $gte: new Date(now - WEEK) } }, { projection: { _id: 1 } })) continue;
    const claim = await pays.updateOne({ _id: p._id, reminderSentAt: { $exists: false } }, { $set: { reminderSentAt: new Date(now) } });
    if (!claim.modifiedCount) continue;
    const user = ObjectId.isValid(uid) ? await (await col("users")).findOne({ _id: new ObjectId(uid) }, { projection: { email: 1 } }) : null;
    if (!user?.email) continue;
    const item = p.item as Doc, price = Number(p.amount) / 100, offer = await currentOffer().catch(() => null);
    const name = String(item.label);
    const line = item.kind === "plan"
      ? `You were one step away from ${name.replace(/ · .*/, "")}: Shubix AI edits your Reels for you, with no ads and no watermark.`
      : `You were one step away from ${name}: credits for AI Reels and Ask Shubix, and they never expire.`;
    const html = frame(`Your ${name} is still waiting · ${inr(price)}`,
      P.eyebrow("Still deciding?") + P.heading(`Your ${name.replace(/ · .*/, "")} is waiting`) + P.para(line)
      + P.row(`<p style="margin:0;font-family:${P.SANS};font-size:14px;color:${P.BODY}">Your price: <b style="color:${P.INK}">${esc(inr(price))}</b>${offer ? ` · <span style="color:#15803d">${esc(offer.title)}: ${offer.percent}% off right now</span>` : ""}</p>`, "0 0 24px 0")
      + P.button("Complete my purchase", `${siteUrl()}/pricing`)
      + P.note("You get this email once, because you started a checkout and did not finish it. Nothing was charged."));
    const text = `Your ${name} is waiting\n\n${line}\n\nYour price: ${inr(price)}${offer ? ` (${offer.title}: ${offer.percent}% off right now)` : ""}\n\nComplete my purchase: ${siteUrl()}/pricing\n\nYou get this email once, because you started a checkout and did not finish it. Nothing was charged.\n`;
    if (await sendMail(String(user.email), `Still thinking about ${name.replace(/ · .*/, "")}?`, text, html)) sent++;
  }
  return { sent };
}

const g = globalThis as unknown as { __remindAt?: number };
/** Run the sweep in the background now and then (at most every 10 minutes), as people use the site. */
export function sweepSoon() {
  const now = Date.now();
  if (g.__remindAt && now - g.__remindAt < 10 * 60_000) return;
  g.__remindAt = now;
  void remindAbandoned(now).catch((e) => console.warn(`checkout reminders: ${(e as Error).message}`));
}
