import "server-only";
import crypto from "node:crypto";
import { currentUser, sessionAdminUntil } from "./auth";
import { settings } from "./config";
import { AppError } from "./errors";
import { limits } from "./rateLimit";

/** Admin access (was core/admin.py). An administrator is a signed-in account whose email is in ADMIN_EMAILS (the owners,
 * comma-separated), or one an administrator added in Admin → Settings → Administrators, or a browser that sends the
 * ADMIN_KEY in the X-Admin-Key header. With neither ADMIN_EMAILS nor ADMIN_KEY set (a local install) everyone is admin.
 * An administrator has everything open: every plan's pages and Shubix AI, and no credits are taken (server/credits.ts).
 * An admin email's powers need a 6-digit code emailed to it, once a day (ADMIN_CODE_HOURS): the session carries until
 * when (auth.ts), so a stolen password or an old session alone never opens Admin. */
export const ADMIN_CODE_HOURS = 24;

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/, ADMINS_ID = "admins";
const split = (s: string) => s.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
/** the owners: ADMIN_EMAILS (only the server's settings change them) */
export const ownerEmails = () => new Set(split(settings.adminEmails));
let added: [string[], number] | null = null;
const ADDED_TTL = 30_000;
/** the administrators added in the app (Admin → Settings → Administrators), cached half a minute */
async function addedEmails(): Promise<string[]> {
  if (added && Date.now() - added[1] < ADDED_TTL) return added[0];
  try {
    const { mainDb } = await import("./db");
    const d = await (await mainDb()).collection("app_settings").findOne({ _id: ADMINS_ID as never }, { projection: { emails: 1 } });
    added = [Array.isArray(d?.emails) ? d.emails.map((e: unknown) => String(e).toLowerCase()) : [], Date.now()];
  } catch { added = [added?.[0] ?? [], Date.now()]; } // no database: the owners only
  return added[0];
}
/** every administrator's email: the owners and the added ones */
export async function adminEmails(): Promise<string[]> { return [...new Set([...ownerEmails(), ...(await addedEmails())])]; }
const emails = async () => new Set(await adminEmails());
const emailCache = new Map<string, [string | null, number]>(), EMAIL_TTL = 60_000;

/** The email of a user id (cached a minute: every admin request asks). */
async function emailOf(uid: string): Promise<string | null> {
  const hit = emailCache.get(uid);
  if (hit && Date.now() - hit[1] < EMAIL_TTL) return hit[0];
  if (!/^[0-9a-f]{24}$/.test(uid)) return null;
  const { mainDb, ObjectId } = await import("./db");
  const u = await (await mainDb()).collection("users").findOne({ _id: new ObjectId(uid) }, { projection: { email: 1 } });
  const email = u ? String(u.email).toLowerCase() : null;
  emailCache.set(uid, [email, Date.now()]);
  return email;
}

function keyMatches(req: Request): boolean {
  const key = settings.adminKey, given = req.headers.get("x-admin-key") ?? "";
  const ok = Boolean(key && given) && given.length === key.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
  if (given && !ok) limits.adminKey(req); // a wrong key: counted, so it cannot be guessed (429 after a few)
  return ok;
}

export const adminRequired = () => Boolean(settings.adminKey || ownerEmails().size);

export async function isAdmin(req: Request): Promise<boolean> {
  if (!adminRequired() || keyMatches(req)) return true;
  const uid = currentUser();
  return Boolean(uid && sessionAdminUntil(req) > Date.now() && (await isAdminAccount(uid)));
}
/** an administrator's email (before its daily code) */
export async function isAdminEmail(email: string) { return adminRequired() && (await emails()).has(email.trim().toLowerCase()); }
async function isAdminAccount(uid: string) { const email = await emailOf(uid); return Boolean(email && (await isAdminEmail(email))); }
/** What the browser is told: admin mode, whether the server has an administrator set up, and otp: an admin account
 * signed in whose daily code is due (the admin pages ask for it). */
export async function adminState(req: Request) {
  const admin = await isAdmin(req), uid = currentUser();
  return { admin, required: adminRequired(), otp: !admin && !!uid && (await isAdminAccount(uid)) };
}
/** Is this account an administrator, its code entered in the last day? For the places without the request (credits). */
export async function isAdminUser(uid: string): Promise<boolean> {
  if (!adminRequired() || !(await isAdminAccount(uid))) return false; // a local install: plans and credits still count
  const { mainDb, ObjectId } = await import("./db");
  const u = await (await mainDb()).collection("users").findOne({ _id: new ObjectId(uid) }, { projection: { adminUntil: 1 } });
  return u?.adminUntil instanceof Date && u.adminUntil.getTime() > Date.now();
}

// ------------------------------------------------------------------ Admin → Settings → Administrators
export async function listAdmins() {
  const owners = ownerEmails();
  return { admins: (await adminEmails()).map((email) => ({ email, owner: owners.has(email) })), keySet: !!settings.adminKey };
}
export async function addAdmin(email0: string) {
  const email = email0.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AppError("Enter a valid email address.", { code: "INVALID_EMAIL", status: 422 });
  const { mainDb } = await import("./db");
  await (await mainDb()).collection("app_settings").updateOne({ _id: ADMINS_ID as never }, { $addToSet: { emails: email }, $set: { updatedAt: new Date() } }, { upsert: true });
  added = null;
  return listAdmins();
}
export async function removeAdmin(email0: string) {
  const email = email0.trim().toLowerCase();
  if (ownerEmails().has(email)) throw new AppError("This administrator is set on the server (ADMIN_EMAILS): change it there.", { code: "OWNER_ADMIN", status: 422 });
  const { mainDb } = await import("./db");
  await (await mainDb()).collection("app_settings").updateOne({ _id: ADMINS_ID as never }, { $pull: { emails: email } as never, $set: { updatedAt: new Date() } });
  added = null;
  return listAdmins();
}

/** The administrator for plans and credits: only a real one (an admin key or an admin email is set up and matches).
 * With no administrator set up, every visitor counts as the administrator for the admin pages, but plans, locks and
 * credits still follow each person's own plan. */
export async function isPlanAdmin(req: Request): Promise<boolean> {
  return adminRequired() && (await isAdmin(req));
}

export async function requireAdmin(req: Request) {
  if (!(await isAdmin(req))) throw new AppError("This part of the app is for the administrator.", { code: "ADMIN_ONLY", status: 403 });
}
