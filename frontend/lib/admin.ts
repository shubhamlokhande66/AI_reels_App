/** Admin mode in this browser: the operator unlocks it once with the server's ADMIN_KEY (see backend app/core/admin.py).
 * The key is kept on this device and sent with every request; the server decides what it unlocks. */

const KEY = "reel-admin-key";

export function getAdminKey(): string | null {
  try {
    return typeof window === "undefined" ? null : localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setAdminKey(key: string | null) {
  try {
    if (key) localStorage.setItem(KEY, key);
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: admin mode lasts for this visit only */
  }
}

export function adminHeaders(): Record<string, string> {
  const k = getAdminKey();
  return k ? { "X-Admin-Key": k } : {};
}
