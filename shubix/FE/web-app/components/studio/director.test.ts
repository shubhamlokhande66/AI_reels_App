import { describe, expect, it } from "vitest";
import { createDirectorPlan, createAutonomousReelPlan, validateAutonomousReelPlan, assessAutonomousRenderQuality, evaluateKeyframes, evaluateTransformKeyframes, cubicBezierProgress, normaliseKeyframes, upsertKeyframe, shiftKeyframes, evaluateAudioGain, EFFECT_LIBRARY, TRANSITION_LIBRARY } from "@shubix/video-engine";

describe("shared video director", () => {
  it("interpolates keyframes and honours hold segments", () => {
    const frames = [
      { id: "a", time: 0, value: 0, easing: "linear" as const },
      { id: "b", time: 2, value: 10, easing: "hold" as const },
      { id: "c", time: 4, value: 20, easing: "hold" as const },
    ];
    expect(evaluateKeyframes(frames, 1)).toBe(5);
    expect(evaluateKeyframes(frames, 3)).toBe(10);
    expect(evaluateKeyframes(frames, 8)).toBe(20);
  });

  it("supports cubic-bezier easing and safe keyframe editing utilities", () => {
    const linear = cubicBezierProgress(0.5, [0, 0, 1, 1]);
    expect(linear).toBeCloseTo(0.5, 2);
    const ease = evaluateKeyframes([
      { id: "a", time: 0, value: 0, easing: "linear" },
      { id: "b", time: 1, value: 10, easing: "bezier", bezier: [0.25, 0.1, 0.25, 1] },
    ], 0.5);
    expect(ease).toBeGreaterThan(5);
    const frames = normaliseKeyframes([
      { id: "a", time: 1, value: 1, easing: "linear" },
      { id: "b", time: 0, value: 0, easing: "linear" },
      { id: "c", time: 1, value: 2, easing: "linear" },
    ]);
    expect(frames.map((frame) => frame.time)).toEqual([0, 1]);
    expect(frames[1].value).toBe(2);
    expect(upsertKeyframe(frames, { id: "d", time: 1, value: 3, easing: "linear" })[1].value).toBe(3);
    expect(shiftKeyframes(frames, -2).map((frame) => frame.time)).toEqual([0, 1]);
  });

  it("evaluates Studio transform keyframes with the shared easing model", () => {
    const value = evaluateTransformKeyframes([
      { t: 0, x: 0, y: 0, s: 1, r: 0, o: 1, ez: "inOut" },
      { t: 2, x: 0.1, y: -0.1, s: 1.2, r: 12, o: 0.5, ez: "outCubic" },
    ], 2);
    expect(value.x).toBeCloseTo(0.1);
    expect(value.s).toBeCloseTo(1.2);
    expect(value.o).toBeCloseTo(0.5);
  });

  it("evaluates music volume and fade envelopes consistently at the playhead", () => {
    const envelope = { volume: 0.8, duration: 10, fadeIn: 2, fadeOut: 4 };
    expect(evaluateAudioGain(0, envelope)).toBe(0);
    expect(evaluateAudioGain(1, envelope)).toBeCloseTo(0.4);
    expect(evaluateAudioGain(5, envelope)).toBeCloseTo(0.8);
    expect(evaluateAudioGain(8, envelope)).toBeCloseTo(0.4);
    expect(evaluateAudioGain(10, envelope)).toBe(0);
    expect(evaluateAudioGain(5, { volume: 2, duration: 10 })).toBe(1);
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

  it("keeps quiet sections restrained and protects speech in story edits", () => {
    const plan = createDirectorPlan({
      targetDuration: 6, mood: "story", beats: [0, 2, 4, 6], drops: [2],
      quietRanges: [[0, 6]],
      shots: [
        { id: "voice", sourceIndex: 0, duration: 3, quality: 0.8, motion: 0.2, speech: true },
        { id: "hero", sourceIndex: 1, duration: 3, quality: 0.95, motion: 0.9, isHighlight: true },
      ],
    });
    const voice = plan.shots.find((shot) => shot.sourceId === "voice");
    expect(plan.shots.some((shot) => shot.role === "hook")).toBe(true);
    expect(plan.shots.some((shot) => shot.role === "ending")).toBe(true);
    expect(voice?.effects).not.toContain("zoomburst");
    expect(voice?.reason).toContain("spoken");
    expect(plan.shots.every((shot) => shot.transition !== "flash")).toBe(true);
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


describe("autonomous AI reel director", () => {
  const shots = [
    { id: "opening", sourceIndex: 0, duration: 3, sourceStart: 0, sourceEnd: 3, quality: 0.98, motion: 0.8, aestheticScore: 0.95, stabilityScore: 0.9, exposureScore: 0.9, isOpening: true, isHighlight: true, sceneId: "street" },
    { id: "detail", sourceIndex: 1, duration: 3, sourceStart: 1, sourceEnd: 4, quality: 0.82, motion: 0.35, aestheticScore: 0.9, isDetail: true, isProduct: true, sceneId: "table" },
    { id: "reaction", sourceIndex: 2, duration: 3, sourceStart: 0, sourceEnd: 3, quality: 0.86, motion: 0.45, faceScore: 0.95, isReaction: true, speech: true, sceneId: "people" },
    { id: "ending", sourceIndex: 3, duration: 3, sourceStart: 2, sourceEnd: 5, quality: 0.9, motion: 0.5, isEnding: true, isHighlight: true, sceneId: "street" },
  ];
  const music = { duration: 12, bpm: 120, beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5], downbeats: [0, 2, 4, 6, 8, 10], drops: [4, 8], quietRanges: [[9, 10] as [number, number]] };

  it("builds a complete non-repeating edit with a hook, story roles, beat points and an ending", () => {
    const plan = createAutonomousReelPlan({ shots, music, targetDuration: 9, mood: "wedding", platform: "android" });
    expect(plan.shots[0].sourceId).toBe("opening");
    expect(plan.shots[plan.shots.length - 1]?.sourceId).toBe("ending");
    expect(plan.shots.some((shot) => shot.role === "reaction")).toBe(true);
    expect(new Set(plan.shots.map((shot) => shot.sourceId)).size).toBe(plan.shots.length);
    expect(plan.soundtrack.beatSync).toBe(true);
    expect(plan.captions.suggested).toBe(true);
    expect(validateAutonomousReelPlan(plan)).toEqual([]);
  });

  it("uses safe mobile effects and explains missing audio analysis", () => {
    const plan = createAutonomousReelPlan({ shots, targetDuration: 7, mood: "cinematic", platform: "android" });
    expect(plan.status).toBe("audio-missing");
    expect(plan.warnings.some((warning) => warning.includes("Music analysis is missing"))).toBe(true);
    for (const id of plan.shots.flatMap((shot) => shot.effects)) {
      expect(EFFECT_LIBRARY.find((effect) => effect.id === id)?.mobileSafe).toBe(true);
    }
    expect(validateAutonomousReelPlan(plan)).toEqual([]);
  });

  it("returns a safe empty plan when no usable footage exists", () => {
    const plan = createAutonomousReelPlan({ shots: [], music, targetDuration: 10 });
    expect(plan.status).toBe("needs-more-footage");
    expect(plan.duration).toBe(0);
    expect(validateAutonomousReelPlan(plan)).toEqual([]);
  });

  it("rejects corrupted timelines and unregistered renderer operations", () => {
    const plan = createAutonomousReelPlan({ shots, music, targetDuration: 8 });
    plan.shots[0].transition = "invented-transition";
    expect(validateAutonomousReelPlan(plan)).toContain("A transition is not in the shared registry.");
  });
});


describe("autonomous render quality gate", () => {
  it("passes a valid render with clean video and audio measurements", () => {
    const result = assessAutonomousRenderQuality({
      expectedDuration: 15, actualDuration: 15.02, width: 1080, height: 1920, fps: 30,
      frames: Array.from({ length: 20 }, (_, index) => ({ time: index * 0.75, hasFrame: true, blackRatio: 0.01, blurScore: 0.4, duplicateDistance: 0.2 })),
      audio: { peakDbfs: -1, clippedRatio: 0, silenceRatio: 0.02, integratedLufs: -14 },
    });
    expect(result.status).toBe("pass");
    expect(result.score).toBe(100);
    expect(result.repairs).toEqual([]);
  });

  it("fails black frames, duration mismatch and clipping with actionable repair hints", () => {
    const result = assessAutonomousRenderQuality({
      expectedDuration: 20, actualDuration: 12, width: 1080, height: 1920, fps: 30,
      frames: Array.from({ length: 10 }, (_, index) => ({ time: index, hasFrame: true, blackRatio: index < 3 ? 1 : 0, blurScore: 0.5, duplicateDistance: 0.2 })),
      audio: { peakDbfs: 0, clippedRatio: 0.02, silenceRatio: 0 },
    });
    expect(result.status).toBe("fail");
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.repairs).toContain("fix-duration");
    expect(result.repairs).toContain("remove-black-segment");
    expect(result.repairs).toContain("reduce-clipping");
  });

  it("warns when audio is missing and many frames are blurry or duplicated", () => {
    const result = assessAutonomousRenderQuality({
      expectedDuration: 10, actualDuration: 10, width: 1080, height: 1920, fps: 30,
      frames: Array.from({ length: 10 }, (_, index) => ({ time: index, hasFrame: true, blackRatio: 0, blurScore: 0.01, duplicateDistance: 0.001 })),
    });
    expect(result.status).toBe("warn");
    expect(result.repairs).toContain("replace-blurry-shot");
    expect(result.repairs).toContain("reduce-duplicate-shots");
    expect(result.warnings).toContain("Audio quality was not measured.");
  });
});
