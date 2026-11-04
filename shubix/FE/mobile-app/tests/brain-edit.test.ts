import { describe, expect, it } from "vitest";
import { createEditBrain } from "../engine/brain/edit";

// the edit core with no page at all: its state is a plain object, what stays in the page comes through hooks
describe("the edit core outside the browser", () => {
  const brain = () => { const ES: Record<string, unknown> = { seed: 42, beats: [0.5, 1, 1.5, 2] }; return { ES, ...createEditBrain(ES, {}) }; };

  it("loads and gives its functions", () => {
    const b = brain();
    for (const name of ["beatEdit", "scoreWindow", "finishTransitions", "noFlashCuts", "colorHist"]) expect(typeof b[name as keyof typeof b]).toBe("function");
  });
  it("keeps its random numbers in its state, so a Reel can be made again", () => {
    const a = brain(), first = [a.rng(), a.rng()], seedAfter = a.ES.seed, c = brain();
    expect([c.rng(), c.rng()]).toEqual(first);
    expect(seedAfter).not.toBe(42);
  });
});
