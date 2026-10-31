import { describe, expect, it } from "vitest";
import { validateRenderJob, type RenderJobSpec } from "../../../Shared/core/src/engine/rendering/renderer";
import { createAndroidRendererAdapter } from "../../mobile-app/lib/rendering/android-renderer.adapter";

const validJob = (): RenderJobSpec => ({
  version: 1,
  dimensions: { width: 1080, height: 1920, fps: 30 },
  sources: [{ id: "source-1", uri: "file:///clip.mp4", kind: "video", durationMs: 10000 }],
  items: [{
    id: "item-1",
    sourceId: "source-1",
    timelineStartMs: 0,
    sourceStartMs: 0,
    durationMs: 5000,
    playbackRate: 1,
    fit: "cover",
  }],
  output: { container: "mp4", videoCodec: "h264", audioCodec: "aac", quality: "high" },
});

describe("shared RenderJob validation", () => {
  it("accepts a valid cut-only render job", () => {
    expect(validateRenderJob(validJob())).toEqual([]);
  });

  it("rejects non-finite and out-of-order keyframes", () => {
    const job = validJob();
    job.items = [{
      ...job.items[0],
      keyframes: {
        x: [
          { timeMs: 0, value: 0 },
          { timeMs: 1000, value: Number.NaN },
          { timeMs: 900, value: 1 },
        ],
      },
    }];
    const errors = validateRenderJob(job);
    expect(errors).toContain("Timeline item item-1 has a non-finite keyframe value.");
    expect(errors).toContain("Timeline item item-1 keyframes for x must have strictly increasing times.");
  });

  it("rejects a malformed polygon mask", () => {
    const job = validJob();
    job.items = [{
      ...job.items[0],
      mask: { type: "polygon", x: 0, y: 0, width: 1, height: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    }];
    expect(validateRenderJob(job)).toContain("Timeline item item-1 polygon mask requires at least three points.");
  });

  it("rejects image masks without a valid source", () => {
    const job = validJob();
    job.items = [{
      ...job.items[0],
      mask: { type: "image", x: 0, y: 0, width: 1, height: 1, sourceId: "missing-mask" },
    }];
    expect(validateRenderJob(job)).toContain("Timeline item item-1 image mask references a missing source.");
  });

  it("rejects overlays that extend beyond the timeline", () => {
    const job = validJob();
    job.overlays = [{
      id: "title",
      text: "Welcome",
      startMs: 100,
      endMs: 6000,
      color: "#ffffff",
      size: 48,
    }];
    expect(validateRenderJob(job)).toContain("Text overlay title extends beyond the Reel duration.");
  });

  it("rejects invalid layer opacity, blend modes and source references", () => {
    const job = validJob();
    job.layers = [{
      id: "overlay-video",
      kind: "video",
      sourceId: "missing",
      startMs: 0,
      durationMs: 1000,
      zIndex: 2,
      opacity: 1.5,
      blendMode: "difference" as never,
    }];
    const errors = validateRenderJob(job);
    expect(errors).toContain("Layer overlay-video has invalid opacity.");
    expect(errors).toContain("Layer overlay-video has an unsupported blend mode.");
    expect(errors).toContain("Layer overlay-video references missing source missing.");
  });

  it("rejects an effect whose keyframes exceed the clip duration", () => {
    const job = validJob();
    job.items = [{
      ...job.items[0],
      effects: [{
        type: "blur",
        params: {},
        keyframes: { blur: [{ timeMs: 6000, value: 0.5 }] },
      }],
    }];
    expect(validateRenderJob(job)).toContain("Effect blur on item-1 has a keyframe outside its duration.");
  });
});


describe("Android renderer output contract", () => {
  const adapterFor = (
    createOutputPath: () => Promise<string>,
    exportResult: { uri: string; size: number; duration: number },
  ) => {
    let exportCalls = 0;
    const adapter = createAndroidRendererAdapter({
      nativeModule: {
        async exportReel() {
          exportCalls += 1;
          return exportResult;
        },
        async cancel() {},
        addListener() {
          return { remove() {} };
        },
      },
      createOutputPath,
      maxWorkingSetBytes: 64 * 1024 * 1024,
    });
    return { adapter, exportCalls: () => exportCalls };
  };

  it("rejects relative output paths before invoking native export", async () => {
    const { adapter, exportCalls } = adapterFor(
      async () => "exports/reel.mp4",
      { uri: "file:///exports/reel.mp4", size: 1024, duration: 5 },
    );
    await expect(adapter.render(validJob(), () => {})).rejects.toThrow(
      "Android export requires a non-empty absolute filesystem output path.",
    );
    expect(exportCalls()).toBe(0);
  });

  it("rejects native export results without a valid file URI", async () => {
    const { adapter } = adapterFor(
      async () => "/data/user/0/app/files/reel.mp4",
      { uri: " ", size: 1024, duration: 5 },
    );
    await expect(adapter.render(validJob(), () => {})).rejects.toThrow(
      "Android renderer returned an invalid output",
    );
  });

  it("rejects zero-byte or non-finite native export metadata", async () => {
    const { adapter } = adapterFor(
      async () => "/data/user/0/app/files/reel.mp4",
      { uri: "file:///data/user/0/app/files/reel.mp4", size: 0, duration: Number.NaN },
    );
    await expect(adapter.render(validJob(), () => {})).rejects.toThrow(
      "Android renderer returned an invalid output",
    );
  });
});
