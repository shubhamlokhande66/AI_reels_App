/** A page's first reads in one request (/api/boot): the app shell asks for the account, credits, features, plan locks,
 * texts, business details and admin mode as it opens; the first time each is asked for, its answer comes from one shared
 * /api/boot request instead of seven. Every later read (a refresh, an invalidation, the next page) goes to its own route
 * as before, and a part boot did not bring (or a failed boot) is asked from its route too: nothing behaves differently. */

export type BootKey = "me" | "credits" | "admin" | "features" | "texts" | "planLocks" | "site" | "offer";

let boot: Promise<Partial<Record<BootKey, unknown>>> | null = null;
const used = new Set<BootKey>();

export function viaBoot<T>(key: BootKey, direct: () => Promise<T>): Promise<T> {
  if (typeof window === "undefined" || used.has(key)) return direct();
  used.add(key);
  boot ??= fetch("/api/boot", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  return boot.then((b) => (b[key] !== undefined && b[key] !== null ? (b[key] as T) : direct()));
}
