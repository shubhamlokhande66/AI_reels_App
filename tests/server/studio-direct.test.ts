// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ManagedProvider } from "@/server/ai";
import { direct, DirectIn, LIMITS, parsePlan, prompt } from "@/server/studio/direct";

/** Fast Studio's AI director: the request is bounded, and the plan can only name what the phone offered. */
const cand = (id: string, extra = {}) => ({ id, clip: "c1", at: 1.5, score: 1.2, note: "dancer spins", roles: ["action"], motion: "high", people: true, camera: "pans left", ...extra });
const req = (n = 3) => DirectIn.parse({
  mode: "auto", duration: 20, bpm: 120, hook: "WAIT FOR IT", clips: [{ alias: "c1", summary: "rooftop dance", mood: "energetic" }],
  budget: { whip: 2 },
  slots: Array.from({ length: n }, (_, i) => ({ i, t: i * 2, len: 2, type: i === 1 ? "drop" : "cut", beats: 2, candidates: [cand(`${i}a`), cand(`${i}b`, { clip: "c2" })] })),
});

function fake(answer: unknown) {
  const calls: string[] = [];
  const p = { name: "fake", model: "fake-text", visionModel: "",
    async structured(_s: string, user: string, schema: { parse: (v: unknown) => unknown }) { calls.push(user); return schema.parse(answer); } };
  return { p: p as unknown as ManagedProvider, calls };
}

describe("request limits", () => {
  it("accepts a normal plan request", () => { expect(req(40).slots).toHaveLength(40); });
  it("rejects too many cuts or candidates, bad ids and unknown cut types", () => {
    const base = req(1);
    expect(DirectIn.safeParse({ ...base, slots: Array.from({ length: LIMITS.slots + 1 }, (_, i) => ({ ...base.slots[0], i: i % LIMITS.slots })) }).success).toBe(false);
    expect(DirectIn.safeParse({ ...base, slots: [{ ...base.slots[0], candidates: [cand("0a"), cand("0b"), cand("0c"), cand("0a")] }] }).success).toBe(false);
    expect(DirectIn.safeParse({ ...base, slots: [{ ...base.slots[0], candidates: [cand("x; drop table")] }] }).success).toBe(false);
    expect(DirectIn.safeParse({ ...base, slots: [{ ...base.slots[0], type: "boom" }] }).success).toBe(false);
  });
  it("puts every cut and its candidates in the prompt, with the rules", () => {
    const text = prompt(req(3));
    expect(text).toContain('"id":"2b"');
    expect(text).toContain("Style: auto");
    expect(text).toContain("hook");
    expect(text).toContain('{"whip":2}');
  });
});

describe("the plan is bounded", () => {
  it("keeps offered shots and known choices, nulls the rest, drops unknown or repeated cuts", () => {
    const d = req(3);
    const out = parsePlan(d, {
      story: "Rooftop build-up to a spinning drop",
      slots: [
        { i: 0, shot: "0B", transition: "Hard", effect: "hook", speed: "normal", why: "strongest opening" },
        { i: 1, shot: "1c", transition: "teleport", effect: "zoomburst", speed: "warp", why: "" },   // 1c was not offered
        { i: 1, shot: "1a", transition: "flash", effect: "none", speed: "normal", why: "repeat" },   // second answer for 1: ignored
        { i: 7, shot: "7a", transition: "hard", effect: "none", speed: "normal", why: "no such cut" },
        { i: 2, shot: "2a", transition: "whip", effect: "pan", speed: "ramp", why: "x".repeat(200) },
      ],
    });
    expect(out.slots.map((s) => s.i)).toEqual([0, 1, 2]);
    expect(out.slots[0]).toMatchObject({ shot: "0b", transition: "hard", effect: "hook", speed: "normal" });
    expect(out.slots[1]).toMatchObject({ shot: null, transition: null, effect: "zoomburst", speed: null });
    expect(out.slots[2].why.length).toBeLessThanOrEqual(60);
    expect(out.story).toBe("Rooftop build-up to a spinning drop");
  });
  it("refuses a plan with no usable cut", () => {
    expect(() => parsePlan(req(2), { story: "", slots: [{ i: 9, shot: "9a", transition: "hard", effect: "none", speed: "normal", why: "" }] })).toThrow();
  });
  it("asks the model once and returns the cleaned plan", async () => {
    const { p, calls } = fake({ slots: [{ i: 0, shot: "0a" }, { i: 1, shot: "1b", transition: "flash", effect: "zoomburst" }], story: "s" });
    const res = await direct(req(2), p);
    expect(calls).toHaveLength(1);
    expect(res.slots).toEqual([
      { i: 0, shot: "0a", transition: "hard", effect: "none", speed: "normal", why: "" },
      { i: 1, shot: "1b", transition: "flash", effect: "zoomburst", speed: "normal", why: "" },
    ]);
  });
});
