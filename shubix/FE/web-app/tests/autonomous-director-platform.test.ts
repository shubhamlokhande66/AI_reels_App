import { describe, expect, it } from "vitest";
import {
  createAutonomousReelPlan,
  getEditorTools,
  inferAutonomousMood,
  validateAutonomousReelPlan,
  type AutonomousSourceShot,
} from "../../../Shared/video-engine/src/index";

const shots: AutonomousSourceShot[] = [
  { id: "a", sourceIndex: 0, duration: 4, quality: 0.95, motion: 0.3, subjectScore: 0.9, aestheticScore: 0.9, isUsable: true, isProduct: true, isOpening: true },
  { id: "b", sourceIndex: 1, duration: 4, quality: 0.9, motion: 0.5, subjectScore: 0.85, aestheticScore: 0.85, isUsable: true, isDetail: true, isProduct: true },
  { id: "c", sourceIndex: 2, duration: 4, quality: 0.88, motion: 0.7, subjectScore: 0.8, aestheticScore: 0.82, isUsable: true, isHighlight: true, isAction: true },
  { id: "d", sourceIndex: 3, duration: 4, quality: 0.92, motion: 0.2, subjectScore: 0.88, aestheticScore: 0.9, isUsable: true, isEnding: true, isReaction: true },
];

describe("autonomous Shubix Director", () => {
  it("does not report ready when the available footage cannot fill the requested duration", () => {
    const plan = createAutonomousReelPlan({
      shots: [
        { ...shots[0], duration: 2 },
        { ...shots[1], duration: 2 },
      ],
      music: { duration: 20, bpm: 112, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5] },
      targetDuration: 12,
      mood: "product",
      platform: "web",
    });
    expect(plan.duration).toBeLessThan(12);
    expect(plan.status).toBe("needs-more-footage");
    expect(plan.warnings.some((warning) => warning.includes("could not fill"))).toBe(true);
  });

  it("does not report ready when a required subject is present but omitted from the final edit", () => {
    const plan = createAutonomousReelPlan({
      shots: [
        { ...shots[0], id: "opening", tags: ["car"], isOpening: true },
        { ...shots[1], id: "ending", tags: ["car"], isEnding: true },
        { ...shots[2], id: "requested", tags: ["motorcycle"], quality: 0.1, subjectScore: 0.1, isUsable: true },
      ],
      music: { duration: 8, bpm: 112, beats: Array.from({ length: 20 }, (_, i) => i * 60 / 112) },
      targetDuration: 4,
      mood: "product",
      intent: { mustInclude: ["motorcycle"] },
      platform: "web",
      limits: { maxShots: 2 },
    });
    expect(plan.status).toBe("needs-more-footage");
    expect(plan.warnings.some((warning) => warning.includes("required subject"))).toBe(true);
  });

  it("infers devotional mood from explicit local vision tags", () => {
    const result = inferAutonomousMood([
      { ...shots[0], tags: ["temple", "prayer", "devotional"] },
      { ...shots[1], tags: ["bhajan"] },
    ]);
    expect(result.mood).toBe("devotional");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("creates a continuous, unique, explainable edit plan with a hook and ending", () => {
    const plan = createAutonomousReelPlan({
      shots,
      music: { duration: 16, bpm: 112, beats: Array.from({ length: 30 }, (_, i) => i * 60 / 112), drops: [4, 9] },
      targetDuration: 12,
      aspect: "9:16",
      mood: "product",
      platform: "web",
      intensity: "balanced",
    });
    expect(plan.shots.length).toBeGreaterThan(1);
    expect(plan.shots[0].role).toBe("hook");
    expect(plan.shots.at(-1)?.role).toBe("ending");
    expect(validateAutonomousReelPlan(plan)).toEqual([]);
    expect(plan.decisions.length).toBeGreaterThan(0);
  });
});

describe("renderer-aware editor tool availability", () => {
  it("does not advertise planned or Studio-only tools in a standalone Android renderer", () => {
    const tools = getEditorTools({}, {
      platform: "android",
      studioSession: false,
      media3: true,
      webgl: false,
      webcodecs: false,
      analysis: false,
    });
    const ids = tools.map((tool) => tool.id);
    expect(ids).toContain("trim");
    expect(ids).toContain("keyframes-transform");
    expect(ids).not.toContain("speed-ramp");
    expect(ids).not.toContain("person-segmentation");
    expect(ids).not.toContain("freeze-frame");
  });

  it("exposes Studio-session tools only when the held Studio renderer is available", () => {
    const tools = getEditorTools({}, {
      platform: "web",
      studioSession: true,
      media3: false,
      webgl: true,
      webcodecs: true,
      analysis: true,
    });
    const ids = tools.map((tool) => tool.id);
    expect(ids).toContain("speed-ramp");
    expect(ids).toContain("blend-modes");
    expect(ids).not.toContain("freeze-frame");
  });
});
