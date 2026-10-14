// @vitest-environment node
import { describe, expect, it } from "vitest";
import { keyBeats, KEY_SCORE, scoreBeats } from "@/server/audio/keyBeats";
import { withDefaults, type AudioAnalysis } from "@/server/models/analysis";
import { parseTimeline } from "@/server/models/timeline";
import { getTransition } from "@/server/video/render/parts";
import { planSlots } from "@/server/video/timeline";
import { ensureTransitions } from "@/server/video/transitions";
import { getStyle } from "@/server/styles";

const seg = (i: number, len: number, type: string) => ({ clipId: "c", video: "v", sourceStart: i * 3, sourceEnd: i * 3 + len, timelineStart: i * len, timelineEnd: (i + 1) * len, transitionIn: { type, duration: 0 } });

describe("every cut has a transition", () => {
  it("fills plain cuts, maps unknown names, never repeats one, keeps the first shot a cut", () => {
    const tl = parseTimeline({ duration: 12, segments: ["cut", "cut", "fade_in", "whip", "zoom", "zoom", "made_up_thing", "cut"].map((t, i) => seg(i, 1.5, t)) });
    ensureTransitions(tl);
    const types = tl.segments.map((s) => s.transitionIn.type);
    expect(types[0]).toBe("cut");
    for (const t of types.slice(1)) expect(t).not.toBe("cut");
    for (const t of types.slice(1)) expect(getTransition(t).name).toBe(t); // a transition the renderer knows
    expect(types[2]).toBe("dissolve"); // "fade_in" from the AI
    expect(types[3]).toBe("slide_left"); // "whip"
    types.slice(2).forEach((t, i) => expect(t).not.toBe(types[i + 1])); // never twice in a row
    for (const [i, s] of tl.segments.entries()) if (i) {
      expect(s.transitionIn.duration).toBeGreaterThan(0);
      expect(s.transitionIn.duration).toBeLessThanOrEqual(0.4 * 1.5 + 1e-9); // fits both shots
    }
  });

  it("leaves a locked shot as the user set it", () => {
    const tl = parseTimeline({ duration: 6, segments: [seg(0, 2, "cut"), { ...seg(1, 2, "cut"), locked: true }, seg(2, 2, "cut")] });
    ensureTransitions(tl);
    expect(tl.segments[1].transitionIn.type).toBe("cut");
    expect(tl.segments[2].transitionIn.type).not.toBe("cut");
  });
});

/** 120 BPM, 30 s: a hard kick on every 4th beat (the key hits), soft hits elsewhere, a drop at 16 s. */
function song(): AudioAnalysis {
  const beats = Array.from({ length: 60 }, (_, i) => +(0.5 + i * 0.5).toFixed(3));
  const transients = beats.map((t, i) => ({ t, band: "low" as const, strength: i % 4 === 0 ? 1 : 0.3 }));
  return withDefaults({ bpm: 120, duration: 30.5, beats, transients, drops: [16.5], dropTimes: [16.5], energy: Array.from({ length: 305 }, (_, i) => (i < 165 ? 0.4 : 0.9)), energyHop: 0.1 });
}

describe("cuts only on key beats", () => {
  it("scores the hard hits and the drop as key beats, not the other beats", () => {
    const a = song(), keys = keyBeats(a).map((k) => k.t);
    expect(keys).toContain(16.5);
    const plain = scoreBeats(a).filter((b, i) => i % 4 !== 0 && b.why !== "drop");
    expect(plain.every((b) => b.score < KEY_SCORE)).toBe(true);
    expect(keys.length).toBeLessThan(a.beats.length / 3);
  });

  it("a fast style no longer cuts on every beat: shots of about a bar, every cut on a key beat", () => {
    const a = song(), keys = new Set(keyBeats(a).map((k) => k.t)), slots = planSlots(a, 0, 30, getStyle("viral"));
    const cuts = slots.slice(1).map((s) => s.start);
    expect(cuts.length).toBeLessThanOrEqual(16); // 60 beats: a cut on every beat would be ~59
    for (const c of cuts.slice(1)) expect(keys.has(c)).toBe(true); // (the first cut is the hook cut before 1.8 s)
    expect(cuts.some((c) => Math.abs(c - 16.5) < 0.01)).toBe(true); // the drop gets a cut
    expect(Math.min(...slots.slice(1, -1).map((s) => s.end - s.start))).toBeGreaterThanOrEqual(getStyle("viral").minSegment - 1e-6);
  });
});
