// The API's route list for the build (src/routing/routes.manifest.ts): every src/routes/**/route.ts, each loaded on its
// first request. RouteTable used to find them by reading the folder at start; a list of plain requires lets the bundle
// (scripts/bundle.mjs) take them in, and the API starts without loading 120 route files first.
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(api, "src", "routes"), found = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "route.ts") found.push(p); } };
walk(root);
const routes = found.map((f) => relative(root, dirname(f)).split(sep).join("/")).sort();
const out = `// Made by scripts/route-manifest.mjs (before each build): do not edit. Every src/routes/**/route.ts, loaded on its first request.
/* eslint-disable @typescript-eslint/no-require-imports */
export const ROUTES: [string, () => Record<string, unknown>][] = [
${routes.map((r) => `  [${JSON.stringify(r)}, () => require(${JSON.stringify("../routes/" + r + "/route")})],`).join("\n")}
];
`;
writeFileSync(join(api, "src", "routing", "routes.manifest.ts"), out);
console.log(`routes.manifest.ts: ${routes.length} routes`);
