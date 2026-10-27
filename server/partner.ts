import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { AuthRequired, clearPartnerCookie, currentUser, partnerCookie, partnerSession } from "@/server/core/auth";
import { settings } from "@/server/core/config";
import { mainDb, ObjectId } from "@/server/core/db";
import { ValidationFailed } from "@/server/core/errors";
import { codeLetter, sendMail } from "@/server/core/mail";
import { applyAffiliate, ensureUsername, getMarketing, myAffiliateDashboard, setPayoutDetails, type Payout } from "@/server/marketing";

/** The partner dashboard (/affiliate), its own place for people who only want the affiliate program. Signed in to Shubix:
 * straight in, as that account. Otherwise: their email, a 6-digit code to it, and in (a partner-only session cookie,
 * 30 days, that opens this dashboard and nothing else). A new email gets a partner-only account (no password: it cannot
 * sign in to the studio; "Forgot password" there gives it one, and then it is a full Shubix account, the same partner).
 * The code comes first, then the request to join: nobody can ask in someone else's name. */

type Doc = Record<string, unknown>;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, CODE_MINUTES = 10, CODE_TRIES = 5, RESEND_SECONDS = 60;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const col = async (name: string) => (await mainDb()).collection<any>(name);
const hash = (email: string, code: string) => crypto.createHmac("sha256", settings.secretKey || "partner").update(`${email}:${code}`).digest("hex");
const clean = (e: string) => e.trim().toLowerCase();
function needAccounts() { if (!settings.authEnabled) throw new ValidationFailed("Accounts are not switched on for this studio.", { code: "AUTH_DISABLED" }); }

/** who is on the partner dashboard: the Shubix session first, else the partner-only one */
async function who(req: Request): Promise<{ uid: string; via: "shubix" | "partner" } | null> {
  const s = currentUser(); if (s) return { uid: s, via: "shubix" };
  const p = await partnerSession(req); return p ? { uid: p, via: "partner" } : null;
}
async function need(req: Request) { const w = await who(req); if (!w) throw new AuthRequired("Enter your email to open your partner dashboard."); return w; }

/** Email a sign-in code (a new one at most once a minute; the same answer whether or not the email is known). */
export async function sendPartnerCode(email0: string) {
  needAccounts();
  const email = clean(email0);
  if (!EMAIL.test(email)) throw new ValidationFailed("Enter a valid email address.", { code: "INVALID_EMAIL" });
  const codes = await col("partner_codes"), old = await codes.findOne({ _id: email });
  const wait = old?.sentAt ? Math.ceil((new Date(old.sentAt).getTime() + RESEND_SECONDS * 1000 - Date.now()) / 1000) : 0;
  if (wait > 0) throw new ValidationFailed(`We just sent one: wait ${wait} seconds, then try again.`, { code: "VERIFY_TOO_SOON", details: { wait } });
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0"), b = settings.businessName;
  await codes.updateOne({ _id: email }, { $set: { hash: hash(email, code), expires: new Date(Date.now() + CODE_MINUTES * 60_000), tries: 0, sentAt: new Date() } }, { upsert: true });
  const m = codeLetter("Your partner dashboard code", `Enter this code to open your ${b} affiliate partner dashboard.`, code,
    `The code works for ${CODE_MINUTES} minutes. If you did not ask for it, you can safely ignore this email.`, "Partner sign-in");
  await sendMail(email, `${code} is your ${b} partner code`, m.text, m.html);
  return { ok: true, wait: RESEND_SECONDS };
}

/** The code from the email: signed in to the partner dashboard (the account made now if the email is new). */
export async function verifyPartnerCode(email0: string, code: string) {
  needAccounts();
  const email = clean(email0), codes = await col("partner_codes"), c = await codes.findOne({ _id: email });
  const fail = (msg: string, k: string) => new ValidationFailed(msg, { code: k });
  if (!c || new Date(c.expires).getTime() < Date.now()) throw fail("This code has expired. Ask for a new one.", "CODE_EXPIRED");
  if (c.tries >= CODE_TRIES) throw fail("Too many wrong tries. Ask for a new code.", "CODE_LOCKED");
  if (!/^\d{6}$/.test(code) || !crypto.timingSafeEqual(Buffer.from(hash(email, code)), Buffer.from(String(c.hash)))) {
    await codes.updateOne({ _id: email }, { $inc: { tries: 1 } });
    const left = CODE_TRIES - c.tries - 1;
    throw left > 0 ? fail(`That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`, "CODE_WRONG") : fail("Too many wrong tries. Ask for a new code.", "CODE_LOCKED");
  }
  if (!(await codes.deleteOne({ _id: email, hash: c.hash })).deletedCount) throw fail("This code was already used. Ask for a new one.", "CODE_EXPIRED");
  const users = await col("users");
  let u: Doc | null = await users.findOne({ email });
  if (!u) {
    const now = new Date(), fresh = { _id: new ObjectId(), email, partnerOnly: true, emailVerified: true, sessionVersion: 0, createdAt: now, lastLoginAt: now, loginCount: 1 };
    try { await users.insertOne(fresh); u = fresh; } catch (e) { if ((e as { code?: number }).code !== 11000) throw e; u = await users.findOne({ email }); } // the same email at the same moment
    await ensureUsername(String(u!._id)); // their link: /?ref=username
  } else {
    await users.updateOne({ _id: u._id }, { $set: { emailVerified: true, lastLoginAt: new Date() } }); // the code proves the email
  }
  return Response.json({ ok: true }, { headers: { "Set-Cookie": partnerCookie(u as { _id: unknown; sessionVersion?: unknown }) } });
}

export const partnerLogout = () => Response.json({ ok: true }, { headers: { "Set-Cookie": clearPartnerCookie() } });

/** The dashboard: who is here (signed out: null), the program's terms, and their affiliate picture (null: not asked yet). */
export async function partnerMe(req: Request) {
  const m = await getMarketing(), program = { on: m.affiliate.on, applyOpen: m.affiliate.applyOpen, percent: m.affiliate.percent, months: m.affiliate.months, minPayout: m.affiliate.minPayout };
  const w = await who(req);
  if (!w) return { via: null, email: null, program, affiliate: null };
  const u = ObjectId.isValid(w.uid) ? await (await col("users")).findOne({ _id: new ObjectId(w.uid) }, { projection: { email: 1 } }) : null;
  return { via: w.via, email: String(u?.email ?? ""), program, ...(await myAffiliateDashboard(w.uid)) };
}
export const PartnerApplyIn = z.object({ note: z.string().trim().max(300).default("") });
export async function partnerApply(req: Request, note: string) { const w = await need(req); return applyAffiliate(w.uid, note); }
export async function partnerPayout(req: Request, d: Payout) { const w = await need(req); return setPayoutDetails(d, w.uid); }
