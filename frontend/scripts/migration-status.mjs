// Which /api endpoints Next.js serves itself (not just forwards to Python): reads app/api/**/route.ts and ticks
// docs/MIGRATION.md's checklist. Run: node scripts/migration-status.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOC = path.resolve(ROOT, "..", "docs", "MIGRATION.md");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function* routes(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* routes(p);
    else if (e.name === "route.ts") yield p;
  }
}

const served = new Set();
for (const file of routes(path.join(ROOT, "app", "api"))) {
  const src = fs.readFileSync(file, "utf8");
  if (/forwardAll/.test(src)) continue;
  const url = "/" + path.relative(path.join(ROOT, "app"), path.dirname(file)).split(path.sep).map((s) => s.replace(/^\[(.+)\]$/, "{}")).join("/");
  for (const m of METHODS) {
    const own = new RegExp(`export const ${m}\\s*=\\s*(?!toPython)`).test(src) || new RegExp(`export (async )?function ${m}\\b`).test(src);
    if (own) served.add(`${m} ${url}`);
  }
}

const doc = fs.readFileSync(DOC, "utf8");
let done = 0, total = 0;
const out = doc.replace(/- \[[ x]\] `(\w+) ([^`]+)`/g, (_, m, p) => {
  total++;
  const key = `${m} ${p.replace(/\{[^}]+\}/g, "{}")}`;
  const ok = served.has(key);
  if (ok) done++;
  return `- [${ok ? "x" : " "}] \`${m} ${p}\``;
}).replace(/## Endpoints \(\d+\)[^\n]*/, `## Endpoints (${total}) - [x] = served by Next.js: ${done} of ${total}`);
fs.writeFileSync(DOC, out);
console.log(`Next.js serves ${done} of ${total} endpoints`);
