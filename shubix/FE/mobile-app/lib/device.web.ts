/** device.ts in a browser (Expo web): the token in localStorage, a protected file played from memory. */
const KEY = "shubix.session.token";
export const tokenStore = {
  get: async () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: async (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* private mode: signed in for this page only */ } },
};
export async function fetchWithToken(url: string, _name: string) {
  const token = await tokenStore.get();
  const r = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!r.ok) throw new Error(`Could not open this file (${r.status}).`);
  return URL.createObjectURL(await r.blob());
}
