import { describe, expect, it } from "vitest";
import { findContentRect } from "@/server/video/analyzer";
import { findDuplicates, type Thumbs } from "@/server/video/duplicates";
import { bestSegments, detectMoments } from "@/server/video/moments";
import { windowDefaults } from "@/server/models/clip";

/** A grey frame: random texture inside [x0, x1) x [y0, y1), flat `pad` around it. */
function frame(w: number, h: number, box: [number, number, number, number], pad: number, seed: number): Uint8Array {
  const f = new Uint8Array(w * h).fill(pad);
  let s = seed;
  for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) { s = (s * 1103515245 + 12345) % 2147483648; f[y * w + x] = 60 + (s % 140); }
  return f;
}

describe("content rect", () => {
  it("finds the picture inside black bars", () => {
    const frames = Array.from({ length: 8 }, (_, i) => frame(180, 320, [0, 80, 180, 240], 0, i + 1));
    const r = findContentRect(frames, 180, 320)!;
    expect(r).not.toBeNull();
    expect(r[1]).toBeCloseTo(0.25, 1);
    expect(r[3]).toBeCloseTo(0.75, 1);
    expect(r[0]).toBe(0);
  });
  it("is null for a full-frame picture", () => {
    expect(findContentRect(Array.from({ length: 8 }, (_, i) => frame(180, 320, [0, 0, 180, 320], 0, i + 1)), 180, 320)).toBeNull();
  });
});

describe("duplicates", () => {
  const clip = (n: number, start: number, seed = 7): Thumbs => ({
    aspect: 0.5625,
    frames: Array.from({ length: n }, (_, i) => { const f = frame(32, 32, [0, 0, 32, 32], 0, seed * 1000 + start + i); let m = 0; for (const v of f) m += v; m /= f.length; return Float32Array.from(f, (v) => v - m); }),
  });
  it("finds a trimmed copy and its offset", () => {
    const d = findDuplicates([["b", clip(20, 10)], ["a", clip(60, 0)]]);
    expect(d).toEqual([{ clipId: "b", sameAs: "a", offset: 2.5 }]);
  });
  it("keeps different clips", () => {
    expect(findDuplicates([["a", clip(40, 0, 1)], ["b", clip(40, 0, 2)]])).toEqual([]);
  });
});

describe("moments", () => {
  it("finds an action peak inside a usable window and builds spans", () => {
    const n = 40;
    const t = Array.from({ length: n }, (_, i) => i * 0.25);
    const sm = t.map((_, i) => (i === 20 ? 0.05 : 0.005));
    const w = windowDefaults({ start: 0, end: 10, quality: 0.8, motion: 0.4, brightness: 0.5, sharpness: 0.8, motionCurve: Array(n).fill(0.3), curveDt: 0.25, shotSize: "medium" });
    const m = detectMoments(t, sm, Array(n).fill(0), Array(n).fill(false), Array(n).fill(0.8), Array(n).fill(0), Array(n).fill(false), [w]);
    expect(m.map((x) => x.kind)).toContain("action_peak");
    expect(m.find((x) => x.kind === "action_peak")!.t).toBe(5);
    const segs = bestSegments([w], m);
    expect(segs[0].moment).toBe("action_peak");
    expect(segs[0].start).toBeCloseTo(4.3, 5);
  });
});
