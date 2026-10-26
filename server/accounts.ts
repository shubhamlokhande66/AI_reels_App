import "server-only";
import { ensureUsername, noteReferral, rewardFor } from "@/server/marketing";
import { grantCredits } from "@/server/credits";
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { AuthRequired, clearCookie, currentUser, forgetSessionCache, hashPassword, sessionCookie, verifyPassword } from "@/server/core/auth";
import { settings } from "@/server/core/config";
import { mainDb, ObjectId, OWNER, UNSCOPED } from "@/server/core/db";
import { ConflictError, ValidationFailed } from "@/server/core/errors";
import { deletePrefix } from "@/server/storage/local";
import fs from "node:fs";
import { localPath } from "@/server/storage/local";

/** Accounts (was api/auth.py and core/mailer.py): sign up / in / out, forgot + reset password, change password, delete
 * the account. With accounts off, /me says so and nothing else is needed. */

type Doc = Record<string, unknown>;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, RESET_MINUTES = 60, VERIFY_HOURS = 48, MIN_PASSWORD = 8;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users = async () => (await mainDb()).collection<any>("users");
const userOut = (u: Doc) => ({ id: String(u._id), email: u.email, emailVerified: u.emailVerified !== false, username: (u.username as string | undefined) ?? null });
const withCookie = (body: unknown, cookie: string, status = 200) => Response.json(body, { status, headers: { "Set-Cookie": cookie } });
function needAccounts() { if (!settings.authEnabled) throw new ValidationFailed("Accounts are not switched on for this studio.", { code: "AUTH_DISABLED" }); }
function checkPassword(p: string) { if (p.length < MIN_PASSWORD) throw new ValidationFailed(`Use a password of at least ${MIN_PASSWORD} characters.`, { code: "WEAK_PASSWORD" }); }
const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
async function meDoc(): Promise<Doc & { _id: unknown }> {
  const uid = currentUser(), u = uid && ObjectId.isValid(uid) ? await (await users()).findOne({ _id: new ObjectId(uid) }) : null;
  if (!u) throw new AuthRequired();
  return u;
}
/** Every older session (other phones, other browsers) stops working. */
async function newSessionVersion(id: unknown): Promise<Doc & { _id: unknown }> {
  const u = await (await users()).findOneAndUpdate({ _id: id as ObjectId }, { $inc: { sessionVersion: 1 } }, { returnDocument: "after" });
  forgetSessionCache(String(id));
  return u!;
}

/** Email over plain SMTP; without SMTP settings the message is written to the server log (a local install still works). */
export async function sendMail(to: string, subject: string, text: string, html?: string): Promise<boolean> {
  const s = settings;
  if (!(s.smtpHost && s.smtpFrom)) {
    // the message (a reset link is a key to the account) is shown only while developing, never in a live server's log
    console.warn(`email is not set up (SMTP_HOST / SMTP_FROM); would have sent to ${to}: ${subject}${process.env.NODE_ENV === "production" ? "" : `\n${text}`}`);
    return false;
  }
  const m = /^(.*)<([^>]+)>\s*$/.exec(s.smtpFrom), name = (m?.[1] ?? "").trim().replace(/^"|"$/g, "") || s.businessName, addr = (m?.[2] ?? s.smtpFrom).trim();
  try {
    const t = nodemailer.createTransport({ host: s.smtpHost, port: s.smtpPort, secure: s.smtpSsl, requireTLS: !s.smtpSsl, auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword } : undefined, connectionTimeout: 20_000 });
    await t.sendMail({ from: { name, address: addr }, to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (e) { console.warn(`email to ${to} failed: ${(e as Error).message}`); return false; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** A short branded email: the title, a line, one button, a note under it; and the same as plain text. */
function letter(title: string, line: string, button: string, link: string, note: string): { text: string; html: string } {
  const b = esc(settings.businessName);
  const html = `<!doctype html><html><body style="margin:0;background:#f4f1fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d1730">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;padding:32px 28px;box-shadow:0 10px 30px rgba(60,30,120,.08)">
<tr><td style="font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#9b5cff">${b}</td></tr>
<tr><td style="padding-top:14px;font-size:22px;font-weight:600;letter-spacing:-.01em">${esc(title)}</td></tr>
<tr><td style="padding-top:10px;font-size:15px;line-height:1.55;color:#4b4463">${esc(line)}</td></tr>
<tr><td style="padding-top:22px"><a href="${esc(link)}" style="display:inline-block;background:linear-gradient(135deg,#c084fc,#9b5cff 55%,#6d5dfc);color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 22px;border-radius:12px">${esc(button)}</a></td></tr>
<tr><td style="padding-top:20px;font-size:12.5px;line-height:1.5;color:#7a7390">${esc(note)}<br><br>If the button does not work, open this link:<br><a href="${esc(link)}" style="color:#9b5cff;word-break:break-all">${esc(link)}</a></td></tr>
</table></td></tr></table></body></html>`;
  return { text: `${title}\n\n${line}\n\n${button}: ${link}\n\n${note}\n`, html };
}

/** A new account's "Verify my email" link (VERIFY_HOURS, once); sent at sign-up and again from the app. */
async function sendVerify(u: Doc) {
  const token = crypto.randomBytes(32).toString("base64url");
  await (await users()).updateOne({ _id: u._id }, { $set: { verify: { hash: hashToken(token), expires: new Date(Date.now() + VERIFY_HOURS * 3600_000) } } });
  const b = settings.businessName, m = letter(`Verify your email`, `Welcome to ${b}! Tap the button to confirm this is your email address.`, "Verify my email",
    `${siteUrl()}/verify?token=${token}`, `The link works for ${VERIFY_HOURS} hours, once. If you did not create a ${b} account, ignore this email.`);
  return sendMail(String(u.email), `Verify your ${b} email`, m.text, m.html);
}
export async function verifyEmail(token: string) {
  const col = await users(), u = await col.findOne({ "verify.hash": hashToken(token) }), expires = (u?.verify as Doc | undefined)?.expires as Date | undefined;
  if (!u || !expires || new Date(expires).getTime() < Date.now()) throw new ValidationFailed("This link has expired or was already used. Sign in and ask for a new one.", { code: "VERIFY_LINK_INVALID" });
  await col.updateOne({ _id: u._id }, { $set: { emailVerified: true, emailVerifiedAt: new Date() }, $unset: { verify: "" } });
  await rewardFor(String(u._id), "verified", grantCredits).catch(() => {}); // an invite rewarded on a verified email
  return { ok: true, email: String(u.email) };
}
/** The signed-in person asks for the link again (a few minutes apart). */
export async function resendVerify() {
  needAccounts();
  const u = await meDoc();
  if (u.emailVerified !== false) return { ok: true, verified: true };
  const last = (u.verify as Doc | undefined)?.expires as Date | undefined;
  if (last && new Date(last).getTime() - VERIFY_HOURS * 3600_000 > Date.now() - 60_000) throw new ValidationFailed("We just sent one: wait a minute, then try again.", { code: "VERIFY_TOO_SOON" });
  return { ok: true, sent: await sendVerify(u) };
}

export async function me() {
  const uid = currentUser(), u = uid && ObjectId.isValid(uid) ? await (await users()).findOne({ _id: new ObjectId(uid) }) : null;
  // iosApp: the Shubix app on this person's iPhone was opened in the last 14 days (adminDashboard.ts ping), so Safari
  // hides its "Install the app" banner; not opened for 14 days, it was most likely removed, and the banner comes back
  const iosApp = !!u && u.iosAppAt instanceof Date && Date.now() - u.iosAppAt.getTime() < 14 * 864e5;
  return { authEnabled: settings.authEnabled, user: u ? { ...userOut(u), iosApp } : null };
}
export async function register(email0: string, password: string, ref?: string) {
  needAccounts();
  const email = email0.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ValidationFailed("Enter a valid email address.", { code: "INVALID_EMAIL" });
  checkPassword(password);
  const col = await users();
  if (await col.findOne({ email })) throw new ConflictError("An account with this email already exists. Sign in instead.", { code: "EMAIL_TAKEN" });
  const now = new Date(), u = { _id: new ObjectId(), email, password: hashPassword(password), sessionVersion: 0, createdAt: now, lastLoginAt: now, loginCount: 1, emailVerified: false };
  try {
    await col.insertOne(u);
  } catch (e) {
    // two sign-ups with the same email at the same moment: the unique index (server/core/indexes.ts) lets one through
    if ((e as { code?: number }).code === 11000) throw new ConflictError("An account with this email already exists. Sign in instead.", { code: "EMAIL_TAKEN" });
    throw e;
  }
  await sendVerify(u); // "Verify your email" (not sent: the server log says so, the account works anyway)
  // a username (also the invite code) and, if a friend's link brought them, the invite (its rewards follow the admin's rule)
  const uid = String(u._id);
  try { (u as Doc).username = await ensureUsername(uid); await noteReferral(uid, ref, grantCredits); } catch (e) { console.warn("sign-up marketing:", (e as Error).message); }
  return withCookie({ user: userOut(u) }, sessionCookie(u), 201);
}
export async function login(email: string, password: string) {
  needAccounts();
  const u = await (await users()).findOne({ email: email.trim().toLowerCase() });
  if (!u || !verifyPassword(password, String(u.password))) throw new AuthRequired("The email or password is not correct.", "BAD_CREDENTIALS");
  await (await users()).updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() }, $inc: { loginCount: 1 } }); // for the admin dashboard
  return withCookie({ user: userOut(u) }, sessionCookie(u));
}
export const logout = () => withCookie({ ok: true }, clearCookie());
const siteUrl = () => (settings.publicBaseUrl || "http://localhost:3100").replace(/\/+$/, "");
/** Email a reset link; the answer is the same whether or not the email has an account (nobody can find out who is signed up). */
export async function forgot(email: string) {
  needAccounts();
  const col = await users(), u = await col.findOne({ email: email.trim().toLowerCase() });
  if (u) {
    const token = crypto.randomBytes(32).toString("base64url");
    await col.updateOne({ _id: u._id }, { $set: { reset: { hash: hashToken(token), expires: new Date(Date.now() + RESET_MINUTES * 60_000) } } });
    const b = settings.businessName, link = `${siteUrl()}/reset?token=${token}`;
    const m = letter("Reset your password", `Someone (hopefully you) asked to reset the password of your ${b} account. Choose a new one here.`, "Choose a new password", link,
      `The link works for ${RESET_MINUTES} minutes, once. If you did not ask for this, ignore this email: your password stays the same.`);
    await sendMail(String(u.email), `Reset your ${b} password`, m.text, m.html);
  }
  return { ok: true };
}
export async function reset(token: string, password: string) {
  needAccounts();
  checkPassword(password);
  const col = await users(), u = await col.findOne({ "reset.hash": hashToken(token) }), expires = (u?.reset as Doc | undefined)?.expires as Date | undefined;
  if (!u || !expires || new Date(expires).getTime() < Date.now()) throw new ValidationFailed("This link has expired or was already used. Ask for a new one.", { code: "RESET_LINK_INVALID" });
  await col.updateOne({ _id: u._id }, { $set: { password: hashPassword(password) }, $unset: { reset: "" } });
  const fresh = await newSessionVersion(u._id);
  return withCookie({ user: userOut(fresh) }, sessionCookie(fresh)); // signed in here; every other session ends
}
export async function changePassword(current: string, next: string) {
  needAccounts();
  const u = await meDoc();
  if (!verifyPassword(current, String(u.password))) throw new ValidationFailed("The current password is not correct.", { code: "BAD_CREDENTIALS" });
  checkPassword(next);
  await (await users()).updateOne({ _id: u._id as ObjectId }, { $set: { password: hashPassword(next) } });
  return withCookie({ ok: true }, sessionCookie(await newSessionVersion(u._id)));
}
export async function logoutEverywhere() {
  needAccounts();
  return withCookie({ ok: true }, sessionCookie(await newSessionVersion((await meDoc())._id))); // this device stays signed in
}
/** Everything the user owns, in every collection, and their files; payment records are kept (tax law) without the link to the person. */
async function deleteUserData(userId: string) {
  const d = await mainDb();
  for (const { name } of await d.listCollections({}, { nameOnly: true }).toArray()) {
    if (UNSCOPED.has(name) || name.startsWith("system.")) continue;
    for (const doc of await d.collection(name).find({ [OWNER]: userId }).toArray()) {
      for (const [k, v] of Object.entries(doc)) if (k.endsWith("Key") && typeof v === "string" && v) fs.rmSync(localPath(v), { force: true, recursive: true });
      if (name === "projects") deletePrefix(`projects/${doc._id}`); // a project from the old server editor: its folder
    }
    await d.collection(name).deleteMany({ [OWNER]: userId });
  }
  await d.collection<Doc>("wallets").deleteMany({ _id: userId as never });
  await d.collection("credit_ledger").deleteMany({ userId });
  await d.collection("payments").updateMany({ userId }, { $set: { userId: null, accountDeleted: true } });
}
export async function deleteAccount(password: string, confirm: string) {
  needAccounts();
  const u = await meDoc();
  if (confirm.trim().toLowerCase() !== u.email) throw new ValidationFailed("Type your email address exactly to confirm.", { code: "CONFIRMATION_MISMATCH" });
  if (!verifyPassword(password, String(u.password))) throw new ValidationFailed("The password is not correct.", { code: "BAD_CREDENTIALS" });
  await deleteUserData(String(u._id));
  await (await users()).deleteOne({ _id: u._id as ObjectId });
  forgetSessionCache(String(u._id));
  return withCookie({ ok: true }, clearCookie());
}
