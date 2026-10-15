// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { parseTimeline } from "@/server/models/timeline";
import { buildFilterGraph, renderConfig } from "@/server/video/render/cutter";
import { effectsEnabled, withoutEffects } from "@/server/video/render/renderer";

afterEach(() => { delete process.env.NEXT_PUBLIC_EFFECTS; });

const tl = () => parseTimeline({ duration: 4, segments: [{
  clipId: "c", video: "v", sourceStart: 0, sourceEnd: 2, timelineStart: 0, timelineEnd: 2, effect: "zoom_pulse", looks: ["glow"],
  keyframes: [{ t: 0, zoom: 1 }, { t: 0.4, zoom: 1.12 }, { t: 0.7, zoom: 1 }], transitionIn: { type: "cut", duration: 0 },
}, {
  clipId: "c", video: "v", sourceStart: 2, sourceEnd: 4, timelineStart: 2, timelineEnd: 4, effect: "shake", transitionIn: { type: "dissolve", duration: 0.3 },
}] });

describe("effects off: clean shots and transitions only", () => {
  it("is off unless NEXT_PUBLIC_EFFECTS=on", () => {
    expect(effectsEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_EFFECTS = "on";
    expect(effectsEnabled()).toBe(true);
  });

  it("drops every shot's effect, looks and keyframed motion, and keeps the transitions", () => {
    const clean = withoutEffects(tl());
    for (const s of clean.segments) expect([s.effect, s.looks, s.keyframes]).toEqual(["none", [], []]);
    expect(clean.segments[1].transitionIn).toEqual({ type: "dissolve", duration: 0.3 });
    const src = { path: "x.mp4", width: 1080, height: 1920, name: "x", content: null } as never;
    const plan = { length: 2, tail: 0, ramp: false, hits: [0.5, 1] };
    const graph = buildFilterGraph(clean.segments[0], src, plan, renderConfig());
    expect(graph).not.toMatch(/sin\(|gblur=sigma=\d+\[gl3\]|blend=all_mode=screen/); // no pulse, no glow
  });
});
