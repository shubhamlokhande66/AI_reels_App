import { Platform } from "react-native";
import { createApiClient } from "@shubix/api-client";
import { tokenStore } from "./device";

/** BE/api (NestJS): every endpoint. EXPO_PUBLIC_API_URL, else this computer (a browser: localhost; the Android
 * emulator: 10.0.2.2). A real phone needs the computer's LAN address or an HTTPS host. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "web" ? "http://localhost:4000" : "http://10.0.2.2:4000")).replace(/\/$/, "");

/** The one API client of the phone app: the token kept on the device (device.ts), sent as Bearer (the website uses
 * the cookie). */
export const api = createApiClient({ baseUrl: API_URL, mobile: true, getToken: tokenStore.get, setToken: tokenStore.set });
