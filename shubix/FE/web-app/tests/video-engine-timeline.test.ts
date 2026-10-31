import { describe, expect, it } from "vitest";
import { buildSpeedRampSegments, evaluateMotionPath, evaluateSpeedRamp, recordEdit, rippleDelete, rippleInsert, slipClip, stepEditHistory, type TimelineRange } from "../../../Shared/video-engine/src/index";
import { clipDuration } from "../../../Shared/validations/src/editor";

type Clip = TimelineRange & { label: string };

describe("shared timeline slip editing", () => {
  it("preserves the selected source window and playback-rate mapping", () => {
    const clip: Clip = {
      id: "clip-1",
      label: "slow-motion",
      start: 6,
      duration: 4,
      sourceStart: 10,
      sourceEnd: 18,
    };

    const slipped = slipClip(clip, 3, 30);

    expect(slipped).toEqual({
      ...clip,
      sourceStart: 13,
      sourceEnd: 21,
    });
    expect((slipped.sourceEnd! - slipped.sourceStart!) / slipped.duration).toBe(2);
    expect(slipped.start).toBe(clip.start);
    expect(slipped.duration).toBe(clip.duration);
  });

  it("clamps the whole source window at the end of the original media", () => {
    const clip: Clip = {
      id: "clip-2",
      label: "trimmed",
      start: 2,
      duration: 4,
      sourceStart: 15,
      sourceEnd: 19,
    };

    const slipped = slipClip(clip, 20, 20);

    expect(slipped.sourceStart).toBe(16);
    expect(slipped.sourceEnd).toBe(20);
  });

  it("uses timeline duration when a source end is not recorded", () => {
    const clip: Clip = {
      id: "clip-3",
      label: "ordinary",
      start: 0,
      duration: 3,
      sourceStart: 5,
    };

    const slipped = slipClip(clip, -2, 12);

    expect(slipped.sourceStart).toBe(3);
    expect(slipped.sourceEnd).toBe(6);
  });

  it("ignores a non-finite slip offset without changing the source window", () => {
    const clip: Clip = {
      id: "clip-4",
      label: "unchanged",
      start: 1,
      duration: 5,
      sourceStart: 2,
      sourceEnd: 12,
    };

    const slipped = slipClip(clip, Number.NaN, 20);

    expect(slipped.sourceStart).toBe(2);
    expect(slipped.sourceEnd).toBe(12);
  });
});


describe("shared timeline ripple editing", () => {
  const clip: Clip = {
    id: "main",
    label: "variable-rate",
    start: 0,
    duration: 10,
    sourceStart: 10,
    sourceEnd: 30,
  };

  it("splits a clip on ripple delete and preserves source-time mapping", () => {
    const result = rippleDelete([clip], 3, 7);

    expect(result.removedDuration).toBe(4);
    expect(result.clips).toHaveLength(2);
    expect(result.clips[0]).toMatchObject({
      id: "main", start: 0, duration: 3, sourceStart: 10, sourceEnd: 16,
    });
    expect(result.clips[1]).toMatchObject({
      id: "main:ripple-right", start: 3, duration: 3, sourceStart: 24, sourceEnd: 30,
    });
  });

  it("shifts clips after a ripple delete by the selected range length", () => {
    const later = { ...clip, id: "later", start: 12, duration: 2, sourceStart: 4, sourceEnd: 6 };
    const result = rippleDelete([clip, later], 2, 5);

    expect(result.clips.find((item) => item.id === "later")?.start).toBe(9);
  });

  it("inserts a gap through a clip without changing its source playback rate", () => {
    const result = rippleInsert([clip], 3, 2);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "main", start: 0, duration: 3, sourceStart: 10, sourceEnd: 16,
    });
    expect(result[1]).toMatchObject({
      id: "main:insert-right", start: 5, duration: 7, sourceStart: 16, sourceEnd: 30,
    });
    expect((result[1].sourceEnd! - result[1].sourceStart!) / result[1].duration).toBe(2);
  });

  it("treats non-finite edit boundaries as safe no-op boundaries", () => {
    expect(rippleDelete([clip], Number.NaN, Number.POSITIVE_INFINITY).clips).toEqual([clip]);
    expect(rippleInsert([clip], Number.NaN, Number.NaN)).toEqual([clip]);
  });

  it("does not retain zero-length clips after a ripple operation", () => {
    const empty = { ...clip, id: "empty", duration: 0 };
    expect(rippleDelete([clip, empty], 2, 4).clips.some((item) => item.id === "empty")).toBe(false);
    expect(rippleInsert([clip, empty], 2, 1).some((item) => item.id === "empty")).toBe(false);
  });
});


describe("shared motion and speed-ramp evaluation", () => {
  it("applies the outgoing motion-path point easing to its segment", () => {
    const points = [
      { time: 0, x: 0, y: 0, easing: "ease-in" as const, outHandle: [1 / 3, 1 / 3] as [number, number] },
      { time: 1, x: 1, y: 1, inHandle: [-1 / 3, -1 / 3] as [number, number] },
    ];

    expect(evaluateMotionPath(points, 0.5).x).toBeCloseTo(0.25, 3);
    expect(evaluateMotionPath(points, 0.5).y).toBeCloseTo(0.25, 3);
  });

  it("keeps speed ramp evaluation within safe playback limits", () => {
    expect(evaluateSpeedRamp([
      { time: 0, speed: 0.1 },
      { time: 5, speed: 8 },
    ], 0, 5)).toBe(0.25);
    expect(evaluateSpeedRamp([
      { time: 0, speed: 0.1 },
      { time: 5, speed: 8 },
    ], 5, 5)).toBe(4);
  });

  it("keeps the clip's own speed before the first keyframe, as the native renderer does", () => {
    const ramp = [{ time: 5, speed: 2 }];
    expect(evaluateSpeedRamp(ramp, 0, 10, 1)).toBe(1);
    expect(evaluateSpeedRamp(ramp, 7, 10, 1)).toBe(2);
    expect(clipDuration({ start: 0, end: 10, speed: 1, speedRamp: ramp })).toBeCloseTo(5.97, 1);
    expect(buildSpeedRampSegments(ramp, 10, { fallbackSpeed: 1, maxSegmentDuration: 0.2 }).at(-1)!.outputEnd).toBeCloseTo(5.97, 1);
  });

  it("builds ordered speed-ramp segments with continuous output timestamps", () => {
    const segments = buildSpeedRampSegments([
      { time: 0, speed: 1 },
      { time: 2, speed: 2 },
      { time: 4, speed: 0.5 },
    ], 4, { maxSegmentDuration: 0.5 });

    expect(segments.length).toBeGreaterThan(2);
    expect(segments[0].sourceStart).toBe(0);
    expect(segments[segments.length - 1].sourceEnd).toBe(4);
    for (let index = 1; index < segments.length; index++) {
      expect(segments[index].sourceStart).toBeCloseTo(segments[index - 1].sourceEnd, 6);
      expect(segments[index].outputStart).toBeCloseTo(segments[index - 1].outputEnd, 6);
    }
    expect(segments.every((segment) => segment.speed >= 0.25 && segment.speed <= 4)).toBe(true);
  });
});


describe("shared edit history", () => {
  it("undoes the latest snapshot and keeps the current state for redo", () => {
    const undo = recordEdit(["initial"], "edited", 30);
    const step = stepEditHistory(undo.undo, undo.redo, "latest", "undo", 30);
    expect(step).toEqual({ undo: ["initial"], redo: ["latest"], current: "edited" });
  });

  it("redoes an undone snapshot and restores the undo stack", () => {
    const step = stepEditHistory(["before"], ["after"], "undone", "redo", 30);
    expect(step).toEqual({ undo: ["before", "undone"], redo: [], current: "after" });
  });

  it("bounds history and clears redo when a new edit is recorded", () => {
    const recorded = recordEdit([1, 2, 3], 4, 3);
    expect(recorded).toEqual({ undo: [2, 3, 4], redo: [] });
  });

  it("returns no step when the requested history direction is empty", () => {
    expect(stepEditHistory([], [], "current", "undo")).toBeNull();
    expect(stepEditHistory([], [], "current", "redo")).toBeNull();
  });
});
