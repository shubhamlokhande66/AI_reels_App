import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";

/** What only the phone has (device.web.ts: the same in a browser). The session token in secure storage. */
const KEY = "shubix.session.token";
export const tokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (t: string | null) => (t ? SecureStore.setItemAsync(KEY, t) : SecureStore.deleteItemAsync(KEY)),
};
/** A file that needs the sign-in token (a video player cannot send it): downloaded to the cache, its local address. */
export async function fetchWithToken(url: string, name: string) {
  const token = await tokenStore.get();
  const r = await FileSystem.downloadAsync(url, `${FileSystem.cacheDirectory}${name}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (r.status !== 200) throw new Error(`Could not open this file (${r.status}).`);
  return r.uri;
}
