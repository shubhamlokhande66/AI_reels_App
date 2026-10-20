// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import MODEL_FILES from "@/server/studio/model-files.json";

/** Cloudflare's static assets serve the AI models at the same address as the app (scripts/cf-assets.mjs): the list is
 * one, and every file on it exists and fits Cloudflare's limit for one asset (25 MiB). */
describe("the model files served as static assets", () => {
  it("exist, fit 25 MiB, and are the ones the app serves", () => {
    for (const f of MODEL_FILES.files) {
      const p = path.join(process.cwd(), f.dir, f.name);
      expect(fs.existsSync(p), p).toBe(true);
      expect(fs.statSync(p).size).toBeLessThan(25 * 1024 * 1024);
    }
    const route = fs.readFileSync(path.join(process.cwd(), "app/api/studio/model/[name]/route.ts"), "utf8");
    expect(route).toContain("model-files.json");
    const script = fs.readFileSync(path.join(process.cwd(), "scripts/cf-assets.mjs"), "utf8");
    expect(script).toContain("model-files.json");
    expect(script).toContain('"api", "studio", "model"');
  });
});
