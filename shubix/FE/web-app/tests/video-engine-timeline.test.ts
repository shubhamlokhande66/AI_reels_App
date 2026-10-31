import { describe, expect, it } from "vitest";
import { slipClip, type TimelineRange } from "../../../Shared/video-engine/src/index";

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
