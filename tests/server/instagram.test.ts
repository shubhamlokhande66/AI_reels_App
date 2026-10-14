// @vitest-environment node
import { describe, expect, it } from "vitest";
import { endOnlyWatermark, finalizeCopy, hookFromFirstFrame, polishTimeline, tuneStyle } from "@/server/platforms/instagram";
import { parseTimeline, TextOverlay } from "@/server/models/timeline";
import { getStyle } from "@/server/styles";

/** Instagram mode (was backend/tests/test_instagram.py on the Instagram branch). */
const timeline = (o: Record<string, unknown> = {}) => parseTimeline({
  duration: 12, segments: [{ clipId: "a", video: "a.mp4", sourceStart: 0, sourceEnd: 3, timelineStart: 0, timelineEnd: 3 }, { clipId: "b", video: "b.mp4", sourceStart: 0, sourceEnd: 9, timelineStart: 3, timelineEnd: 12 }], ...o,
});

describe("Instagram mode", () => {
  it("cuts for Instagram: hook-first opening, a cut by 1.8 s, short shots, no fades", () => {
    const st = tuneStyle(getStyle("cinematic"));
    expect(st.opening).toBe("hook");
    expect(st.hookCut).toBe(1.8);
    expect(st.loopEnd).toBe(true);
    expect(st.maxSegment).toBeLessThanOrEqual(3.5);
    expect(st.fadeInOut).toBe(0);
  });

  it("shows the logo only on the closing seconds and the hook from the first frame", () => {
    expect(endOnlyWatermark({ logoKey: "x", position: "br", opacity: 0.8, scale: 0.16, showFrom: null }, 12)?.showFrom).toBe(10);
    const [o] = hookFromFirstFrame([TextOverlay.parse({ text: "Hi", start: 0.5, end: 2, role: "hook" })]);
    expect(o.start).toBe(0);
  });

  it("adds the hook and closing text, and music from the first frame", () => {
    const tl = timeline();
    const notes = polishTimeline(tl, "3 mistakes new runners make", "Save this");
    expect(tl.overlays.map((o) => [o.role, o.start])).toEqual([["hook", 0], ["cta", 10]]);
    expect(tl.musicFadeIn).toBeLessThanOrEqual(0.05);
    expect(notes.join(" ")).toContain("first frame");
  });

  it("writes Instagram-ready copy: at most 5 specific hashtags, a send line and alt text", () => {
    const c = finalizeCopy({ title: "Run", description: "Tips", hashtags: ["running", "viral", "fyp", "tips", "marathon", "coach", "beginner", "shoes"] }, { name: "Run", language: "mr" });
    expect(c.hashtags).toEqual(["running", "tips", "marathon", "coach", "beginner"]);
    expect(c.sendPrompt).toContain("पाठवा");
    expect(String(c.altText)).toMatch(/^Vertical video/);
    const t = finalizeCopy(null, { name: "Morning run", brief: "Easy tips for new runners. More later." });
    expect(t.source).toBe("template");
    expect(t.description).toBe("Easy tips for new runners.");
  });
});
