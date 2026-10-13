// @vitest-environment node
import { describe, expect, it } from "vitest";
import { Keyframe } from "@/server/models/timeline";
import * as kfx from "@/server/video/keyframes";
import { python, rng } from "./parity";

/** The keyframe engine against backend/app/video/keyframes.py: validation, footage of a ramp, and the exact FFmpeg
 * expressions (the renderer runs them, so they must be the same text). */
describe("keyframes: same as the Python backend", () => {
  it("200 random animations", { timeout: 120_000 }, () => {
    const r = rng(11);
    const props = ["zoom", "x", "y", "rotation", "opacity", "blur", "brightness", "speed"] as const;
    const cases = Array.from({ length: 200 }, () => ({
      kind: "keyframes", length: r.num(0.3, 6),
      keyframes: Array.from({ length: r.int(0, 6) }, () => {
        const k: Record<string, unknown> = { t: r.num(-0.5, 7), ease: r.pick(["linear", "ease_in", "ease_out", "ease_in_out", "hold"]) };
        for (const p of props) if (r.next() < 0.3) k[p] = r.num(-25, 25);
        return k;
      }),
    }));
    const py = python<{ keyframes: unknown[]; notes: string[]; source: number; motion: string; frame: string[]; setpts: string | null }>(cases);
    if (!py) return;
    cases.forEach((c, i) => {
      const [v, notes] = kfx.validate(c.keyframes.map((k) => Keyframe.parse(k)), c.length);
      const want = py[i];
      expect(v, `case ${i}`).toEqual(want.keyframes);
      expect(notes, `case ${i}`).toEqual(want.notes);
      expect(Math.abs(kfx.sourceSeconds(v, c.length) - want.source)).toBeLessThan(1e-9);
      expect(kfx.motionChain(v, 1080, 1920), `case ${i}`).toBe(want.motion);
      expect(kfx.frameFilters(v, 1080, 1920), `case ${i}`).toEqual(want.frame);
      expect(kfx.hasSpeed(v) ? kfx.speedSetpts(v, c.length) : null, `case ${i}`).toBe(want.setpts);
    });
  });
});
