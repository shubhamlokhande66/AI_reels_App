import { describe, expect, it } from "vitest";
import { ALL_ON, DEFAULTS, FEATURE_LIST, linkOn, pageFeature } from "@shubix/core/lib/features-list";

describe("feature switches", () => {
  it("knows which part each page belongs to", () => {
    expect(pageFeature("/create/music", ALL_ON)).toBe("fastStudio");
    expect(pageFeature("/brands", ALL_ON)).toBe("brands");
    expect(pageFeature("/", ALL_ON)).toBeNull();
    expect(pageFeature("/reels", ALL_ON)).toBeNull();
  });
  it("hides a link only when its part is off", () => {
    const f = { ...ALL_ON, brands: false };
    expect(linkOn("/brands", f)).toBe(false);
    expect(linkOn("/create/music", f)).toBe(true);
    expect(linkOn("/create/music", { ...f, fastStudio: false })).toBe(false);
  });
  it("starts with making Reels on the phone on, and every part that uses the server off", () => {
    expect(DEFAULTS.fastStudio).toBe(true);
    for (const f of FEATURE_LIST.filter((x) => x.server)) expect(DEFAULTS[f.key], f.key).toBe(false);
    expect(linkOn("/reels", DEFAULTS)).toBe(true);
  });
});
