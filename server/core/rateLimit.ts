import "server-only";
import { currentUser } from "./auth";
import { RateLimited } from "./errors";

/** Limits on what can be abused: guessing passwords or the admin key, flooding sign-ups and reset emails, the visitor
 * ping, the AI (each call costs money). A fixed window per key, kept in this server's memory (with several servers each
 * counts on its own: a guard against floods, not an exact quota). Over the limit: 429 RATE_LIMITED with when to retry. */

type Hit = { n: number; until: number };
const hits = new Map<string, Hit>();
let swept = 0;

/** The visitor's address (behind Cloudflare or a proxy: the first forwarded one). */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || "local").trim();
}

/** Counts one try for `key`; past `max` within `windowMs` it throws RateLimited. */
export function limit(key: string, max: number, windowMs: number, message = "Too many tries. Please wait a moment and try again.") {
  const now = Date.now();
  if (now - swept > 60_000) { swept = now; for (const [k, v] of hits) if (v.until <= now) hits.delete(k); } // old windows go
  const h = hits.get(key);
  if (!h || h.until <= now) return void hits.set(key, { n: 1, until: now + windowMs });
  h.n += 1;
  if (h.n > max) {
    const secs = Math.ceil((h.until - now) / 1000);
    throw new RateLimited(`${message} (${secs < 90 ? `${secs} s` : `${Math.ceil(secs / 60)} min`})`, { details: { retryAfter: secs } });
  }
}

const MIN = 60_000;
/** The limits used by the routes, in one place. */
export const limits = {
  login: (req: Request, email: string) => { limit(`login:ip:${clientIp(req)}`, 20, 15 * MIN); limit(`login:email:${email.trim().toLowerCase()}`, 8, 15 * MIN, "Too many sign-in tries for this email."); },
  register: (req: Request) => limit(`register:${clientIp(req)}`, 5, 60 * MIN, "Too many new accounts from here."),
  forgot: (req: Request, email: string) => { limit(`forgot:ip:${clientIp(req)}`, 5, 60 * MIN); limit(`forgot:email:${email.trim().toLowerCase()}`, 3, 60 * MIN, "A reset email was already sent. Check your inbox and spam."); },
  reset: (req: Request) => limit(`reset:${clientIp(req)}`, 10, 15 * MIN),
  account: (req: Request) => limit(`account:${currentUser() ?? clientIp(req)}`, 10, 15 * MIN),
  adminKey: (req: Request) => limit(`adminkey:${clientIp(req)}`, 10, 15 * MIN, "Too many admin password tries."),
  ping: (req: Request, visitor: string) => limit(`ping:${visitor}:${clientIp(req)}`, 8, MIN, "Too many pings."),
  clientError: (req: Request) => limit(`clienterr:${clientIp(req)}`, 10, MIN, "Too many error reports."),
  ai: (req: Request) => limit(`ai:${currentUser() ?? clientIp(req)}`, 40, MIN, "The AI is being asked too often. Wait a moment."),
};
