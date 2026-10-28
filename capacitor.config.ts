import type { CapacitorConfig } from "@capacitor/cli";

/** Shubix as a phone app (Capacitor): the same app, in an app of its own on the home screen, full screen.
 * It needs its server (sign-in, the AI, My Reels), so the app opens the server's address: CAP_SERVER_URL, an https
 * address the phone can reach (the deployed site, or for testing a tunnel to this computer:
 * `cloudflared tunnel --url http://localhost:3000`). Set it, then `npx cap sync` (docs/capacitor.md).
 * capacitor/www is only the page shown when that address cannot be reached. */
const server = process.env.CAP_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "in.shubix.reelmaker", // the Google Play package name
  appName: "Shubix",
  webDir: "capacitor/www",
  backgroundColor: "#0a0a1f",
  server: server ? { url: server, cleartext: false, errorPath: "index.html" } : undefined,
  android: { allowMixedContent: false },
  ios: { contentInset: "never", limitsNavigationsToAppBoundDomains: false },
};

export default config;
