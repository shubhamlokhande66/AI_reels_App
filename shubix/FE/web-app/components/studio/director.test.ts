import { describe, expect, it } from "vitest";
import { createDirectorPlan, evaluateKeyframes, EFFECT_LIBRARY, TRANSITION_LIBRARY } from "@shubix/video-engine";

describe("shared video director", () => {
  it("interpolates keyframes and honours hold segments", () => {
    const frames = [
      { id: "a", time: 0, value: 0, easing: "linear" as const },
      { id: "b", time: 2, value: 10, easing: "hold" as const },
      { id: "c", time: 4, value: 20, easing: "linear" as const },
    ];
    expect(evaluateKeyframes(frames, 1)).toBe(5);
    expect(evaluateKeyframes(frames, 3)).toBe(10);
    expect(evaluateKeyframes(frames, 8)).toBe(20);
  });

  it("prioritises high-quality moments and aligns the edit to supplied beats", () => {
    const plan = createDirectorPlan({
      targetDuration: 6, beats: [0, 2, 4, 6], mood: "energetic",
      shots: [
        { id: "weak", sourceIndex: 0, duration: 5, quality: 0.2, motion: 0.2 },
        { id: "hero", sourceIndex: 1, duration: 5, quality: 0.98, motion: 0.8, isHighlight: true },
      ],
    });
    expect(plan.shots[0].sourceId).toBe("hero");
    expect(plan.soundtrack.beatSync).toBe(true);
    expect(plan.shots[0].keyframes.length).toBeGreaterThan(0);
  });

  it("limits effect choices to mobile-safe effects for mobile plans", () => {
    const plan = createDirectorPlan({
      targetDuration: 8, mood: "cinematic", mobile: true,
      shots: [{ id: "a", sourceIndex: 0, duration: 8, quality: 0.9, motion: 0.6 }],
    });
    for (const id of plan.shots.flatMap(s => s.effects)) {
      expect(EFFECT_LIBRARY.find(e => e.id === id)?.mobileSafe).toBe(true);
    }
  });

  it("ships broad professional effect and transition registries", () => {
    expect(EFFECT_LIBRARY.length).toBeGreaterThanOrEqual(20);
    expect(TRANSITION_LIBRARY.length).toBeGreaterThanOrEqual(15);
  });
});
