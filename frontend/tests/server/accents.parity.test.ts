// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyze } from "@/server/audio/accents";
import { barSong, SR } from "./audio/fixtures";
import { python } from "./parity";

/** server/audio/accents.ts against backend/app/audio/accents.py on the same signals and beats. */
describe("accents: same as Python", () => {
  it("bar songs with and without a pickup, beats late and on time", { timeout: 600_000 }, () => {
    const cases = [
      { ...barSong(120, 16, 2), shift: 0 }, { ...barSong(120, 16, 0), shift: 0.025 }, { ...barSong(96, 12, 1, 3), shift: -0.02 },
    ].map((c) => ({ y: c.y, beats: c.beats.map((b) => Math.max(b + c.shift, 0)) }));
    const py = python<{ downbeats: number[]; conf: number; strong: number[]; levels: number[]; kick: number[]; beats: number[]; medium: number[] }>(
      cases.map((c) => ({ kind: "accents", y: Array.from(c.y), beats: c.beats })));
    if (!py) return;
    cases.forEach((c, i) => {
      const r = analyze(c.y, SR, c.beats);
      expect(r.beats, `case ${i} beats`).toEqual(py[i].beats);
      expect(r.levels, `case ${i} levels`).toEqual(py[i].levels);
      expect(r.downbeats, `case ${i} downbeats`).toEqual(py[i].downbeats);
      expect(r.downbeatConfidence, `case ${i} confidence`).toBeCloseTo(py[i].conf, 2);
      expect(r.strongBeats, `case ${i} strong`).toEqual(py[i].strong);
      expect(r.mediumBeats, `case ${i} medium`).toEqual(py[i].medium);
    });
  });
});
