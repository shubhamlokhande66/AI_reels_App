import { describe, expect, it } from "vitest";
import { motionBetween, revealShape, shapeInside, shotMove } from "@/components/studio/refread";

/** Reading a reference Reel: the shape a transition opens through, and the camera move inside a shot. */
const W = 64, H = 112;
// a smooth, textured picture (so a move can be measured), different per seed
function picture(seed: number) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++)
    out[y * W + x] = 0.5 + 0.22 * Math.sin(x * 0.31 + seed) * Math.cos(y * 0.23 - seed * 0.7) + 0.18 * Math.sin((x + 2 * y) * 0.11 + seed * 1.9);
  return out;
}
// the picture seen through a camera: zoomed by s, shifted by dx / dy (pixels), turned by r degrees
function moved(src: (x: number, y: number) => number, s: number, dx: number, dy: number, r = 0) {
  const out = new Float32Array(W * H), c = Math.cos((-r * Math.PI) / 180), sn = Math.sin((-r * Math.PI) / 180);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x - W / 2 - dx) / s, v = (y - H / 2 - dy) / s;
    out[y * W + x] = src(W / 2 + u * c - v * sn, H / 2 + u * sn + v * c);
  }
  return out;
}
const scene = (seed: number) => (x: number, y: number) => 0.5 + 0.22 * Math.sin(x * 0.31 + seed) * Math.cos(y * 0.23 - seed * 0.7) + 0.18 * Math.sin((x + 2 * y) * 0.11 + seed * 1.9);

describe("transition shapes", () => {
  const A = picture(1), B = picture(4);
  const through = (inside: (x: number, y: number) => boolean) => { const F = new Float32Array(W * H); for (let i = 0; i < W * H; i++) F[i] = inside(i % W, (i / W) | 0) ? B[i] : A[i]; return F; };
  for (const kind of ["iris", "diamond", "heart", "star"] as const) {
    it(`reads a ${kind}`, () => {
      const F = through((x, y) => shapeInside(kind, (x - 30) / 26, (y - 60) / 26));
      expect(revealShape(A, B, F, W, H)).toBe(kind);
    });
  }
  it("reads a straight wipe and bars", () => {
    expect(revealShape(A, B, through((x, y) => x + 0.5 * y < 60), W, H)).toBe("wipe");
    const bw = W / 6;
    expect(revealShape(A, B, through((x, y) => { const k = Math.floor(x / bw); return k % 2 ? y < H * 0.55 : y > H * 0.45; }), W, H)).toBe("bars");
  });
  it("says nothing for a dissolve (every pixel half way)", () => {
    const F = new Float32Array(W * H); for (let i = 0; i < W * H; i++) F[i] = (A[i] + B[i]) / 2;
    expect(revealShape(A, B, F, W, H)).toBeNull();
  });
});

describe("camera moves", () => {
  const sc = scene(2);
  it("measures a zoom, a shift and a turn between two frames", () => {
    const A = moved(sc, 1, 0, 0), B = moved(sc, 1.08, 3, -2, 4);
    const m = motionBetween(A, B, W, H);
    expect(m.s).toBeCloseTo(1.08, 1);
    expect(m.dx * W).toBeCloseTo(3, 0);
    expect(m.dy * H).toBeCloseTo(-2, 0);
    expect(m.r).toBeGreaterThanOrEqual(2);
  });
  it("turns a shot into a few keyframes with its ease: a fast push-in that settles", () => {
    const fs = [0, 0.15, 0.3, 0.5, 0.75, 1], zoom = (f: number) => 1 + 0.2 * (1 - Math.pow(1 - f, 3));
    const frames = fs.map((f) => moved(sc, zoom(f), 0, 0));
    const mv = shotMove(frames, fs, W, H);
    expect(mv.zoom).toBe("in");
    expect(mv.keys[0]).toMatchObject({ f: 0, s: 1 });
    expect(mv.keys[mv.keys.length - 1].s).toBeGreaterThan(1.12);
    expect(mv.keys.length).toBeLessThanOrEqual(5);
    expect(["outCubic", "outExpo"]).toContain(mv.ease);
    expect(mv.shake).toBe(false);
  });
  it("hears a shake and sees a freeze", () => {
    const fs = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const shake = shotMove(fs.map((f, k) => moved(sc, 1, k % 2 ? 4 : -4, 0)), fs, W, H);
    expect(shake.shake).toBe(true);
    const still = shotMove(fs.map((f) => moved(sc, 1 + 0.1 * Math.min(f, 0.4), 0, 0)), fs, W, H);
    expect(still.freeze).toBe(0.4);
  });
});
