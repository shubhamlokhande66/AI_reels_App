// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AppError } from "@/server/core/errors";
import { EFFECT_TYPES, parseTimeline, TRANSITION_TYPES } from "@/server/models/timeline";
import { applyOperations, parseOps } from "@/server/timeline/ops";
import * as kfx from "@/server/video/keyframes";
import { python, rng } from "./parity";

/** The TypeScript editing operations against the Python ones they replace (backend/app/video/timeline_ops.py): the
 * same random timelines and edits through both, and the results compared (new ids are random, so ids are left out). */

const CLIPS = { a: 6, b: 2.4, c: 12, d: 0.9 };
const NAMES = { a: "a.mp4", b: "b.mp4", c: "c.mp4", d: "d.mp4" };

function timeline(r: ReturnType<typeof rng>) {
  const segs = [];
  let t = 0;
  for (let i = 0, n = r.int(1, 6); i < n; i++) {
    const clip = r.pick(Object.keys(CLIPS) as (keyof typeof CLIPS)[]);
    const len = r.num(0.3, 3);
    const ss = r.num(0, Math.max(CLIPS[clip] - 0.5, 0));
    segs.push({
      id: `s${i}`, clipId: clip, video: NAMES[clip], sourceStart: ss, sourceEnd: ss + len, timelineStart: t, timelineEnd: t + len,
      speed: r.pick([1, 1, 0.5, 2, 1.5]), effect: r.pick(["none", "none", ...EFFECT_TYPES.slice(0, 4)]),
      transitionIn: i && r.next() < 0.5 ? { type: r.pick(TRANSITION_TYPES), duration: r.num(0, 0.8) } : { type: "cut", duration: 0 },
    });
    t += len;
  }
  const caps = Array.from({ length: r.int(0, 3) }, (_, i) => ({ id: `c${i}`, start: r.num(0, t), end: r.num(0, t + 1), text: r.pick(["hi there", "  ", "one two three", "x"]) }));
  return {
    duration: t, bpm: 120, audioStart: r.num(0, 30), segments: segs, captions: caps,
    voice: r.next() < 0.3 ? { fileKey: "v.wav", duration: r.num(1, 10), start: 0.3, lines: [{ text: "a", start: 0.3, end: 1 }] } : null,
  };
}

function op(r: ReturnType<typeof rng>, tl: ReturnType<typeof timeline>) {
  const sid = r.next() < 0.9 ? r.pick(tl.segments).id : "missing";
  const cid = r.next() < 0.5 ? (tl.captions.length ? r.pick(tl.captions).id : "nope") : "nope";
  const kinds = [
    () => ({ type: "trim", segmentId: sid, sourceStart: r.next() < 0.5 ? r.num(-0.5, 5) : null, sourceEnd: r.next() < 0.5 ? r.num(0, 8) : null }),
    () => ({ type: "set_length", segmentId: sid, length: r.num(0.1, 6) }),
    () => ({ type: "move", segmentId: sid, toIndex: r.int(-1, tl.segments.length) }),
    () => ({ type: "split", segmentId: sid, at: r.num(0, tl.duration) }),
    () => ({ type: "delete", segmentId: sid }),
    () => ({ type: "duplicate", segmentId: sid }),
    () => ({ type: "insert", clipId: r.pick(["a", "b", "c", "d", "zz"]), sourceStart: r.num(0, 10), length: r.num(0.1, 8), index: r.next() < 0.5 ? r.int(-2, 8) : null }),
    () => ({ type: "replace", segmentId: sid, clipId: r.pick(["a", "c", "zz"]), sourceStart: r.num(0, 4) }),
    () => ({ type: "set_speed", segmentId: sid, speed: r.pick([0.1, 0.25, 0.5, 2, 4, 5]) }),
    () => ({ type: "set_transition", segmentId: sid, transition: r.pick([...TRANSITION_TYPES.slice(0, 5), "bogus", "cut"]), duration: r.next() < 0.5 ? r.num(0, 1.2) : null }),
    () => ({ type: "set_effect", segmentId: sid, effect: r.pick([...EFFECT_TYPES.slice(0, 6), "bogus"]) }),
    () => ({ type: "set_keyframes", segmentId: sid, keyframes: [{ t: r.num(-1, 1), zoom: r.num(0.5, 4) }, { t: r.num(0, 3), speed: r.num(0.1, 5), ease: r.pick(kfx.MOTION.length ? ["linear", "ease_in", "hold"] : []) }] }),
    () => ({ type: "set_looks", segmentId: sid, looks: r.pick([["glow"], ["glow", "glow", "vignette"], ["nope"], []]) }),
    () => ({ type: "set_crop", segmentId: sid, crop: { framing: r.pick(["auto", "fill", "fit"]), focusX: r.num(0, 1) } }),
    () => ({ type: "set_music", volume: r.num(0, 2), fadeOut: r.next() < 0.5 ? r.num(0, 5) : null, audioStart: r.next() < 0.5 ? r.num(0, 300) : null }),
    () => ({ type: "add_caption", start: r.num(0, tl.duration), end: r.num(0, tl.duration + 1), text: r.pick(["new words here", "a"]) }),
    () => ({ type: "update_caption", captionId: cid, text: r.next() < 0.5 ? "changed text" : null, end: r.next() < 0.5 ? r.num(0, 5) : null }),
    () => ({ type: "delete_caption", captionId: cid }),
    () => ({ type: "set_caption_style", style: r.pick(["bold", "luxury"]) }),
    () => ({ type: "fit_duration", target: r.num(1, 40) }),
    () => ({ type: "set_voice_mix", volume: r.num(0, 2), start: r.next() < 0.5 ? r.num(0, 3) : null }),
    () => ({ type: "replace_captions", captions: [{ start: 0, end: 1.5, text: "first line" }, { start: 1, end: 1.05, text: "short" }] }),
    () => ({ type: "fit_to_voice", tail: r.num(0, 2) }),
    () => ({ type: "set_caption_look", font: r.pick(["  Inter ", "", null]), color: r.pick(["#ff00aa", "", null]) }),
    () => ({ type: "set_overlays", overlays: [{ id: "o1", text: "one two three four five six seven eight", start: r.num(0, 3), end: r.num(0, 5) }, { id: "o2", text: "Shop now", start: r.num(0, 3), end: r.num(1, 6), role: "cta" }] }),
    () => ({ type: "set_grade", grade: r.pick(["luxury", "nope", null]) }),
    () => ({ type: "set_lock", segmentId: sid, locked: r.next() < 0.5 }),
  ];
  return r.pick(kinds)();
}

const strip = (tl: Record<string, unknown>) => {
  const t = JSON.parse(JSON.stringify(tl));
  for (const k of ["segments", "captions", "overlays"]) for (const x of t[k] ?? []) delete x.id;
  return t;
};

/** Numbers compared at 1e-9 (the same maths in both languages can differ in the last bit). */
function close(a: unknown, b: unknown, path = ""): string | null {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) ? null : `${path}: ${a} vs ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = close(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) { const d = close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return a === b ? null : `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

describe("timeline operations: same results as the Python backend", () => {
  it("400 random edits", { timeout: 120_000 }, () => {
    const r = rng(7);
    const cases = Array.from({ length: 400 }, () => {
      const tl = timeline(r);
      return { kind: "ops", timeline: tl, ops: Array.from({ length: r.int(1, 3) }, () => op(r, tl)), ctx: { clipDurations: CLIPS, clipNames: NAMES, audioDuration: r.next() < 0.5 ? 40 : null } };
    });
    const py = python<{ ok: boolean; timeline?: Record<string, unknown>; code?: string }>(cases);
    if (!py) return; // no Python here: nothing to compare against
    let same = 0;
    cases.forEach((c, i) => {
      let ts: { ok: boolean; timeline?: Record<string, unknown>; code?: string };
      try {
        ts = { ok: true, timeline: applyOperations(parseTimeline(c.timeline), parseOps(c.ops), c.ctx) as unknown as Record<string, unknown> };
      } catch (e) {
        ts = { ok: false, code: e instanceof AppError ? e.code : String(e) };
      }
      const want = py[i];
      expect({ case: i, ok: ts.ok, code: ts.code }).toEqual({ case: i, ok: want.ok, code: want.code });
      if (ts.ok) {
        const diff = close(strip(ts.timeline!), strip(want.timeline!));
        expect(diff, `case ${i}: ${JSON.stringify(c.ops)}`).toBeNull();
      }
      same++;
    });
    expect(same).toBe(400);
  });
});
