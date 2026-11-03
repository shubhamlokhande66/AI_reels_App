import { describe, expect, it } from "vitest";
import { EDIT_BITRATE, editCopyPlan, isHeavySource, variesFrameRate, isQuickTimeSource, PREVIEW_BITRATE, PREVIEW_MAX_SIDE, previewProxyPlan } from "@/lib/previewProxy";

const MB = 1024 * 1024;

describe("browser editor preview proxies", () => {
  it("recognizes MOV files and QuickTime MIME types case-insensitively", () => {
    expect(isQuickTimeSource("camera.MOV", "video/mp4")).toBe(true);
    expect(isQuickTimeSource("camera.mov", "application/octet-stream")).toBe(true);
    expect(isQuickTimeSource("camera.mp4", "video/quicktime")).toBe(true);
    expect(isQuickTimeSource("camera.mp4", "video/quicktime; codecs=hevc")).toBe(true);
    expect(isQuickTimeSource("camera.mp4", "video/mp4")).toBe(false);
  });
  it("downscales 4K portrait and landscape footage for preview", () => {
    expect(previewProxyPlan({ size: 120 * MB, width: 2160, height: 3840, duration: 60 })).toMatchObject({
      width: 540, height: 960, bitrate: PREVIEW_BITRATE, reason: "resolution-and-bitrate",
    });
    expect(previewProxyPlan({ size: 120 * MB, width: 3840, height: 2160, duration: 60 })).toMatchObject({
      width: 960, height: 540, bitrate: PREVIEW_BITRATE, reason: "resolution-and-bitrate",
    });
    expect(PREVIEW_MAX_SIDE).toBe(960);
  });

  it("creates a smaller portrait preview for a 20 MB 4K phone video", () => {
    expect(previewProxyPlan({ size: 20 * MB, width: 2160, height: 3840, duration: 60 })).toMatchObject({
      width: 540, height: 960, reason: "resolution-and-bitrate",
    });
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
    // 107 Mbps 4K: too big for a preview proxy, but heavy, so it gets an edit copy
    expect(previewProxyPlan({ size: 800 * MB, width: 3840, height: 2160, duration: 60 })).toMatchObject({ reason: "heavy", width: 1920, height: 1080 });
    expect(previewProxyPlan({ size: 200 * MB, width: Number.NaN, height: 2160, duration: 60 })).toBeNull();
  });

  it("gives iPhone 4K HDR 60 fps footage a 1080p 30 fps edit copy, whatever its size, used by the export too", () => {
    // the clips that lagged: 3840 x 2160 HEVC Main 10, HLG, 59.94 fps, ~54 Mbps, 1.8-5.9 s (12-40 MB)
    const iphone = { size: 12 * MB, width: 2160, height: 3840, duration: 1.8, fps: 59.94, hdr: true, tenBit: true };
    expect(isHeavySource(iphone)).toBe(true);
    expect(previewProxyPlan(iphone)).toMatchObject({ width: 1080, height: 1920, bitrate: EDIT_BITRATE, fps: 30, forExport: true, reason: "heavy" });
    expect(previewProxyPlan({ ...iphone, width: 3840, height: 2160 })).toMatchObject({ width: 1920, height: 1080 });
    // 1080p 60 fps SDR: same size, 30 fps
    expect(previewProxyPlan({ size: 30 * MB, width: 1080, height: 1920, duration: 10, fps: 60 })).toMatchObject({ width: 1080, height: 1920, fps: 30, forExport: true });
    // a 4K clip at 40 Mbps is heavy even without a probe
    expect(isHeavySource({ size: 300 * MB, width: 2160, height: 3840, duration: 60 })).toBe(true);
  });
  it("leaves ordinary phone footage (1080p, 30 fps, SDR) on the original for export", () => {
    const ok = { size: 17 * MB, width: 1080, height: 1920, duration: 29, fps: 30, hdr: false, tenBit: false };
    expect(isHeavySource(ok)).toBe(false);
    expect(previewProxyPlan(ok)?.forExport).toBeUndefined();
  });

  it("covers every kind of camera: 8K, 4:2:2 camera files, slow motion, screen recordings", () => {
    const base = { size: 50 * MB, width: 1080, height: 1920, duration: 20 };
    expect(isHeavySource({ ...base, width: 7680, height: 4320, size: 300 * MB })).toBe(true);   // Samsung 8K
    expect(isHeavySource({ ...base, chroma422: true })).toBe(true);                               // Sony / Canon 10-bit 4:2:2
    expect(isHeavySource({ ...base, fps: 240 })).toBe(true);                                      // slo-mo
    expect(isHeavySource({ ...base, vfr: true })).toBe(true);                                     // screen recording
    expect(isHeavySource({ ...base, fps: 29.97 })).toBe(false);
    // a long heavy clip: the copy's bitrate shrinks so it stays under 400 MB
    const long = editCopyPlan({ size: 3000 * MB, width: 3840, height: 2160, duration: 900 });
    expect(long).toMatchObject({ width: 1920, height: 1080, fps: 30 });
    expect((long!.bitrate * 900) / 8).toBeLessThanOrEqual(400 * MB);
    expect(editCopyPlan({ size: 3000 * MB, width: 3840, height: 2160, duration: 3600 })).toBeNull();
    // odd sizes stay even
    expect(editCopyPlan({ size: 9 * MB, width: 1081, height: 1919, duration: 3 })).toMatchObject({ width: 1082, height: 1920 });
  });
  it("finds a changing frame rate from the frame times", () => {
    const even = Array.from({ length: 120 }, (_, i) => i / 30);
    expect(variesFrameRate(even)).toBe(false);
    const jitter = Array.from({ length: 120 }, (_, i) => i / 30).filter((_, i) => i % 3 !== 0);   // low light: frames left out
    expect(variesFrameRate(jitter)).toBe(true);
    const gap = [...even.slice(0, 60), ...even.slice(60).map(t => t + 0.8)];   // a screen recording pausing
    expect(variesFrameRate(gap)).toBe(true);
    expect(variesFrameRate([0, 0.033])).toBe(false);
  });
});
