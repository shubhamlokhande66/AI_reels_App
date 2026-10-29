import * as SecureStore from "expo-secure-store";
import { createApiClient } from "@shubix/api-client";

/** BE/api (NestJS): every endpoint. Emulator: 10.0.2.2; a phone needs a LAN or HTTPS address. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:4000").replace(/\/$/, "");
export const TOKEN_KEY = "shubix.session.token";

/** The one API client of the phone app: the token in secure storage, sent as Bearer (the website uses the cookie). */
export const api = createApiClient({
  baseUrl: API_URL,
  mobile: true,
  getToken: () => SecureStore.getItemAsync(TOKEN_KEY),
  setToken: (t) => (t ? SecureStore.setItemAsync(TOKEN_KEY, t) : SecureStore.deleteItemAsync(TOKEN_KEY)),
});
