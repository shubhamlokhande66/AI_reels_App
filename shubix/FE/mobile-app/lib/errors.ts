import { Platform } from "react-native";
import { API_URL } from "./session";

type Handler = (error: Error, fatal?: boolean) => void;
type Utils = { getGlobalHandler(): Handler; setGlobalHandler(h: Handler): void };

/** Errors in the store app reach Admin → Errors, as the website's do (lib/useErrorReport.ts): nothing personal, at most
 * ten in a run, and the app's own handling goes on as before. */
export function reportErrors() {
  const utils = (globalThis as unknown as { ErrorUtils?: Utils }).ErrorUtils;
  if (__DEV__ || !utils) return;
  const before = utils.getGlobalHandler();
  let sent = 0;
  utils.setGlobalHandler((error, fatal) => {
    if (sent++ < 10) void fetch(`${API_URL}/api/public/client-error`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: fatal ? "crash" : "error", message: String(error?.message || error).slice(0, 400), stack: String(error?.stack || "").slice(0, 2000), path: `app/${Platform.OS}` }),
    }).catch(() => {});
    before(error, fatal);
  });
}
