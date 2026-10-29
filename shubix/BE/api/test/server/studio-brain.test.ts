// @vitest-environment node
import { describe, expect, it } from "vitest";
import { tasteOf } from "../../src/server/studio/brain";

/** The AI edits more like each creator: their repeated corrections become one sentence in its plan. */
describe("taste", () => {
  const e = (type: string, field: string, from: string, to: string) => ({ type, field, from, to });
  it("is empty without enough corrections", () => {
    expect(tasteOf([])).toBe("");
    expect(tasteOf([e("drop", "tr", "hard", "flash")])).toBe("");
  });
  it("names what they keep choosing and what they keep removing", () => {
    const t = tasteOf([
      e("drop", "tr", "glitch", "flash"), e("drop", "tr", "hard", "flash"), e("drop", "tr", "glitch", "flash"),
      e("hit", "efx", "shake", "punch"), e("cut", "efx", "shake", "none"), e("hit", "efx", "shake", "punch"),
      e("cut", "tr", "glitch", "hard"),
    ]);
    expect(t).toContain('on drops they choose transition "flash" (3x)');
    expect(t).toContain('on hits they choose effect "punch" (2x)');
    expect(t).toContain('they often remove transition "glitch" (3x)');
    expect(t).toContain('they often remove effect "shake" (3x)');
  });
});
