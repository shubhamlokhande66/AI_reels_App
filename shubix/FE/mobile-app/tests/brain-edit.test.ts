import { describe, expect, it } from "vitest";
import { createEditBrain } from "../engine/brain/edit";

// the edit core with no page at all: its state is a plain object, what stays in the page comes through hooks
describe("the edit core outside the browser", () => {
  const brain = () => { const ES: Record<string, unknown> = { seed: 42, beats: [0.5, 1, 1.5, 2] }; return { ES, ...createEditBrain(ES, {}) }; };

  it("loads and gives its functions", () => {
    const b = brain();
    for (const name of ["beatEdit", "scoreWindow", "finishTransitions", "noFlashCuts", "colorHist"]) expect(typeof b[name as keyof typeof b]).toBe("function");
  });
  it("reads a clip's frame from plain bytes, with no picture", () => {
    const SW = 8, SH = 8, b = createEditBrain({}, { SW, SH });
    const flat = (v: number, w: number, h: number) => new Uint8ClampedArray(w * h * 4).fill(v);
    const dark = b.frameStats(flat(10, SW, SH), flat(10, 128, 72), null);
    const light = b.frameStats(flat(200, SW, SH), flat(200, 128, 72), dark.lum);
    expect(dark.row.m).toBe(0);                     // nothing before it: no motion
    expect(light.row.m).toBeGreaterThan(0.5);       // the whole frame changed
    expect(light.row.b).toBeGreaterThan(dark.row.b);
    expect(dark.row.sh).toBeCloseTo(0);             // a flat frame has no edges
  });
  it("keeps its random numbers in its state, so a Reel can be made again", () => {
    const a = brain(), first = [a.rng(), a.rng()], seedAfter = a.ES.seed, c = brain();
    expect([c.rng(), c.rng()]).toEqual(first);
    expect(seedAfter).not.toBe(42);
  });
});
