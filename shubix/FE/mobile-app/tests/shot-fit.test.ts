import { describe, expect, it } from "vitest";
import { fitShot } from "../lib/shotFit";

const length = (s: { start: number; end: number; speed: number }) => (s.end - s.start) / s.speed;

describe("a shot keeps its place on the song", () => {
  it("is left as it is when its clip has room", () => {
    expect(fitShot(1, 1.6, 5, 2)).toEqual({ start: 2, end: 3.6, speed: 1.6 });
  });
  it("starts earlier near the clip's end, at the same speed and length", () => {
    const s = fitShot(0.77, 1.6, 2.02, 1.5);
    expect(s.speed).toBe(1.6);
    expect(s.end).toBeCloseTo(2.02);
    expect(length(s)).toBeCloseTo(0.77);
  });
  it("plays slower when the clip is too short, at the same length", () => {
    const s = fitShot(2, 1, 1.56, 0.5);
    expect(s.start).toBe(0);
    expect(s.speed).toBeCloseTo(0.78);
    expect(length(s)).toBeCloseTo(2);
  });
  it("never goes under the editor's lowest speed", () => {
    expect(fitShot(10, 1, 1, 0).speed).toBe(0.25);
  });
  it("keeps a whole Reel's length, whatever its clips", () => {
    const shots = [[2.52, 1, 2.52, 0], [0.77, 1.6, 2.02, 1.2], [0.75, 1.6, 1.6, 1.1], [3, 1, 1.56, 0.85], [1.03, 0.5, 2.47, 1.79]] as const;
    const total = shots.reduce((sum, [t, sp, d, at]) => sum + length(fitShot(t, sp, d, at)), 0);
    expect(total).toBeCloseTo(shots.reduce((sum, [t]) => sum + t, 0));
  });
});
