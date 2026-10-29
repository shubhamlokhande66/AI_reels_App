import { createApiClient } from "@shubix/api-client";
import { tokenStore } from "./device";

/** BE/api (NestJS): every endpoint. Emulator: 10.0.2.2; a phone needs a LAN or HTTPS address. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:4000").replace(/\/$/, "");

/** The one API client of the phone app: the token kept on the device (device.ts), sent as Bearer (the website uses
 * the cookie). */
export const api = createApiClient({ baseUrl: API_URL, mobile: true, getToken: tokenStore.get, setToken: tokenStore.set });
