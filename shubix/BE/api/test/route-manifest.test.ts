import { readdirSync } from "node:fs";
import { join, relative, sep, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES } from "../src/routing/routes.manifest";

/** The route list the API starts from (scripts/route-manifest.mjs, made before each build) has every route.ts under src/routes:
 * a route missing from it would answer 404 in the deployed (bundled) API. */
describe("route manifest", () => {
  it("lists every route file, and only those", () => {
    const root = join(__dirname, "..", "src", "routes"), found: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === "route.ts") found.push(relative(root, dirname(p)).split(sep).join("/")); } };
    walk(root);
    expect(ROUTES.map(([r]) => r).sort()).toEqual(found.sort());
  });
});
