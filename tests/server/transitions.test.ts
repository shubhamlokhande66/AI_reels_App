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

describe("transition names", () => {
  it("every transition the app picks is one the renderer knows (none falls back to a hard cut)", async () => {
    const { PALETTE } = await import("@/server/video/transitions");
    for (const name of Object.values(PALETTE).flat()) expect(getTransition(name).name, name).toBe(name);
  });
});

describe("the automatic part of the song", () => {
  it("starts exactly on a key beat, never at 0:00 between beats", async () => {
    const { rankMusicWindows } = await import("@/server/video/timeline");
    const a = song(), keys = new Set(keyBeats(a).map((k) => k.t));
    const parts = rankMusicWindows(a, 15, 5);
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(keys.has(p.start), `start ${p.start}`).toBe(true);
  });
});

describe("a part of the song chosen by hand", () => {
  it("moves onto the nearest KEY beat, with a warning", async () => {
    const { chooseMusicWindow } = await import("@/server/video/timeline");
    const warnings: string[] = [];
    const [start] = chooseMusicWindow(song(), 15, warnings, 5.2); // key beats every 2 s from 0.5: 4.5 and 6.5 (5.0 is a plain beat)
    expect(start).toBe(4.5);
    expect(warnings.join(" ")).toMatch(/nearest key beat/);
    const quiet: string[] = [];
    expect(chooseMusicWindow(song(), 15, quiet, 6.5)[0]).toBe(6.5); // already on a key beat: unchanged, no warning
    expect(quiet).toEqual([]);
  });
});

describe("strict: every cut on a key beat", () => {
  it("moves a cut that is off a key beat onto the nearest one, and merges two that would share one", async () => {
    const { cutsOnKeyBeats } = await import("@/server/video/keyCuts");
    const a = song(); // key beats: 0.5, 2.5, 4.5, ... (every 4th beat) and the drop at 16.5
    const keys = keyBeats(a).map((k) => k.t);
    const tl = parseTimeline({ duration: 10, audioStart: 0.5, segments: [[0, 1.7], [1.7, 2.3], [2.3, 4.1], [4.1, 10]].map(([s, e]) => ({ clipId: "c", video: "v", sourceStart: 5, sourceEnd: 5 + e - s, timelineStart: s, timelineEnd: e })) });
    cutsOnKeyBeats(tl, a);
    const cuts = tl.segments.slice(1).map((s) => +(s.timelineStart + 0.5).toFixed(3)); // back to song time
    for (const c of cuts) expect(keys.some((k) => Math.abs(k - c) < 0.01), `cut at song ${c}`).toBe(true);
    expect(tl.segments.length).toBe(3); // 1.7 and 2.3 would both land on the key beat at reel 2.0: one shot fewer
    expect(tl.segments.every((s, i) => !i || Math.abs(s.timelineStart - tl.segments[i - 1].timelineEnd) < 1e-6)).toBe(true); // no gaps
  });

  it("the normal edit only cuts on key beats", () => {
    const a = song(), keys = new Set(keyBeats(a).map((k) => k.t));
    for (const st of ["viral", "cinematic", "fast_trending"]) {
      const cuts = planSlots(a, 0.5, 20, getStyle(st)).slice(1).map((s) => +(s.start + 0.5).toFixed(3));
      for (const c of cuts) expect(keys.has(c), `${st}: cut at song ${c}`).toBe(true);
    }
  });
});
