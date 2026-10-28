// The Android app for Google Play: a signed App Bundle (.aab) of the Capacitor app (docs/android-release.md).
//
//   CAP_SERVER_URL=https://your-live-site npm run android:release            build android/app/build/outputs/bundle/release/app-release.aab
//   CAP_SERVER_URL=https://your-live-site npm run android:release -- --bump  the same, one version up (every upload needs a new code)
//
// It stops before building when the app would open a test address (localhost, a quick tunnel) or no address at all, or
// when the upload key is missing: a store build must open the live site and be signed.
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd(), android = join(root, "android");
const stop = (msg) => { console.error("\n✗ " + msg + "\n  See docs/android-release.md\n"); process.exit(1); };

// the address the app opens: the live site, https, not a test one
const url = (process.env.CAP_SERVER_URL || "").trim();
if (!url) stop("CAP_SERVER_URL is not set: the app would have nothing to open. Set it to the live site, e.g. https://shubix.app");
let host = "";
try { const u = new URL(url); if (u.protocol !== "https:") stop("CAP_SERVER_URL must be https (Google Play and Android block plain http)."); host = u.hostname; }
catch { stop("CAP_SERVER_URL is not a web address: " + url); }
if (/^(localhost|127\.|10\.|192\.168\.)|\.local$|trycloudflare\.com$|ngrok/.test(host)) stop("CAP_SERVER_URL is a test address (" + host + "). A store build must open the live site.");

// the upload key: keystore.properties and the key file it names
const ksProps = join(android, "keystore.properties");
if (!existsSync(ksProps)) stop("android/keystore.properties is missing: Google Play only accepts a signed bundle.");
const ks = Object.fromEntries(readFileSync(ksProps, "utf8").split(/\r?\n/).filter((l) => /^\s*[\w.]+\s*=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
for (const k of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) if (!ks[k]) stop("android/keystore.properties has no " + k + ".");
if (!existsSync(join(android, ks.storeFile))) stop("The upload key file android/" + ks.storeFile + " is missing.");

// the version: --bump raises the code by one (and the last number of the name)
const vFile = join(android, "app", "version.properties");
const v = Object.fromEntries(readFileSync(vFile, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => l.split("=").map((x) => x.trim())));
if (process.argv.includes("--bump")) {
  v.VERSION_CODE = String(Number(v.VERSION_CODE || 1) + 1);
  const p = (v.VERSION_NAME || "1.0.0").split("."); p[p.length - 1] = String(Number(p[p.length - 1] || 0) + 1); v.VERSION_NAME = p.join(".");
  writeFileSync(vFile, `VERSION_CODE=${v.VERSION_CODE}\nVERSION_NAME=${v.VERSION_NAME}\n`);
}
console.log(`Shubix for Android ${v.VERSION_NAME} (code ${v.VERSION_CODE}), opening ${url}`);

const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit", env: { ...process.env, CAP_SERVER_URL: url } });
run("npx cap sync android");
run(process.platform === "win32" ? "gradlew.bat bundleRelease" : "./gradlew bundleRelease", android);
console.log("\n✓ android/app/build/outputs/bundle/release/app-release.aab: upload it in Google Play Console (Testing → Internal testing first).\n");
