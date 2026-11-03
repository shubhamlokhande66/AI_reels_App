import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Fast Studio's WebGL shader is a string (Shared/core/src/lib/shaders.ts): a "//" comment that runs into code on the same line
 * silently turns the GPU renderer off (it happened once: every phone fell back to the slower 2D renderer). */
const src = readFileSync("../../Shared/core/src/lib/shaders.ts", "utf8");
const glsl = src.slice(src.indexOf("export const MAIN_FRAG = `"), src.indexOf("`;", src.indexOf("export const MAIN_FRAG = `")));

describe("studio shader source", () => {
  it("is found", () => { expect(glsl.length).toBeGreaterThan(2000); });
  it("has no code hidden behind a // comment", () => {
    const bad = glsl.split("\n").filter((l) => { const i = l.indexOf("//"); return i >= 0 && /;/.test(l.slice(i)); });
    expect(bad).toEqual([]);
  });
});
