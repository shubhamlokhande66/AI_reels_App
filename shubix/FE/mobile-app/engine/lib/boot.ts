/** A page's first reads in one request (/api/boot): the app shell asks for the account, credits, features, plan locks,
 * texts, business details and admin mode as it opens; the first time each is asked for, its answer comes from one shared
 * /api/boot request instead of seven. Every later read (a refresh, an invalidation, the next page) goes to its own route
 * as before, and a part boot did not bring (or a failed boot) is asked from its route too: nothing behaves differently. */

export type BootKey = "me" | "credits" | "admin" | "features" | "texts" | "planLocks" | "site" | "offer" | "help" | "plans" | "content" | "ads" | "notifications";

let boot: Promise<Partial<Record<BootKey, unknown>>> | null = null;
const used = new Set<BootKey>();

export function viaBoot<T>(key: BootKey, direct: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined" || used.has(key)) return direct();
  used.add(key);
  return start().then((b) => (b[key] !== undefined && b[key] !== null ? (b[key] as T) : direct()));
}

/** a part of the page's boot answer without using it up (the studio engine's first plan read); undefined: ask its route */
export async function bootPart<T>(key: BootKey): Promise<T | undefined> {
  if (typeof window === "undefined") return undefined;
  const v = (await start())[key];
  return v === undefined || v === null ? undefined : (v as T);
}

function start(): Promise<Partial<Record<BootKey, unknown>>> {
  return boot ??= fetch("/api/boot", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : {}))
    .then((b: Partial<Record<BootKey, unknown>>) => { noteMe(b.me); return b; })
    .catch(() => ({}));
}

/* Nobody signed in (accounts on, boot or /api/auth/me said so): the reads only a signed-in person gets (credits, the
 * bell's messages and Reels) are not sent at all: each would be a 401, and on Cloudflare each request wakes the server. */
let signedOut = false;
export function noteMe(me: unknown) {
  const m = me as { authEnabled?: boolean; user?: unknown } | null | undefined;
  if (m && typeof m === "object") signedOut = !!m.authEnabled && !m.user;
}
/** sign in / sign up / verify answered: ask again normally */
export const noteSignedIn = () => { signedOut = false; };
const USER_ONLY = ["/api/credits", "/api/notifications", "/api/studio/reels", "/api/ads", "/api/marketing", "/api/templates"];
/** a user-only read while nobody is signed in (waits for the page's boot answer first, so the first reads are skipped too) */
export async function skipSignedOut(path: string, method = "GET"): Promise<boolean> {
  if (typeof window === "undefined" || method.toUpperCase() !== "GET" || !USER_ONLY.includes(path.split("?")[0])) return false;
  await start();
  return signedOut;
}
