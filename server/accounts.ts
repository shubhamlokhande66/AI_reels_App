import "server-only";
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
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, RESET_MINUTES = 60, MIN_PASSWORD = 8;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users = async () => (await mainDb()).collection<any>("users");
const userOut = (u: Doc) => ({ id: String(u._id), email: u.email });
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
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  const s = settings;
  if (!(s.smtpHost && s.smtpFrom)) {
    // the message (a reset link is a key to the account) is shown only while developing, never in a live server's log
    console.warn(`email is not set up (SMTP_HOST / SMTP_FROM); would have sent to ${to}: ${subject}${process.env.NODE_ENV === "production" ? "" : `\n${text}`}`);
    return false;
  }
  const m = /^(.*)<([^>]+)>\s*$/.exec(s.smtpFrom), name = (m?.[1] ?? "").trim().replace(/^"|"$/g, "") || s.businessName, addr = (m?.[2] ?? s.smtpFrom).trim();
  try {
    const t = nodemailer.createTransport({ host: s.smtpHost, port: s.smtpPort, secure: s.smtpSsl, requireTLS: !s.smtpSsl, auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPassword } : undefined, connectionTimeout: 20_000 });
    await t.sendMail({ from: { name, address: addr }, to, subject, text });
    return true;
  } catch (e) { console.warn(`email to ${to} failed: ${(e as Error).message}`); return false; }
}

export async function me() {
  const uid = currentUser(), u = uid && ObjectId.isValid(uid) ? await (await users()).findOne({ _id: new ObjectId(uid) }) : null;
  return { authEnabled: settings.authEnabled, user: u ? userOut(u) : null };
}
export async function register(email0: string, password: string) {
  needAccounts();
  const email = email0.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ValidationFailed("Enter a valid email address.", { code: "INVALID_EMAIL" });
  checkPassword(password);
  const col = await users();
  if (await col.findOne({ email })) throw new ConflictError("An account with this email already exists. Sign in instead.", { code: "EMAIL_TAKEN" });
  const now = new Date(), u = { _id: new ObjectId(), email, password: hashPassword(password), sessionVersion: 0, createdAt: now, lastLoginAt: now, loginCount: 1 };
  try {
    await col.insertOne(u);
  } catch (e) {
    // two sign-ups with the same email at the same moment: the unique index (server/core/indexes.ts) lets one through
    if ((e as { code?: number }).code === 11000) throw new ConflictError("An account with this email already exists. Sign in instead.", { code: "EMAIL_TAKEN" });
    throw e;
  }
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
    await sendMail(String(u.email), `Reset your ${b} password`, `Hello,\n\nSomeone (hopefully you) asked to reset the password of your ${b} account.\n\nChoose a new password here (the link works for ${RESET_MINUTES} minutes, once):\n${link}\n\nIf you did not ask for this, you can ignore this email: your password stays the same.\n`);
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
