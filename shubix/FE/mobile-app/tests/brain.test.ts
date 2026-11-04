import { describe, expect, it } from "vitest";
import { clipBytes, endWell, fmt, lowerB, nearestS, panClamp, rmsOf, upperB } from "../engine/brain/pure";

// runs without a browser (no document, no window): the brain must stay able to leave the hidden page
describe("the engine's brain outside the browser", () => {
  it("has no browser here", () => {
    expect(typeof document).toBe("undefined");
    expect(typeof window).toBe("undefined");
  });
  it("finds places in sorted lists", () => {
    expect(lowerB([1, 2, 2, 3], 2)).toBe(1);
    expect(upperB([1, 2, 2, 3], 2)).toBe(3);
    expect(nearestS([{ t: 0 }, { t: 1 }, { t: 2 }], 1.4)).toBe(1);
  });
  it("joins a part under a second into the one before it", () => {
    expect(endWell([{ start: 0, end: 2 }, { start: 2, end: 2.5 }])).toEqual([{ start: 0, end: 2.5 }]);
  });
  it("keeps a wide picture inside the frame, and centres a narrow one", () => {
    expect(panClamp(10, 100, 200)).toBe(0);
    expect(panClamp(-500, 100, 200)).toBe(-100);
    expect(panClamp(0, 100, 50)).toBe(25);
  });
  it("words times, sizes and loudness", () => {
    expect(fmt(65.5)).toBe("1:05.50");
    expect(clipBytes(2048)).toBe("2 KB");
    expect(rmsOf(new Float32Array(8).fill(0.5))).toBeCloseTo(0.5);
  });
});
