import { describe, expect, it } from "vitest";
import { PREVIEW_BITRATE, PREVIEW_MAX_SIDE, previewProxyPlan } from "@/lib/previewProxy";

const MB = 1024 * 1024;

describe("browser editor preview proxies", () => {
  it("downscales 4K portrait and landscape footage for preview", () => {
    expect(previewProxyPlan({ size: 300 * MB, width: 2160, height: 3840, duration: 60 })).toMatchObject({
      width: 720, height: 1280, bitrate: PREVIEW_BITRATE, reason: "resolution",
    });
    expect(previewProxyPlan({ size: 300 * MB, width: 3840, height: 2160, duration: 60 })).toMatchObject({
      width: 1280, height: 720, bitrate: PREVIEW_BITRATE, reason: "resolution",
    });
    expect(PREVIEW_MAX_SIDE).toBe(1280);
  });

  it("re-encodes high-bitrate 1080p footage without changing its dimensions", () => {
    expect(previewProxyPlan({ size: 180 * MB, width: 1080, height: 1920, duration: 60 })).toMatchObject({
      width: 1080, height: 1920, reason: "bitrate",
    });
  });

  it("does not proxy ordinary footage or small clips", () => {
    expect(previewProxyPlan({ size: 40 * MB, width: 1080, height: 1920, duration: 60 })).toBeNull();
    expect(previewProxyPlan({ size: 12 * MB, width: 3840, height: 2160, duration: 30 })).toBeNull();
  });

  it("fails safely for invalid metadata and proxy jobs that exceed memory limits", () => {
    expect(previewProxyPlan({ size: 200 * MB, width: 3840, height: 2160, duration: 0 })).toBeNull();
    expect(previewProxyPlan({ size: 800 * MB, width: 3840, height: 2160, duration: 60 })).toBeNull();
    expect(previewProxyPlan({ size: 200 * MB, width: Number.NaN, height: 2160, duration: 60 })).toBeNull();
  });
});
