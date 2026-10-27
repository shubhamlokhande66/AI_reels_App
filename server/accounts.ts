import "server-only";
import { ensureUsername, noteReferral, rewardFor } from "@/server/marketing";
import { grantCredits } from "@/server/credits";
import crypto from "node:crypto";
import { AuthRequired, clearCookie, currentUser, forgetSessionCache, hashPassword, sessionCookie, verifyPassword } from "@/server/core/auth";
import { settings } from "@/server/core/config";
import { codeLetter, sendMail } from "@/server/core/mail";
import { mainDb, ObjectId, OWNER, UNSCOPED } from "@/server/core/db";
import { AppError, ConflictError, ValidationFailed } from "@/server/core/errors";
import { ADMIN_CODE_HOURS, isAdminEmail } from "@/server/core/admin";
import { deletePrefix } from "@/server/storage/local";
export { sendMail };
import fs from "node:fs";
import { localPath } from "@/server/storage/local";

/** Accounts (was api/auth.py and core/mailer.py): sign up / in / out, forgot + reset password, change password, delete
 * the account. With accounts off, /me says so and nothing else is needed. */

type Doc = Record<string, unknown>;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, CODE_MINUTES = 10, CODE_TRIES = 5, RESEND_SECONDS = 60, MIN_PASSWORD = 8;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users = async () => (await mainDb()).collection<any>("users");
const userOut = (u: Doc) => ({ id: String(u._id), email: u.email, emailVerified: u.emailVerified !== false, username: (u.username as string | undefined) ?? null });
const withCookie = (body: unknown, cookie: string, status = 200) => Response.json(body, { status, headers: { "Set-Cookie": cookie } });
// an affiliate partner's account (made on the partner dashboard, no password): "Forgot password" gives it one, by a code
const PARTNER_ONLY = "This email is an affiliate partner account. Use “Forgot password” to set a password and use Shubix with it.";
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

// ---------------------------------------------------------------- one-time codes (sign-up and password reset)
// A 6-digit code by email, CODE_MINUTES long, CODE_TRIES wrong tries (then a new one is needed), a new one at most every
// RESEND_SECONDS. Only its hash is kept, tied to the account and the purpose (a sign-up code never resets a password).
const newCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
const codeHash = (id: unknown, purpose: string, code: string) => hashToken(`${String(id)}:${purpose}:${code}`);
type Otp = { hash: string; expires: Date; tries: number; sentAt: Date };
type Purpose = "verify" | "reset" | "admin";
const FIELD: Record<Purpose, string> = { verify: "verifyOtp", reset: "resetOtp", admin: "adminOtp" };
async function sendCode(u: Doc, purpose: Purpose) {
  const code = newCode(), b = settings.businessName;
  const otp: Otp = { hash: codeHash(u._id, purpose, code), expires: new Date(Date.now() + CODE_MINUTES * 60_000), tries: 0, sentAt: new Date() };
  await (await users()).updateOne({ _id: u._id }, { $set: { [FIELD[purpose]]: otp } });
  if (purpose === "admin") {
    const a = codeLetter("Your admin sign-in code", `Someone (we hope you) signed in to the ${b} administration with your account. Enter this code to open it for the next ${ADMIN_CODE_HOURS} hours.`, code,
      `The code works for ${CODE_MINUTES} minutes. If this was not you, change your password now: without this code nobody can open the administration.`, "Admin security");
    return sendMail(String(u.email), `${code} is your ${b} admin code`, a.text, a.html);
  }
  const m = purpose === "verify"
    ? codeLetter("Confirm your email", `Welcome to ${b}. Enter this code in the app to confirm your email address and finish setting up your account.`, code,
      `The code works for ${CODE_MINUTES} minutes. If you did not create a ${b} account, you can safely ignore this email.`, "Email verification")
    : codeLetter("Reset your password", `We received a request to reset the password of your ${b} account. Enter this code in the app to choose a new one.`, code,
      `The code works for ${CODE_MINUTES} minutes. If you did not ask for this, ignore this email: your password stays the same.`, "Password reset");
  return sendMail(String(u.email), purpose === "verify" ? `${code} is your ${b} code` : `${code} is your ${b} password reset code`, m.text, m.html);
}
/** a code may be sent again once RESEND_SECONDS have passed (the wait left, in seconds, or 0) */
const waitLeft = (otp: Otp | undefined) => (otp?.sentAt ? Math.max(0, Math.ceil((new Date(otp.sentAt).getTime() + RESEND_SECONDS * 1000 - Date.now()) / 1000)) : 0);
/** Check a code (a wrong one counts a try; the last try or an old code means a new one is needed). Throws when wrong. */
async function checkCode(u: Doc, purpose: Purpose, code: string) {
  const field = FIELD[purpose], otp = u[field] as Otp | undefined;
  const fail = (msg: string, c: string) => new ValidationFailed(msg, { code: c });
  if (!otp || new Date(otp.expires).getTime() < Date.now()) throw fail("This code has expired. Ask for a new one.", "CODE_EXPIRED");
  if (otp.tries >= CODE_TRIES) throw fail("Too many wrong tries. Ask for a new code.", "CODE_LOCKED");
  const ok = /^\d{6}$/.test(code) && crypto.timingSafeEqual(Buffer.from(codeHash(u._id, purpose, code)), Buffer.from(otp.hash));
  if (!ok) {
    // counted atomically: several guesses at once still count each one
    const after = await (await users()).findOneAndUpdate({ _id: u._id, [`${field}.hash`]: otp.hash }, { $inc: { [`${field}.tries`]: 1 } }, { returnDocument: "after" });
    const left = CODE_TRIES - Number((after?.[field] as Otp | undefined)?.tries ?? CODE_TRIES);
    throw left > 0 ? fail(`That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`, "CODE_WRONG") : fail("Too many wrong tries. Ask for a new code.", "CODE_LOCKED");
  }
  // used once: only the request that removes it goes on
  const r = await (await users()).updateOne({ _id: u._id, [`${field}.hash`]: otp.hash }, { $unset: { [field]: "" } });
  if (!r.modifiedCount) throw fail("This code was already used. Ask for a new one.", "CODE_EXPIRED");
}

async function markVerified(u: Doc) {
  await (await users()).updateOne({ _id: u._id }, { $set: { emailVerified: true, emailVerifiedAt: new Date() }, $unset: { verify: "", verifyOtp: "" } });
  await rewardFor(String(u._id), "verified", grantCredits).catch(() => {}); // an invite rewarded on a verified email
  return { ok: true, email: String(u.email) };
}
/** The signed-in person enters the code from their sign-up email. */
export async function verifyCode(code: string) {
  needAccounts();
  const u = await meDoc();
  if (u.emailVerified !== false) return { ok: true, email: String(u.email) };
  await checkCode(u, "verify", code.trim());
  return markVerified(u);
}
/** A "Verify my email" link emailed before the codes (it keeps working until it expires). */
export async function verifyEmail(token: string) {
  const col = await users(), u = await col.findOne({ "verify.hash": hashToken(token) }), expires = (u?.verify as Doc | undefined)?.expires as Date | undefined;
  if (!u || !expires || new Date(expires).getTime() < Date.now()) throw new ValidationFailed("This link has expired or was already used. Sign in and ask for a new code.", { code: "VERIFY_LINK_INVALID" });
  return markVerified(u);
}
/** The signed-in person asks for the code again (a minute apart). */
export async function resendVerify() {
  needAccounts();
  const u = await meDoc();
  if (u.emailVerified !== false) return { ok: true, verified: true };
  const wait = waitLeft(u.verifyOtp as Otp | undefined);
  if (wait) throw new ValidationFailed(`We just sent one: wait ${wait} seconds, then try again.`, { code: "VERIFY_TOO_SOON", details: { wait } });
  return { ok: true, sent: await sendCode(u, "verify"), wait: RESEND_SECONDS };
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
  const taken = await col.findOne({ email }, { projection: { partnerOnly: 1, password: 1 } });
  if (taken && taken.partnerOnly && !taken.password) throw new ConflictError(PARTNER_ONLY, { code: "PARTNER_ONLY" });
  if (taken) throw new ConflictError("An account with this email already exists. Sign in instead.", { code: "EMAIL_TAKEN" });
  const now = new Date(), u = { _id: new ObjectId(), email, password: hashPassword(password), sessionVersion: 0, createdAt: now, lastLoginAt: now, loginCount: 1, emailVerified: false };
  try {
    await col.insertOne(u);
  } catch (e) {
    // two sign-ups with the same email at the same moment: the unique index (server/core/indexes.ts) lets one through
    if ((e as { code?: number }).code === 11000) throw new ConflictError("An account with this email already exists. Sign in instead.", { code: "EMAIL_TAKEN" });
    throw e;
  }
  await sendCode(u, "verify"); // the sign-up code (not sent: the server log says so, the account works anyway)
  // a username (also the invite code) and, if a friend's link brought them, the invite (its rewards follow the admin's rule)
  const uid = String(u._id);
  try { (u as Doc).username = await ensureUsername(uid); await noteReferral(uid, ref, grantCredits); } catch (e) { console.warn("sign-up marketing:", (e as Error).message); }
  return withCookie({ user: userOut(u) }, sessionCookie(u), 201);
}
export async function login(email: string, password: string) {
  needAccounts();
  const u = await (await users()).findOne({ email: email.trim().toLowerCase() });
  if (u && u.partnerOnly && !u.password) throw new AuthRequired(PARTNER_ONLY, "PARTNER_ONLY");
  if (!u || !verifyPassword(password, String(u.password))) throw new AuthRequired("The email or password is not correct.", "BAD_CREDENTIALS");
  await (await users()).updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() }, $inc: { loginCount: 1 } }); // for the admin dashboard
  // an administrator: signed in, and a code is emailed at once; the admin pages open after it (adminCode below)
  const adminCode = await isAdminEmail(String(u.email));
  if (adminCode && !waitLeft(u.adminOtp as Otp | undefined)) await sendCode(u, "admin");
  return withCookie({ user: userOut(u), adminCode }, sessionCookie(u));
}
/** The administrator asks for their daily admin code (a minute apart). */
export async function sendAdminCode() {
  const u = await meDoc();
  if (!(await isAdminEmail(String(u.email)))) throw new AppError("This account is not an administrator.", { code: "ADMIN_ONLY", status: 403 });
  const wait = waitLeft(u.adminOtp as Otp | undefined);
  if (wait) throw new ValidationFailed(`We just sent one: wait ${wait} seconds, then try again.`, { code: "VERIFY_TOO_SOON", details: { wait } });
  await sendCode(u, "admin");
  return { ok: true, wait: RESEND_SECONDS, email: String(u.email) };
}
/** The code from the admin email: this session has admin powers for ADMIN_CODE_HOURS (then a new code). */
export async function verifyAdminCode(code: string) {
  const u = await meDoc();
  if (!(await isAdminEmail(String(u.email)))) throw new AppError("This account is not an administrator.", { code: "ADMIN_ONLY", status: 403 });
  await checkCode(u, "admin", code.trim());
  const until = new Date(Date.now() + ADMIN_CODE_HOURS * 3600_000);
  await (await users()).updateOne({ _id: u._id }, { $set: { adminUntil: until, emailVerified: true } }); // the code proves the email too
  return withCookie({ ok: true, until }, sessionCookie(u, until.getTime()));
}
export const logout = () => withCookie({ ok: true }, clearCookie());
/** Email a reset code; the answer is the same whether or not the email has an account (nobody can find out who is signed
 * up). A new code at most once a minute (the earlier one keeps working until then). */
export async function forgot(email: string) {
  needAccounts();
  const u = await (await users()).findOne({ email: email.trim().toLowerCase() });
  if (u && !waitLeft(u.resetOtp as Otp | undefined)) await sendCode(u, "reset");
  return { ok: true, wait: RESEND_SECONDS };
}
/** The code from the reset email and a new password: signed in here, every other session ends. */
export async function resetWithCode(email: string, code: string, password: string) {
  needAccounts();
  checkPassword(password);
  const u = await (await users()).findOne({ email: email.trim().toLowerCase() });
  if (!u) throw new ValidationFailed("This code has expired. Ask for a new one.", { code: "CODE_EXPIRED" }); // the same as a wrong code
  await checkCode(u, "reset", code.trim());
  await (await users()).updateOne({ _id: u._id }, { $set: { password: hashPassword(password), emailVerified: true }, $unset: { reset: "", resetOtp: "", partnerOnly: "" } }); // the code proves the email too (a partner-only account is now a full one)
  const fresh = await newSessionVersion(u._id);
  return withCookie({ user: userOut(fresh) }, sessionCookie(fresh));
}
/** A reset link emailed before the codes (it keeps working until it expires). */
export async function reset(token: string, password: string) {
  needAccounts();
  checkPassword(password);
  const col = await users(), u = await col.findOne({ "reset.hash": hashToken(token) }), expires = (u?.reset as Doc | undefined)?.expires as Date | undefined;
  if (!u || !expires || new Date(expires).getTime() < Date.now()) throw new ValidationFailed("This link has expired or was already used. Ask for a new code.", { code: "RESET_LINK_INVALID" });
  await col.updateOne({ _id: u._id }, { $set: { password: hashPassword(password) }, $unset: { reset: "", resetOtp: "" } });
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
