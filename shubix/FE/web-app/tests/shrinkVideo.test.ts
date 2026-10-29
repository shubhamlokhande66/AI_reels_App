import { describe, expect, it } from "vitest";
import { shrinkPlan, shrinkVideo } from "@/lib/shrinkVideo";

const MB = 1024 * 1024;

describe("which clips are shrunk before upload", () => {
  it("brings 4K footage down to 1080p, keeping its shape", () => {
    expect(shrinkPlan({ size: 400 * MB, width: 2160, height: 3840, duration: 60 })).toEqual({ width: 1080, height: 1920 });
    expect(shrinkPlan({ size: 400 * MB, width: 3840, height: 2160, duration: 60 })).toEqual({ width: 1920, height: 1080 });
  });
  it("re-encodes 1080p only when its bitrate is very high", () => {
    expect(shrinkPlan({ size: 300 * MB, width: 1080, height: 1920, duration: 60 })).toEqual({ width: 1080, height: 1920 }); // 42 Mbit/s
    expect(shrinkPlan({ size: 60 * MB, width: 1080, height: 1920, duration: 60 })).toBeNull(); // 8 Mbit/s: fine as it is
  });
  it("leaves small clips and ones it could not save much on", () => {
    expect(shrinkPlan({ size: 20 * MB, width: 2160, height: 3840, duration: 10 })).toBeNull();
    expect(shrinkPlan({ size: 30 * MB, width: 2160, height: 3840, duration: 22 })).toBeNull(); // 10 Mbit/s would be ~26 MB
  });
  it("keeps the original where the browser has no video encoder", async () => {
    const f = new File([new Uint8Array(10)], "a.mov", { type: "video/quicktime" });
    expect(await shrinkVideo(f)).toBe(f);
  });
});
