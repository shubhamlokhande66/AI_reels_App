import { describe, expect, it } from "vitest";
import { PREVIEW_BITRATE, PREVIEW_MAX_SIDE, previewProxyPlan } from "@/lib/previewProxy";

const MB = 1024 * 1024;

describe("browser editor preview proxies", () => {
  it("downscales 4K portrait and landscape footage for preview", () => {
    expect(previewProxyPlan({ size: 300 * MB, width: 2160, height: 3840, duration: 60 })).toMatchObject({
      width: 540, height: 960, bitrate: PREVIEW_BITRATE, reason: "resolution",
    });
    expect(previewProxyPlan({ size: 300 * MB, width: 3840, height: 2160, duration: 60 })).toMatchObject({
      width: 960, height: 540, bitrate: PREVIEW_BITRATE, reason: "resolution",
    });
    expect(PREVIEW_MAX_SIDE).toBe(960);
  });

  it("re-encodes high-bitrate footage without changing already-small dimensions", () => {
    expect(previewProxyPlan({ size: 180 * MB, width: 960, height: 540, duration: 60 })).toMatchObject({
      width: 960, height: 540, reason: "bitrate",
    });
  });

  it("proxies long, high-resolution phone footage even when its average bitrate is modest", () => {
    expect(previewProxyPlan({ size: 20 * MB, width: 1080, height: 1920, duration: 120 }, true)).toMatchObject({
      width: 540, height: 960, reason: "resolution-and-bitrate",
    });
  });

  it("does not proxy small clips or footage already within preview limits", () => {
    expect(previewProxyPlan({ size: 12 * MB, width: 3840, height: 2160, duration: 30 })).toBeNull();
    expect(previewProxyPlan({ size: 15 * MB, width: 960, height: 540, duration: 60 })).toBeNull();
  });

  it("fails safely for invalid metadata and proxy jobs that exceed memory limits", () => {
    expect(previewProxyPlan({ size: 200 * MB, width: 3840, height: 2160, duration: 0 })).toBeNull();
    expect(previewProxyPlan({ size: 800 * MB, width: 3840, height: 2160, duration: 60 })).toBeNull();
    expect(previewProxyPlan({ size: 200 * MB, width: Number.NaN, height: 2160, duration: 60 })).toBeNull();
  });
});
