import "server-only";
import crypto from "node:crypto";
import { currentUser } from "./auth";
import { settings } from "./config";
import { AppError } from "./errors";
import { limits } from "./rateLimit";

/** Admin access (was core/admin.py). An administrator is a signed-in account whose email is in ADMIN_EMAILS, or a
 * browser that sends the ADMIN_KEY in the X-Admin-Key header. With neither set (a local install) everyone is admin. */

const emails = () => new Set(settings.adminEmails.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
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

export const adminRequired = () => Boolean(settings.adminKey || emails().size);

export async function isAdmin(req: Request): Promise<boolean> {
  if (!adminRequired() || keyMatches(req)) return true;
  const uid = currentUser(), list = emails();
  if (!uid || !list.size) return false;
  const email = await emailOf(uid);
  return Boolean(email && list.has(email));
}

export async function requireAdmin(req: Request) {
  if (!(await isAdmin(req))) throw new AppError("This part of the app is for the administrator.", { code: "ADMIN_ONLY", status: 403 });
}
