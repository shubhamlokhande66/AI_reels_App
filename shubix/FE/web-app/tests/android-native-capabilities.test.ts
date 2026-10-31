import { describe, expect, it } from "vitest";
import {
  isAndroidEffectSupported,
  isAndroidFilterSupported,
  isAndroidTransitionSupported,
  normalizeAndroidTransition,
} from "../../mobile-app/lib/rendering/native-capabilities";

describe("Android native export capabilities", () => {
  it("normalizes supported transition aliases consistently", () => {
    expect(normalizeAndroidTransition("Fade")).toBe("fade");
    expect(normalizeAndroidTransition("fade-in")).toBe("fade");
    expect(normalizeAndroidTransition("WHIP_PAN")).toBe("whip-pan");
    expect(normalizeAndroidTransition("Slide Up")).toBe("slide-up");
    expect(normalizeAndroidTransition("swipe-up")).toBe("slide-up");
    expect(isAndroidTransitionSupported("Cut")).toBe(true);
    expect(isAndroidTransitionSupported("hard")).toBe(true);
  });

  it("rejects transitions without an implemented export mapping", () => {
    expect(isAndroidTransitionSupported("crossfade")).toBe(false);
    expect(isAndroidTransitionSupported("dissolve")).toBe(false);
    expect(isAndroidTransitionSupported("morph")).toBe(false);
  });

  it("keeps hyphenated native effect identifiers valid", () => {
    expect(isAndroidEffectSupported("punch-soft")).toBe(true);
    expect(isAndroidEffectSupported("pan-soft")).toBe(true);
    expect(isAndroidEffectSupported("ZOOMBURST")).toBe(true);
    expect(isAndroidEffectSupported("none")).toBe(true);
    expect(isAndroidEffectSupported("cinematic-glow")).toBe(false);
  });

  it("accepts only the shipped native filter names", () => {
    expect(isAndroidFilterSupported("Cinematic")).toBe(true);
    expect(isAndroidFilterSupported("Teal & Orange")).toBe(true);
    expect(isAndroidFilterSupported("Unreleased Filter")).toBe(false);
  });
});
