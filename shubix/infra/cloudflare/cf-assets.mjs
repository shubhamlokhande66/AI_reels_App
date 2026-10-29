// Cloudflare: the files that never change are served as the Worker's static assets (cloudflare/wrangler.jsonc
// "assets"): free and unlimited, from the Cloudflare server nearest the person, and the app's container is not woken for
// them. A request for one of these paths never reaches the container; anything else (pages, the API, Next's own JS) goes
// to it as before. Builds cloudflare/assets/ (not committed); runs before `wrangler deploy` (cloudflare/package.json and
// .github/workflows/deploy-cloudflare.yml).
//   - public/ (the logo, icons, template covers, sample clips, vendor/ort = the AI engine, vendor/piper, vendor/tracking)
//   - the AI models Fast Studio downloads, at the same address the app serves them: /api/studio/model/<name>
//   - _headers: the same headers next.config.ts gives these paths
// Next's own JS (/_next/static) stays with the container: its file names come from the build inside the container image.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// infra/cloudflare: public/ is the web app's, the AI models are the API's
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../..");
const WEB = path.join(ROOT, "FE", "web-app"), API = path.join(ROOT, "BE", "api");
const OUT = path.join(HERE, "assets");
const MAX = 25 * 1024 * 1024; // Cloudflare's limit for one static asset
const SKIP = new Set(["sw.js"]); // the service worker keeps the app's own headers (no-cache, Service-Worker-Allowed)

// public/vendor/ort and vendor/piper come from node_modules (scripts/copy-ort.mjs, as before a build)
execFileSync(process.execPath, [path.join(WEB, "scripts", "copy-ort.mjs")], { cwd: WEB, stdio: "inherit" });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
let files = 0, bytes = 0;
const skipped = [];
const put = (from, to) => {
  const size = fs.statSync(from).size;
  if (size > MAX) { skipped.push(`${path.relative(ROOT, from)} (${(size / 1e6).toFixed(1)} MB, over 25 MiB: the app serves it)`); return; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files++; bytes += size;
};
const walk = (dir, rel = "") => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) walk(path.join(dir, e.name), r);
    else if (!(rel === "" && SKIP.has(e.name)) && !e.name.startsWith(".")) put(path.join(dir, e.name), path.join(OUT, r));
  }
};
walk(path.join(WEB, "public"));

const models = JSON.parse(fs.readFileSync(path.join(API, "src", "server", "studio", "model-files.json"), "utf8")).files;
for (const m of models) {
  const from = path.join(API, m.dir, m.name);
  if (!fs.existsSync(from)) { skipped.push(`${path.relative(ROOT, from)} (missing: the app serves it)`); continue; }
  put(from, path.join(OUT, "api", "studio", "model", m.name));
}

// the headers next.config.ts gives these paths (security on all; the AI engine's worker files and the logo under the
// cross-origin isolation the studio needs; the models cached for a year, their names change with the model)
fs.writeFileSync(path.join(OUT, "_headers"), `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(self), geolocation=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
/brand/*
  Cross-Origin-Resource-Policy: same-origin
/icon-*
  Cross-Origin-Resource-Policy: same-origin
/vendor/*
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: same-origin
/api/studio/model/*
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
`);
console.log(`cf-assets: ${files} files, ${(bytes / 1e6).toFixed(1)} MB → cloudflare/assets`);
for (const s of skipped) console.warn("cf-assets: skipped " + s);
