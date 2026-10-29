// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ManagedProvider } from "../../src/server/ai";
import { LIMITS, parseLines, prompt, translateLines, TranslateIn } from "../../src/server/studio/translate";

/** Fast Studio's caption translation: bounded requests, and only the lines that were asked for come back. */
const req = (n = 3, to = "mr") => TranslateIn.parse({ to, lines: Array.from({ length: n }, (_, i) => ({ i, text: `line ${i} ₹999 🔥` })) });
function fake(answer: unknown) {
  const calls: string[] = [];
  const p = { name: "fake", model: "fake-text", visionModel: "", async structured(_s: string, user: string, schema: { parse: (v: unknown) => unknown }) { calls.push(user); return schema.parse(answer); } };
  return { p: p as unknown as ManagedProvider, calls };
}

describe("requests", () => {
  it("accepts the supported languages, refuses others and oversized input", () => {
    expect(req(5, "hinglish").lines).toHaveLength(5);
    expect(TranslateIn.safeParse({ to: "fr", lines: [{ i: 0, text: "x" }] }).success).toBe(false);
    expect(TranslateIn.safeParse({ to: "mr", lines: [{ i: 0, text: "x".repeat(LIMITS.chars + 1) }] }).success).toBe(false);
    expect(TranslateIn.safeParse({ to: "mr", lines: Array.from({ length: LIMITS.lines + 1 }, (_, i) => ({ i: i % LIMITS.lines, text: "x" })) }).success).toBe(false);
    expect(TranslateIn.safeParse({ to: "mr", lines: [] }).success).toBe(false);
  });
  it("asks for the right language, keeps prices, names and emoji", () => {
    const t = prompt(req(2, "mr"));
    expect(t).toContain("Marathi (Devanagari script)");
    expect(t).toContain("₹999");
    expect(t).toMatch(/names, brands, numbers, prices/);
  });
});

describe("answers", () => {
  it("keep only asked lines, once each, in order, and never empty", () => {
    const d = req(3);
    const out = parseLines(d, { lines: [{ i: 2, text: " तिसरी " }, { i: 0, text: "पहिली" }, { i: 0, text: "again" }, { i: 9, text: "not asked" }, { i: 1, text: "" }] });
    expect(out).toEqual([{ i: 0, text: "पहिली" }, { i: 2, text: "तिसरी" }]);
    expect(() => parseLines(d, { lines: [{ i: 7, text: "x" }] })).toThrow();
  });
  it("goes through the provider in one call", async () => {
    const { p, calls } = fake({ lines: [{ i: 0, text: "नमस्कार" }, { i: 1, text: "चला" }] });
    const r = await translateLines(req(2), p);
    expect(calls).toHaveLength(1);
    expect(r.lines.map((l) => l.text)).toEqual(["नमस्कार", "चला"]);
    expect(r.to).toBe("mr");
  });
});
