// The Play Store build: a signed .aab, made on this computer (`pnpm aab` here, or `npm run android:aab` at the root).
// 1. checks the upload key's settings (FE/mobile-app/keystore.properties, never in git) and the key file it names
// 2. makes android/ again from the app config (expo prebuild --clean: the AdMob id, the version, the upload key)
// 3. gradlew bundleRelease, with the live API; prints where the .aab is
// Raise "versionCode" in app.json before each upload: Play takes each number once.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const win = process.platform === "win32";
const stop = (why) => { console.error("\n✖ " + why + "\n"); process.exit(1); };
const run = (cmd, args, cwd, env) => {
  console.log("\n› " + [cmd, ...args].join(" "));
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit", shell: win });
  if (r.status !== 0) stop(`"${cmd} ${args.join(" ")}" failed (exit ${r.status}).`);
};

// 1. the upload key
const ksPath = join(app, "keystore.properties");
if (!existsSync(ksPath)) stop("FE/mobile-app/keystore.properties is missing: storeFile, storePassword, keyAlias, keyPassword (docs/android-release.md).");
const ks = Object.fromEntries(readFileSync(ksPath, "utf8").split(/\r?\n/).map((l) => l.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
for (const k of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) if (!ks[k]) stop(`keystore.properties has no ${k}.`);
if (!existsSync(ks.storeFile)) stop(`The upload key file ${ks.storeFile} is not there.`);
const cfg = JSON.parse(readFileSync(join(app, "app.json"), "utf8")).expo;
console.log(`Shubix ${cfg.version} (versionCode ${cfg.android.versionCode}), signed with ${ks.storeFile}`);

const env = {
  ...process.env,
  NODE_ENV: "production",
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL || "https://api.shubix.in",
  ADMOB_ANDROID_APP_ID: process.env.ADMOB_ANDROID_APP_ID || "ca-app-pub-5459735473283681~7574692434",
  ANDROID_HOME: process.env.ANDROID_HOME || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : ""),
};

// 2. android/ from the config, then 3. the bundle
run("node", ["engine/build.mjs"], app, env);
run("npx", ["expo", "prebuild", "-p", "android", "--clean", "--no-install"], app, env);
const android = join(app, "android");
run(win ? `"${join(android, "gradlew.bat")}"` : "./gradlew", ["bundleRelease"], android, env);

const aab = join(android, "app", "build", "outputs", "bundle", "release", "app-release.aab");
if (!existsSync(aab)) stop("The build finished but app-release.aab is not there.");
console.log(`\n✔ ${aab} (${(statSync(aab).size / 1048576).toFixed(1)} MB)\n  Upload it in Play Console → Test and release → Closed testing → Create new release.\n`);
