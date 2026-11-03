// A locked backup of what cannot be made again (`npm run backup:keys`): the Play upload key and its settings, and the
// .env files with the live keys, in one zip (AES-256) on the Desktop, named with today's date. 7-Zip asks for the zip's
// password (typed by you, never stored). Put the zip on Google Drive; keep its password somewhere else.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const z = ["C:\\Program Files\\7-Zip\\7z.exe", "C:\\Program Files (x86)\\7-Zip\\7z.exe"].find(existsSync);
if (!z) { console.error("✖ 7-Zip is not installed (7-zip.org)."); process.exit(1); }

const files = [
  join(root, "FE", "mobile-app", "keys"),
  join(root, "FE", "mobile-app", "keystore.properties"),
  join(root, ".env"),
  join(root, "..", ".env.local"),
].filter(existsSync);
if (!files.length) { console.error("✖ Nothing to back up."); process.exit(1); }

const out = join(homedir(), "Desktop", `shubix-keys-backup-${new Date().toISOString().slice(0, 10)}.zip`);
console.log("Backing up:\n  " + files.join("\n  ") + "\n→ " + out + "\n7-Zip asks for the zip's password next (it does not show while typed).\n");
const r = spawnSync(z, ["a", "-tzip", "-mem=AES256", "-p", out, ...files], { stdio: "inherit" });
if (r.status !== 0) { console.error("✖ 7-Zip failed (exit " + r.status + ")."); process.exit(1); }
console.log("\n✔ " + out + "\n  Upload it to drive.google.com, then delete it here. Keep the zip's password off Drive.");
