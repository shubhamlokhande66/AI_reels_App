import { describe, expect, it } from "vitest";
import { describeCut, hitKind, repace, sectionsOf, soundMap, type Slot } from "@/components/studio/soundmap";

/** Fast Studio's ears: the sound map says what each moment of the song sounds like, so the AI can decide with it. */
const SR = 22050;
function song(sec: number, parts: { from: number; to: number; make: (t: number, i: number) => number }[]) {
  const n = Math.round(sec * SR), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / SR; for (const p of parts) if (t >= p.from && t < p.to) out[i] += p.make(t, i); }
  return { out };
}
const kick = (at: number) => (t: number) => { const d = t - at; return d >= 0 && d < 0.15 ? 0.9 * Math.sin(2 * Math.PI * 55 * d) * Math.exp(-d / 0.05) : 0; };
const snare = (at: number) => (t: number) => { const d = t - at; return d >= 0 && d < 0.1 ? 0.6 * Math.sin(2 * Math.PI * 1800 * d + Math.sin(2 * Math.PI * 2600 * d) * 3) * Math.exp(-d / 0.03) : 0; };

describe("sound map", () => {
  it("tells a kick from a snare / tabla hit", () => {
    const { out } = song(4, [{ from: 1, to: 1.2, make: kick(1) }, { from: 2.5, to: 2.62, make: snare(2.5) }]);
    const m = soundMap(out, SR);
    expect(m.fps).toBeCloseTo(50, 0);
    expect(hitKind(m, 1)).toBe("kick");
    expect(hitKind(m, 2.5)).toBe("snare");
  });

  it("hears a voice come in and go up, and the song getting louder", () => {
    const n = 6 * SR, a = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      if (t >= 3) { const f = 300 + 250 * (t - 3); a[i] += (0.05 + 0.1 * (t - 3)) * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t)); }   // a rising, louder held note
      if (t < 3) a[i] += 0.02 * Math.sin(2 * Math.PI * 80 * t);
    }
    const m = soundMap(a, SR);
    const cut = describeCut(m, 3, 6, { hits: [], hitStr: [], drops: [], beats: [] });
    expect(cut.vox === "enters" || cut.vox === "goes up").toBe(true);
    expect(describeCut(m, 3.2, 6, { hits: [], hitStr: [], drops: [], beats: [] }).vox).toBe("goes up");
    expect(cut.trend).toBe("rising");
    expect(cut.voice).toBeGreaterThan(0.5);
  });

  it("lists the strongest hits inside a cut, from its start, and the beats left to the drop", () => {
    const { out } = song(4, [{ from: 1, to: 1.2, make: kick(1) }, { from: 1.5, to: 1.62, make: snare(1.5) }]);
    const m = soundMap(out, SR), beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    const cut = describeCut(m, 0.9, 2, { hits: [1, 1.5, 3], hitStr: [3, 2, 1], drops: [3], beats });
    expect(cut.hits).toEqual([{ at: 0.1, k: "kick", p: 3 }, { at: 0.6, k: "snare", p: 2 }]);
    expect(cut.toDrop).toBe(2);
  });

  it("cuts the song into sections at drops and breaks", () => {
    const { out } = song(16, [{ from: 0, to: 16, make: (t) => 0.1 * Math.sin(2 * Math.PI * 110 * t) }]);
    const m = soundMap(out, SR), beats = Array.from({ length: 32 }, (_, k) => k * 0.5);
    const plan: Slot[] = [{ start: 0, end: 4, type: "cut" }, { start: 4, end: 8, type: "drop" }, { start: 8, end: 12, type: "cut" }, { start: 12, end: 16, type: "break" }];
    const secs = sectionsOf(m, plan, beats, 0.5, 16);
    expect(secs.map((s) => [s.t, s.starts])).toEqual([[0, "start"], [4, "drop"], [12, "break"]]);
    expect(secs[1].beats).toBe(16);
  });
});

describe("the AI's pace on the real beats", () => {
  const beats = Array.from({ length: 33 }, (_, k) => k * 0.5);   // 120 BPM, 16 s
  const plan: Slot[] = [{ start: 0, end: 4, type: "cut" }, { start: 4, end: 5, type: "drop" }, { start: 5, end: 6.2, type: "hit" }, { start: 6.2, end: 12, type: "cut" }, { start: 12, end: 16, type: "break" }];
  const F = 1 / 30;
  it("cuts every N beats per section, one frame early, keeping drops and breaks", () => {
    const out = repace(plan, [{ t: 0, len: 4, every: 4 }, { t: 4, len: 8, every: 1 }, { t: 12, len: 4, every: 8 }], beats, 16);
    const starts = out.map((s) => +s.start.toFixed(3));
    expect(starts.slice(0, 2)).toEqual([0, +(2 - F).toFixed(3)]);
    expect(out.find((s) => Math.abs(s.start - 4) < 1e-6)!.type).toBe("drop");
    expect(out.filter((s) => s.start >= 4 && s.start < 12).length).toBe(16);   // every beat in the 8 s after the drop
    expect(out.find((s) => Math.abs(s.start - 12) < 1e-6)!.type).toBe("break");
    expect(out.filter((s) => s.start >= 12).length).toBe(1);                   // 8 beats: held to the end
    out.slice(1).forEach((s, k) => expect(s.start).toBeCloseTo(out[k].end, 6));
  });
  it("keeps the song's hits when the pace is quick, drops them when it is slow", () => {
    expect(repace(plan, [{ t: 0, len: 4, every: 2 }, { t: 4, len: 8, every: 2 }, { t: 12, len: 4, every: 4 }], beats, 16).some((s) => s.type === "hit")).toBe(true);
    expect(repace(plan, [{ t: 0, len: 4, every: 4 }, { t: 4, len: 8, every: 4 }, { t: 12, len: 4, every: 4 }], beats, 16).some((s) => s.type === "hit")).toBe(false);
  });
  it("keeps to the style and never holds a shot longer than 4.5 s", () => {
    const out = repace(plan, [{ t: 0, len: 16, every: 8 }], beats, 16, "fast");   // Fast allows 1-2 beats
    expect(Math.max(...out.map((s) => s.end - s.start))).toBeLessThanOrEqual(1 + 1 / 30 + 0.001);   // 2 beats (a drop sits on its beat, the other cuts a frame early)
    const slow = repace(plan, [{ t: 0, len: 4, every: 8 }, { t: 4, len: 8, every: 8 }, { t: 12, len: 4, every: 8 }], Array.from({ length: 9 }, (_, k) => k * 2), 16);
    expect(Math.max(...slow.map((s) => s.end - s.start))).toBeLessThanOrEqual(4.5);
  });
  it("leaves the plan as it is without a steady beat", () => {
    expect(repace(plan, [{ t: 0, len: 16, every: 1 }], [0, 1, 2], 16)).toEqual(plan);
  });
});
