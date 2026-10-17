import { describe, expect, it } from "vitest";
import { ALL_ON, DEFAULTS, FEATURE_LIST, linkOn, pageFeature } from "@/lib/features-list";

describe("feature switches", () => {
  it("knows which part each page belongs to", () => {
    expect(pageFeature("/editor", ALL_ON)).toBe("editor");
    expect(pageFeature("/editor/abc", ALL_ON)).toBe("editor");
    expect(pageFeature("/story/new", ALL_ON)).toBe("story");
    expect(pageFeature("/projects", ALL_ON)).toBeNull();
    expect(pageFeature("/", ALL_ON)).toBeNull();
  });
  it("hides a link only when its part is off", () => {
    const f = { ...ALL_ON, editor: false, songs: false, productReel: false };
    expect(linkOn("/editor", f)).toBe(false);
    expect(linkOn("/songs", f)).toBe(false);
    expect(linkOn("/projects/new?kind=product", f)).toBe(false);
    expect(linkOn("/projects/new", f)).toBe(true); // the clip Reel is still on
    expect(linkOn("/library", f)).toBe(true);
  });
  it("hides Create Reel only when both of its kinds are off", () => {
    const f = { ...ALL_ON, aiReel: false, productReel: false };
    expect(linkOn("/projects/new", f)).toBe(false);
    expect(linkOn("/projects/new", { ...f, productReel: true })).toBe(true);
  });
  it("starts with only Fast Studio on: every part that works on the server is off until the administrator turns it on", () => {
    expect(DEFAULTS.fastStudio).toBe(true);
    for (const f of FEATURE_LIST.filter((x) => x.server)) expect(DEFAULTS[f.key], f.key).toBe(false);
    expect(linkOn("/projects", DEFAULTS)).toBe(false); // the server's projects; Fast Studio's are in My Reels
    expect(linkOn("/reels", DEFAULTS)).toBe(true);
    expect(linkOn("/projects", { ...DEFAULTS, story: true })).toBe(true);
  });
});
