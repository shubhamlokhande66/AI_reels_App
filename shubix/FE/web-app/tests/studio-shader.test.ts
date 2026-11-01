import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Fast Studio's WebGL shader is a string inside the engine: a "//" comment that runs into code on the same line
 * silently turns the GPU renderer off (it happened once: every phone fell back to the slower 2D renderer). */
const src = readFileSync("components/studio/engine.ts", "utf8");
const glsl = src.slice(src.indexOf("const GLSL_F = `"), src.indexOf("`;", src.indexOf("const GLSL_F = `")));

describe("studio shader source", () => {
  it("is found", () => { expect(glsl.length).toBeGreaterThan(2000); });
  it("has no code hidden behind a // comment", () => {
    const bad = glsl.split("\n").filter((l) => { const i = l.indexOf("//"); return i >= 0 && /;/.test(l.slice(i)); });
    expect(bad).toEqual([]);
  });
});
