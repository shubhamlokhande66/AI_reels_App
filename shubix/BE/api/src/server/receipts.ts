import { settings } from "./core/config";
import { mainDb, ObjectId } from "./core/db";
import { esc, frame, mailAdmins, mailParts as P, sendMail, siteUrl } from "./core/mail";
import { getSite } from "./site";

/** The receipt after a successful payment (always sent: it is the record of a purchase, not a note): a receipt number in
 * order (SHX-2026-000001), the date, who paid, the item, the price with its offer and coupon, the total, what was added
 * (the plan until a date, or the credits), the payment's ids, the business's details and the no-refund line. */

type Doc = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }) + " IST";
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });

/** The next receipt number, once per payment (kept on it, so a second call gives the same one). */
async function receiptNo(orderId: string, at: Date) {
  const pays = await col("payments"), had = await pays.findOne({ _id: orderId }, { projection: { receiptNo: 1 } });
  if (had?.receiptNo) return String(had.receiptNo);
  const c = await (await col("counters")).findOneAndUpdate({ _id: "receipt" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  const prefix = (settings.businessName.replace(/[^A-Za-z]/g, "").slice(0, 3) || "RCT").toUpperCase();
  const no = `${prefix}-${at.getFullYear()}-${String(c?.seq ?? 1).padStart(6, "0")}`;
  const r = await pays.findOneAndUpdate({ _id: orderId, receiptNo: { $exists: false } }, { $set: { receiptNo: no } }, { returnDocument: "after" });
  return String(r?.receiptNo ?? (await pays.findOne({ _id: orderId }))?.receiptNo ?? no);
}

/** The receipt email's parts (also for the admin's preview). */
export function receiptLetter(r: {
  no: string; at: Date; email: string; label: string; kind: string; base: number; offer: { title: string; off: number } | null; coupon: { code: string; off: number } | null;
  total: number; paymentId: string; orderId: string; got: string; balance: number | null;
  site: { businessName: string; businessAddress: string; supportEmail: string; supportPhone: string; gstin?: string };
}) {
  const line = (k: string, v: string, o: { strong?: boolean; color?: string } = {}) => `<tr>
<td style="padding:9px 0;font-family:${P.SANS};font-size:13.5px;color:${o.strong ? P.INK : P.BODY};${o.strong ? "font-weight:700;" : ""}">${esc(k)}</td>
<td align="right" style="padding:9px 0;font-family:${P.SANS};font-size:13.5px;color:${o.color ?? (o.strong ? P.INK : P.BODY)};${o.strong ? "font-weight:700;font-size:16px;" : ""}white-space:nowrap">${esc(v)}</td></tr>`;
  const rule = `<tr><td colspan="2" style="padding:4px 0"><div style="height:1px;background:${P.RULE};font-size:0;line-height:1px">&nbsp;</div></td></tr>`;
  const meta = (k: string, v: string) => `<td valign="top" style="padding:0 16px 14px 0;width:50%"><span style="display:block;font-family:${P.SANS};font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${P.SOFT}">${esc(k)}</span>
<span style="display:block;padding-top:4px;font-family:${P.SANS};font-size:13.5px;color:${P.INK};word-break:break-all">${esc(v)}</span></td>`;
  const s = r.site, gst = s.gstin ? `GSTIN ${s.gstin}` : "";
  const body = P.eyebrow("Payment receipt") + P.heading("Thank you for your purchase") + P.para(`Your payment was successful. ${r.got}`)
    + P.row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${meta("Receipt no.", r.no)}${meta("Date", when(r.at))}</tr><tr>${meta("Billed to", r.email)}${meta("Payment method", "Razorpay")}</tr></table>`, "0 0 8px 0")
    + P.row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8fd;border:1px solid ${P.RULE};border-radius:16px;padding:6px 20px">
${line(r.label, inr(r.base))}
${r.offer ? line(`Offer: ${r.offer.title}`, `− ${inr(r.offer.off)}`, { color: "#15803d" }) : ""}
${r.coupon ? line(`Coupon ${r.coupon.code}`, `− ${inr(r.coupon.off)}`, { color: "#15803d" }) : ""}
${rule}
${line("Total paid", inr(r.total), { strong: true })}
<tr><td colspan="2" style="padding:0 0 10px 0;font-family:${P.SANS};font-size:11.5px;color:${P.SOFT}">Inclusive of all taxes (GST)${gst ? ` · ${esc(gst)}` : ""}</td></tr>
</table>`, "0 0 22px 0")
    + (r.balance !== null ? P.row(`<p style="margin:0;font-family:${P.SANS};font-size:13.5px;color:${P.BODY}">Your credit balance now: <b style="color:${P.INK}">${r.balance.toLocaleString("en-IN")} credits</b></p>`, "0 0 22px 0") : "")
    + P.button("Start creating", `${siteUrl()}/create/music`)
    + P.row(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${meta("Payment ID", r.paymentId)}${meta("Order ID", r.orderId)}</tr></table>`, "0 0 6px 0")
    + P.note(`All purchases are final and non-refundable, as set out in our Refund & Cancellation Policy (${siteUrl()}/refunds). If you were charged twice or something was not added, write to ${s.supportEmail || "us from the Contact page"} with your receipt number and we will make it right.`);
  const footer = [s.businessName, s.businessAddress, gst, [s.supportEmail, s.supportPhone].filter(Boolean).join(" · ")].filter(Boolean).map(esc).join("<br>");
  const html = frame(`Receipt ${r.no} · ${r.label} · ${inr(r.total)}`, body, footer);
  const text = [`Payment receipt ${r.no}`, `Thank you for your purchase. ${r.got}`, "", `Date: ${when(r.at)}`, `Billed to: ${r.email}`, "",
    `${r.label}: ${inr(r.base)}`, r.offer ? `Offer (${r.offer.title}): -${inr(r.offer.off)}` : "", r.coupon ? `Coupon ${r.coupon.code}: -${inr(r.coupon.off)}` : "",
    `Total paid: ${inr(r.total)} (inclusive of GST${gst ? `, ${gst}` : ""})`, "", `Payment ID: ${r.paymentId}`, `Order ID: ${r.orderId}`, "",
    "All purchases are final and non-refundable.", `${siteUrl()}/refunds`, "", [s.businessName, s.businessAddress, s.supportEmail].filter(Boolean).join(" · ")].filter((x) => x !== "").join("\n");
  return { html, text, subject: `Your ${settings.businessName} receipt ${r.no} · ${r.label} · ${inr(r.total)}` };
}

/** Email the receipt for a paid order (once; never in the way of the purchase). */
export async function sendReceipt(orderId: string) {
  try {
    const pays = await col("payments"), pay = await pays.findOne({ _id: orderId });
    if (!pay || pay.status !== "paid" || pay.receiptSentAt) return false;
    const uid = String(pay.userId), at = new Date((pay.paidAt as Date) ?? Date.now());
    const [no, site, user, w] = await Promise.all([
      receiptNo(orderId, at), getSite(),
      ObjectId.isValid(uid) ? (await col("users")).findOne({ _id: new ObjectId(uid) }, { projection: { email: 1 } }) : null,
      (await col("wallets")).findOne({ _id: uid }),
    ]);
    if (!user?.email) return false;
    const item = pay.item as Doc, price = (pay.price as Doc | undefined) ?? {};
    const total = Number(pay.amount) / 100, base = Number(price.base ?? total);
    const offer = price.offer as { title: string; off: number } | null | undefined, coupon = price.coupon as { code: string; off: number } | null | undefined;
    const got = item.kind === "plan"
      ? `Your ${String(item.label).replace(/ · .*/, "")} is active${w?.planEnds ? ` until ${day(new Date(w.planEnds))}` : ""}.`
      : `${Number(item.credits).toLocaleString("en-IN")} credits were added to your account; they never expire.`;
    const balance = w ? Number(w.monthly ?? 0) + Number(w.extra ?? 0) : null;
    const m = receiptLetter({ no, at, email: String(user.email), label: String(item.label), kind: String(item.kind), base, offer: offer ?? null, coupon: coupon ?? null, total,
      paymentId: String(pay.paymentId ?? ""), orderId, got, balance, site });
    // claimed before sending: the browser and the webhook may both finish the payment
    const claim = await pays.updateOne({ _id: orderId, receiptSentAt: { $exists: false } }, { $set: { receiptSentAt: new Date() } });
    if (!claim.modifiedCount) return false;
    const ok = await sendMail(String(user.email), m.subject, m.text, m.html);
    if (!ok) await pays.updateOne({ _id: orderId }, { $unset: { receiptSentAt: "" } }); // not sent: may be sent again
    void mailAdmins(`New sale: ${inr(total)} · ${item.label}`, `${inr(total)} · ${item.label}`, `${user.email} paid ${inr(total)} for ${item.label} (receipt ${no}${coupon ? `, coupon ${coupon.code}` : ""}).`, "Open the dashboard", "/admin");
    return ok;
  } catch (e) { console.warn(`receipt for ${orderId} failed: ${(e as Error).message}`); return false; }
}
