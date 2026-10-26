import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { settings } from "./config";
import { AppError } from "./errors";

/** User accounts (was core/auth.py): email + password, a signed session cookie, each user's data scoped to them.
 * Off by default (AUTH_ENABLED=false): a local single-person install behaves exactly as before. On: every /api request
 * except the public ones needs a session; the user is set for the request and the jobs it starts (AsyncLocalStorage),
 * and `db()` then shows only that user's documents. Same password hashes and tokens as the Python backend. */

export const COOKIE = "reel_session", SESSION_DAYS = 30;
const PUBLIC_PATHS = ["/api/cron/", "/api/contact", "/api/help", "/api/boot", "/api/offer", "/api/marketing/click", "/api/health", "/api/auth/", "/api/admin/session", "/api/phone", "/api/public/", "/api/plans", "/api/site", "/api/texts", "/api/content"];
const userCtx = new AsyncLocalStorage<string | null>();
export const currentUser = (): string | null => userCtx.getStore() ?? null;
export const withUser = <T>(uid: string | null, fn: () => T): T => userCtx.run(uid, fn);

export class AuthRequired extends AppError {
  constructor(message = "Please sign in.", code = "AUTH_REQUIRED") { super(message, { code, status: 401 }); }
}
const scrypt = (password: string, salt: Buffer) => crypto.scryptSync(password, salt, 32, { N: 2 ** 14, r: 8, p: 1 });
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString("base64")}$${scrypt(password, salt).toString("base64")}`;
}
export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [, salt, digest] = stored.split("$"), want = Buffer.from(digest, "base64"), got = scrypt(password, Buffer.from(salt, "base64"));
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  } catch { return false; }
}
function secret(): string {
  if (!settings.secretKey) throw new AuthRequired("Accounts are switched on, but SECRET_KEY is not set on the server.", "AUTH_MISCONFIGURED");
  return settings.secretKey;
}
const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("hex");
/** version: the user's session version; a password change or "sign out everywhere" raises it, ending older sessions. */
export function makeToken(userId: string, days = SESSION_DAYS, version = 0): string {
  const payload = Buffer.from(JSON.stringify({ u: userId, e: Math.trunc(Date.now() / 1000) + days * 86400, v: version })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function readSession(tokenIn: string | null | undefined): [string, number] | null {
  const token = (tokenIn ?? "").trim().replace(/^"|"$/g, "");
  const at = token.lastIndexOf(".");
  if (!token || at < 0) return null;
  const payload = token.slice(0, at), sig = token.slice(at + 1), want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; e?: number; v?: number };
    if ((d.e ?? 0) <= Date.now() / 1000 || !d.u) return null;
    return [String(d.u), Number(d.v ?? 0)];
  } catch { return null; }
}
const versions = new Map<string, [number, number]>(), VERSION_TTL = 20_000;
export const forgetSessionCache = (userId: string) => { versions.delete(userId); };
/** The account still exists and the session is not older than its last password change / sign-out everywhere. */
async function sessionValid(userId: string, version: number): Promise<boolean> {
  let hit = versions.get(userId);
  if (!hit || Date.now() - hit[1] > VERSION_TTL) {
    if (!/^[0-9a-f]{24}$/.test(userId)) return false;
    const { mainDb, ObjectId } = await import("./db");
    const doc = await (await mainDb()).collection("users").findOne({ _id: new ObjectId(userId) }, { projection: { sessionVersion: 1 } });
    if (!doc) { versions.delete(userId); return false; }
    hit = [Number(doc.sessionVersion ?? 0), Date.now()];
    versions.set(userId, hit);
  }
  return hit[0] === version;
}
const isPublic = (path: string) => !path.startsWith("/api") || PUBLIC_PATHS.some((p) => path === p || (p.endsWith("/") && path.startsWith(p)));

/** The signed-in user of a request (null with accounts off or no valid session); throws AuthRequired for a private
 * path without one. */
export async function resolveUser(req: Request): Promise<string | null> {
  if (!settings.authEnabled) return null;
  let token: string | null = null;
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === COOKIE) token = part.slice(i + 1).trim();
  }
  const authz = req.headers.get("authorization") ?? "";
  if (!token && authz.toLowerCase().startsWith("bearer ")) token = authz.slice(7);
  let uid: string | null = null;
  if (token) { const s = readSession(token); if (s && (await sessionValid(s[0], s[1]))) uid = s[0]; }
  if (!uid && !isPublic(new URL(req.url).pathname) && req.method !== "OPTIONS") throw new AuthRequired();
  return uid;
}
export function sessionCookie(user: { _id: unknown; sessionVersion?: unknown }): string {
  const token = makeToken(String(user._id), SESSION_DAYS, Number(user.sessionVersion ?? 0));
  return `${COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${settings.cookieSecure ? "; Secure" : ""}`;
}
export const clearCookie = () => `${COOKIE}=""; Max-Age=0; Path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`;
