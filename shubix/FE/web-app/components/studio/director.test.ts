import { describe, expect, it } from "vitest";
import { clipDuration, clipSchema, makeClip, splitClip } from "@shubix/validations";
import { cubicBezierProgress as sharedCubicBezierProgress, sampleKeyframes, validateRenderJob } from "@shubix/core/engine/rendering";
import { createDirectorPlan, createAutonomousReelPlan, validateAutonomousReelPlan, assessAutonomousRenderQuality, inferAutonomousMood, evaluateKeyframes, evaluateTransformKeyframes, cubicBezierProgress, normaliseKeyframes, upsertKeyframe, shiftKeyframes, evaluateAudioGain, normaliseSpeedRamp, evaluateSpeedRamp, buildSpeedRampSegments, rippleDelete, rippleInsert, slipClip, evaluateMotionPath, buildDuckingEnvelope, EFFECT_LIBRARY, TRANSITION_LIBRARY } from "@shubix/video-engine";

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


describe("autonomous content understanding", () => {
  it("infers product style from product footage without requiring a user prompt", () => {
    const inference = inferAutonomousMood([
      { id: "p1", sourceIndex: 0, duration: 3, quality: 0.9, motion: 0.4, isProduct: true },
      { id: "p2", sourceIndex: 1, duration: 3, quality: 0.8, motion: 0.3, isProduct: true, tags: ["showcase"] },
    ], { duration: 6, mood: "calm" });
    expect(inference.mood).toBe("product");
    expect(inference.confidence).toBeGreaterThan(0.5);
  });

  it("infers a speech-led edit and lets the autonomous planner use inferred mood by default", () => {
    const speechShots = [
      { id: "s1", sourceIndex: 0, duration: 4, quality: 0.8, motion: 0.2, speech: true, tags: ["tutorial"] },
      { id: "s2", sourceIndex: 1, duration: 4, quality: 0.8, motion: 0.2, speech: true },
    ];
    expect(inferAutonomousMood(speechShots).mood).toBe("talking");
    expect(createAutonomousReelPlan({ shots: speechShots, targetDuration: 6 }).mood).toBe("talking");
  });
});


describe("speed ramp curves", () => {
  it("normalises invalid points, clamps playback rates and adds timeline boundaries", () => {
    const points = normaliseSpeedRamp([
      { time: 3, speed: 8 },
      { time: 1, speed: 0.01 },
      { time: 1, speed: 1.5 },
      { time: Number.NaN, speed: 2 },
    ], 4);
    expect(points[0]).toEqual({ time: 0, speed: 1.5 });
    expect(points[1]).toEqual({ time: 1, speed: 1.5 });
    expect(points[2]).toEqual({ time: 3, speed: 4 });
    expect(points[3]).toEqual({ time: 4, speed: 4 });
  });

  it("evaluates smooth playback-rate changes with the shared easing model", () => {
    const points = [
      { time: 0, speed: 0.5, easing: "linear" as const },
      { time: 4, speed: 2, easing: "linear" as const },
    ];
    expect(evaluateSpeedRamp(points, 0, 4)).toBeCloseTo(0.5);
    expect(evaluateSpeedRamp(points, 2, 4)).toBeCloseTo(1.25);
    expect(evaluateSpeedRamp(points, 4, 4)).toBeCloseTo(2);
  });

  it("builds ordered constant-rate render slices with speed-adjusted output timestamps", () => {
    const segments = buildSpeedRampSegments([
      { time: 0, speed: 1, easing: "linear" },
      { time: 2, speed: 2, easing: "linear" },
    ], 2, { maxSegmentDuration: 0.5 });
    expect(segments).toHaveLength(4);
    expect(segments[0].sourceStart).toBe(0);
    expect(segments[3].sourceEnd).toBe(2);
    expect(segments[0].outputStart).toBe(0);
    for (let index = 1; index < segments.length; index++) {
      expect(segments[index].sourceStart).toBeCloseTo(segments[index - 1].sourceEnd);
      expect(segments[index].outputStart).toBeCloseTo(segments[index - 1].outputEnd);
    }
    expect(segments.every((segment) => segment.speed >= 0.25 && segment.speed <= 4)).toBe(true);
    expect(segments[3].outputEnd).toBeLessThan(2);
  });

  it("keeps the full source range when a dense speed ramp hits the segment cap", () => {
    const points = Array.from({ length: 180 }, (_, index) => ({
      time: index * 0.1,
      speed: index % 2 ? 2 : 0.5,
      easing: "linear" as const,
    }));
    const duration = 18;
    const segments = buildSpeedRampSegments(points, duration, { maxSegmentDuration: 0.04, maxSegments: 1200 });
    expect(segments.length).toBeLessThanOrEqual(1200);
    expect(segments[0].sourceStart).toBe(0);
    expect(segments[segments.length - 1].sourceEnd).toBeCloseTo(duration);
    for (let index = 1; index < segments.length; index++) {
      expect(segments[index].sourceStart).toBeCloseTo(segments[index - 1].sourceEnd);
      expect(segments[index].outputStart).toBeCloseTo(segments[index - 1].outputEnd);
    }
  });

  it("uses a safe constant-rate fallback when no curve points are supplied", () => {
    const segments = buildSpeedRampSegments([], 3, { fallbackSpeed: 1.5, maxSegmentDuration: 1 });
    expect(segments.length).toBe(3);
    expect(segments.every((segment) => segment.speed === 1.5)).toBe(true);
    expect(segments[segments.length - 1].outputEnd).toBeCloseTo(2);
  });
});

describe("speed ramp project compatibility", () => {
  it("keeps saved clips without speed curves valid", () => {
    const clip = makeClip({ uri: "file:///legacy.mp4", duration: 8 }, "legacy");
    expect(clipSchema.safeParse(clip).success).toBe(true);
    expect(clipDuration(clip)).toBe(8);
  });

  it("validates and integrates a per-clip speed ramp", () => {
    const clip = makeClip({ uri: "file:///ramp.mp4", duration: 8 }, "ramp");
    const ramped = { ...clip, speedRamp: [
      { time: 0, speed: 1 },
      { time: 4, speed: 2, easing: "linear" as const },
      { time: 8, speed: 1 },
    ] };
    expect(clipSchema.safeParse(ramped).success).toBe(true);
    expect(clipDuration(ramped)).toBeGreaterThan(5.4);
    expect(clipDuration(ramped)).toBeLessThan(5.6);
  });

  it("rejects out-of-range speed curve values", () => {
    const clip = makeClip({ uri: "file:///invalid.mp4", duration: 4 }, "invalid");
    expect(clipSchema.safeParse({ ...clip, speedRamp: [{ time: 0, speed: 8 }] }).success).toBe(false);
  });

  it("splits a ramped clip into two curves with matching speed at the cut", () => {
    const clip = { ...makeClip({ uri: "file:///split.mp4", duration: 8 }, "split"), speedRamp: [
      { time: 0, speed: 0.5 }, { time: 4, speed: 2, easing: "outCubic" as const }, { time: 8, speed: 1 },
    ] };
    const split = splitClip(clip, "split-right");
    expect(split).not.toBeNull();
    const [left, right] = split!;
    expect(left.speedRamp?.[left.speedRamp.length - 1].time).toBeCloseTo(4);
    expect(right.speedRamp?.[0].time).toBe(0);
    expect(right.speedRamp?.[0].speed).toBeCloseTo(left.speedRamp?.[left.speedRamp.length - 1].speed ?? 0, 3);
    expect(clipSchema.safeParse(left).success).toBe(true);
    expect(clipSchema.safeParse(right).success).toBe(true);
  });
});


describe("advanced shared timeline and motion primitives", () => {
  const clips = [
    { id: "a", start: 0, duration: 10, sourceStart: 0, sourceEnd: 10 },
    { id: "b", start: 10, duration: 4, sourceStart: 2, sourceEnd: 6 },
  ];

  it("ripple-deletes a range, splits crossing media and closes the gap", () => {
    const result = rippleDelete(clips, 3, 5);
    expect(result.removedDuration).toBe(2);
    expect(result.clips).toHaveLength(3);
    expect(result.clips[0]).toMatchObject({ id: "a", start: 0, duration: 3, sourceStart: 0, sourceEnd: 3 });
    expect(result.clips[1]).toMatchObject({ id: "a:ripple-right", start: 3, duration: 5, sourceStart: 5, sourceEnd: 10 });
    expect(result.clips[2]).toMatchObject({ id: "b", start: 8, duration: 4 });
  });

  it("ripple-inserts a gap and preserves source ranges on both sides", () => {
    const result = rippleInsert(clips, 3, 2);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: "a", start: 0, duration: 3, sourceEnd: 3 });
    expect(result[1]).toMatchObject({ id: "a:insert-right", start: 5, duration: 7, sourceStart: 3, sourceEnd: 10 });
    expect(result[2]).toMatchObject({ id: "b", start: 12 });
  });

  it("slips source media without moving the timeline clip", () => {
    const result = slipClip({ id: "x", start: 7, duration: 3, sourceStart: 5, sourceEnd: 8 }, 2, 20);
    expect(result).toMatchObject({ start: 7, duration: 3, sourceStart: 7, sourceEnd: 10 });
  });

  it("evaluates cubic motion paths and clamps to endpoint positions", () => {
    const path = [
      { time: 0, x: 0, y: 0, outHandle: [0.2, 0] as [number, number] },
      { time: 2, x: 1, y: 1, inHandle: [-0.2, 0] as [number, number] },
    ];
    expect(evaluateMotionPath(path, -1)).toEqual({ x: 0, y: 0 });
    expect(evaluateMotionPath(path, 2)).toEqual({ x: 1, y: 1 });
    const middle = evaluateMotionPath(path, 1);
    expect(middle.x).toBeCloseTo(0.5, 1);
    expect(middle.y).toBeCloseTo(0.5, 1);
  });

  it("creates a bounded speech ducking envelope with smooth attack and release", () => {
    const envelope = buildDuckingEnvelope([{ start: 1, end: 2 }], 3, { duckLevel: 0.25, attack: 0.1, release: 0.2 });
    const at = (time: number) => envelope.find((point) => Math.abs(point.time - time) < 0.0001)?.gain;
    expect(at(0)).toBe(1);
    expect(at(1.1)).toBeCloseTo(0.25);
    expect(at(1.5)).toBeCloseTo(0.25);
    expect(at(2)).toBeCloseTo(0.25);
    expect(at(2.2)).toBeCloseTo(1);
  });
});


describe("shared render transition and effect validation", () => {
  const base = {
    version: 1 as const,
    dimensions: { width: 1080, height: 1920, fps: 30 },
    sources: [{ id: "clip", uri: "file:///clip.mp4", kind: "video" as const, durationMs: 5000 }],
    items: [{
      id: "item", sourceId: "clip", timelineStartMs: 0, sourceStartMs: 0,
      durationMs: 5000, playbackRate: 1, fit: "cover" as const,
      transitionIn: { type: "fade", durationMs: 250 },
      effects: [{ type: "blurpulse", intensity: 0.5, params: {} }],
    }],
    output: { container: "mp4" as const, videoCodec: "h264" as const, audioCodec: "aac" as const, quality: "high" as const },
  };

  it("accepts a bounded fade transition and a typed GPU effect", () => {
    expect(validateRenderJob(base)).toEqual([]);
  });

  it("rejects a transition longer than its clip", () => {
    const invalid = { ...base, items: [{ ...base.items[0], transitionIn: { type: "fade", durationMs: 6000 } }] };
    expect(validateRenderJob(invalid)).toContain("Timeline item item has an invalid transition duration.");

  it("rejects unregistered transition names", () => {
    const invalid = { ...base, items: [{ ...base.items[0], transitionIn: { type: "made-up", durationMs: 250 } }] };
    expect(validateRenderJob(invalid)).toContain("Timeline item item has an unknown transition type.");
  });

  it("requires at least three points for polygon masks", () => {
    const invalid = { ...base, items: [{ ...base.items[0], transitionIn: undefined, mask: { type: "polygon" as const, x: 0, y: 0, width: 1, height: 1, points: [{ x: 0, y: 0 }] } }] };
    expect(validateRenderJob(invalid)).toContain("Timeline item item polygon mask requires at least three points.");
  });
  });
});

describe("shared renderer keyframe sampling", () => {
  it("uses cubic Bezier timing controls rather than linear interpolation", () => {
    const linear = sampleKeyframes([
      { timeMs: 0, value: 0, bezier: [0, 0, 1, 1] },
      { timeMs: 1000, value: 100 },
    ], 500);
    const eased = sampleKeyframes([
      { timeMs: 0, value: 0, bezier: [0.25, 0.1, 0.25, 1] },
      { timeMs: 1000, value: 100 },
    ], 500);
    expect(linear).toBeCloseTo(50, 1);
    expect(eased).toBeGreaterThan(50);
    expect(sharedCubicBezierProgress(0, [0.25, 0.1, 0.25, 1])).toBeCloseTo(0, 4);
    expect(sharedCubicBezierProgress(1, [0.25, 0.1, 0.25, 1])).toBeCloseTo(1, 4);
  });
});

describe("shared render audio contract", () => {
  const job = {
    version: 1 as const,
    dimensions: { width: 1080, height: 1920, fps: 30 },
    sources: [{ id: "clip", uri: "file:///clip.mp4", kind: "video" as const, durationMs: 5000 }],
    items: [{ id: "item", sourceId: "clip", timelineStartMs: 0, sourceStartMs: 0, durationMs: 5000, playbackRate: 1, fit: "cover" as const }],
    audio: [{
      source: "file:///music.m4a", startMs: 0, durationMs: 5000, sourceStartMs: 1200,
      volume: 0.7, fadeInMs: 1000, fadeOutMs: 800, ducking: true, duckLevel: 0.3,
    }],
    output: { container: "mp4" as const, videoCodec: "h264" as const, audioCodec: "aac" as const, quality: "high" as const },
  };

  it("accepts music gain, fades and speech-ducking settings", () => {
    expect(validateRenderJob(job)).toEqual([]);
  });

  it("rejects invalid fade and ducking ranges before renderer dispatch", () => {
    const invalid = {
      ...job,
      audio: [{ ...job.audio[0], fadeInMs: -1, duckLevel: 1.5 }],
    };
    expect(validateRenderJob(invalid)).toEqual(expect.arrayContaining([
      "Audio fade-in must be between 0 and 10000ms.",
      "Audio duck level must be between 0 and 1.",
    ]));
  });
});
