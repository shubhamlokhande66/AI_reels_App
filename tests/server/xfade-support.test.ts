// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseTimeline } from "@/server/models/timeline";
import { buildVideoGraph } from "@/server/video/render/renderer";
import { renderConfig } from "@/server/video/render/cutter";
import { parseXfadeHelp, xfadeName, xfadeTransitions } from "@/server/video/render/parts";

/** The start of `ffmpeg -h filter=xfade` from an FFmpeg 5.1 build (Debian bookworm): no cover/reveal transitions. */
const OLD_HELP = `xfade AVOptions:
   transition        <int>        ..FV....... set cross fade transition (from -1 to 45) (default fade)
     custom          -1           ..FV....... custom transition
     fade            0            ..FV....... fade transition
     wipeleft        1            ..FV....... wipe left transition
     slideup         7            ..FV....... slide up transition
     wipedown        4            ..FV....... wipe down transition
   duration          <duration>   ..FV....... set cross fade duration (default 1)
   offset            <duration>   ..FV....... set cross fade start relative to first input stream (default 0)`;

describe("transitions an older FFmpeg lacks", () => {
  const old = parseXfadeHelp(OLD_HELP);

  it("reads the transition names from the filter help", () => {
    expect([...old]).toEqual(["custom", "fade", "wipeleft", "slideup", "wipedown"]);
  });

  it("swaps a missing transition for its closest look, else a plain fade", () => {
    expect(xfadeName("wipeleft", old)).toBe("wipeleft");
    expect(xfadeName("coverup", old)).toBe("slideup");
    expect(xfadeName("revealdown", old)).toBe("wipedown");
    expect(xfadeName("coverleft", old)).toBe("fade"); // its fallback (slideleft) is missing too
    expect(xfadeName("coverup", null)).toBe("coverup"); // support unknown: as given
  });

  it("never puts an unsupported transition in the render graph", () => {
    const seg = (i: number, type: string) => ({ clipId: "c", video: "v", sourceStart: 0, sourceEnd: 2, timelineStart: i * 2, timelineEnd: (i + 1) * 2, transitionIn: { type, duration: i ? 0.3 : 0 } });
    const tl = parseTimeline({ duration: 6, segments: [seg(0, "cut"), seg(1, "cover_up"), seg(2, "reveal_down")] });
    const plans = tl.segments.map(() => ({ length: 2, tail: 0, ramp: false, hits: [] }));
    const [graph] = buildVideoGraph(tl.segments, plans, renderConfig(), old);
    expect(graph).toContain("transition=slideup");
    expect(graph).toContain("transition=wipedown");
    expect(graph).not.toMatch(/coverup|revealdown/);
  });

  it("reads this machine's FFmpeg (every build has the basic ones)", { timeout: 30_000 }, async () => {
    const names = await xfadeTransitions();
    if (!names) return; // no FFmpeg here
    for (const n of ["fade", "wipeleft", "slideup", "fadeblack"]) expect(names.has(n), n).toBe(true);
    expect(names.size).toBeGreaterThan(40);
  });
});
