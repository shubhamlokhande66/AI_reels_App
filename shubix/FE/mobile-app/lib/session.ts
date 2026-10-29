import { Platform } from "react-native";
import Constants from "expo-constants";
import { createApiClient } from "@shubix/api-client";
import { tokenStore } from "./device";

/** BE/api (NestJS): every endpoint. EXPO_PUBLIC_API_URL, else the computer running Expo: in a browser localhost; on a
 * phone (Expo Go) or an emulator the address Expo itself was opened from (the computer's LAN address), port 4000. */
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
export const API_URL = (process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "web" ? "http://localhost:4000" : `http://${devHost || "10.0.2.2"}:4000`)).replace(/\/$/, "");

/** The one API client of the phone app: the token kept on the device (device.ts), sent as Bearer (the website uses
 * the cookie). */
export const api = createApiClient({ baseUrl: API_URL, mobile: true, getToken: tokenStore.get, setToken: tokenStore.set });
