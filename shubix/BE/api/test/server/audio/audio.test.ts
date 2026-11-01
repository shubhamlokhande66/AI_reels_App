// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeAudio, ANALYSIS_VERSION, computeEnergy, findAccents, findDrops, highEnergySections, resolveDropPoints } from "../../../src/server/audio/analyzer";
import { bpmFromBeats, foldBpm } from "../../../src/server/audio/bpm";
import { median, percentile } from "../../../src/server/audio/dsp/util";
import type { AudioAnalysis } from "../../../src/server/models/analysis";
import { meanEnergy } from "../../../src/server/models/analysis";
import { AppError } from "../../../src/server/core/errors";
import { makeClickTrack, SR, writeWav } from "./fixtures";
import { rng } from "../rng";

/** The music analysis on songs with known answers (were backend/tests/test_audio.py), now with Essentia's beats. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
let analysis: AudioAnalysis;

beforeAll(async () => {
  makeClickTrack(path.join(dir, "beat120.wav"));
  analysis = await analyzeAudio(path.join(dir, "beat120.wav"));
}, 300_000);

describe("song analysis (Essentia beats)", () => {
  it("finds the tempo", () => {
    expect(analysis.bpm).toBeGreaterThan(118);
    expect(analysis.bpm).toBeLessThan(122);
    expect(Math.abs(analysis.duration - 30)).toBeLessThan(0.5);
    expect(analysis.beatConfidence).toBeGreaterThan(0.7);
  });

  it("puts the beats on the grid", () => {
    const beats = analysis.beats;
    expect(beats.length).toBeGreaterThanOrEqual(50);
    const period = 0.5;
    const off = median(beats.map((b) => b % period));
    const err = beats.map((b) => Math.abs((((b - off + period / 2) % period) + period) % period - period / 2));
    expect(percentile(err, 90)).toBeLessThan(0.05);
    expect([...beats].sort((a, b) => a - b)).toEqual(beats);
  });

  it("keeps strong beats among the beats", () => {
    const set = new Set(analysis.beats);
    expect(analysis.strongBeats.every((t) => set.has(t))).toBe(true);
    expect(analysis.strongBeats.length).toBeGreaterThan(0);
    expect(analysis.strongBeats.length).toBeLessThan(analysis.beats.length);
  });

  it("finds the louder second half and a normalised energy curve", () => {
    expect(analysis.highEnergySections.some((s) => s.start >= 12 && s.end > 25)).toBe(true);
    expect(meanEnergy(analysis, 20, 28)).toBeGreaterThan(meanEnergy(analysis, 2, 10));
    expect(analysis.energy.every((e) => e >= 0 && e <= 1)).toBe(true);
    expect(Math.abs(analysis.energy.length - analysis.duration / analysis.energyHop)).toBeLessThanOrEqual(3);
  });

  it("finds the strong hits on the grid", () => {
    expect(analysis.analysisVersion).toBe(ANALYSIS_VERSION);
    expect(analysis.accents.length).toBe(analysis.accentStrengths.length);
    expect(analysis.accents.length).toBeGreaterThan(10);
    expect(analysis.accentStrengths.every((s) => s >= 0.35 && s <= 1)).toBe(true);
    expect(Math.max(...analysis.accentStrengths)).toBeGreaterThanOrEqual(0.9);
    expect(analysis.accents.every((t, i, a) => !i || t - a[i - 1] >= 0.2)).toBe(true);
    expect(median(analysis.accents.map((t) => Math.min(...analysis.beats.map((b) => Math.abs(t - b)))))).toBeLessThan(0.06);
  });

  it("reports the stages in order", { timeout: 300_000 }, async () => {
    const seen: [string, number][] = [];
    await analyzeAudio(path.join(dir, "beat120.wav"), (s, f) => seen.push([s, f]));
    const stages = seen.map(([s]) => s);
    expect(stages.indexOf("analyzing_music")).toBeLessThan(stages.indexOf("detecting_beats"));
    expect(seen[seen.length - 1]).toEqual(["detecting_beats", 1]);
  });

  it("finds another tempo, and the BPM is the spacing of the beats listed", { timeout: 600_000 }, async () => {
    for (const bpm of [100, 140, 75]) {
      const p = path.join(dir, `b${bpm}.wav`);
      makeClickTrack(p, bpm, 20);
      const a = await analyzeAudio(p);
      expect(Math.abs(a.bpm - bpm), `bpm ${bpm}: got ${a.bpm}`).toBeLessThan(2.5);
      const grid = 60 / median(a.beats.slice(1).map((t, i) => t - a.beats[i]));
      expect(Math.abs(grid - a.bpm) / a.bpm).toBeLessThan(0.05);
    }
  });

  it("refuses a silent file", async () => {
    const p = path.join(dir, "silent.wav");
    writeWav(p, new Float32Array(SR * 5));
    await expect(analyzeAudio(p)).rejects.toMatchObject({ code: "SILENT_AUDIO" });
    await expect(analyzeAudio(p)).rejects.toBeInstanceOf(AppError);
  });
});

describe("tempo and section helpers", () => {
  it("folds the tempo and measures regularity", () => {
    expect([foldBpm(60), foldBpm(240), foldBpm(128)]).toEqual([120, 120, 128]);
    const [bpm, conf] = bpmFromBeats([0, 0.5, 1, 1.5, 2]);
    expect(bpm).toBeCloseTo(120, 6);
    expect(conf).toBeGreaterThan(0.9);
    expect(bpmFromBeats([0, 1])).toEqual([0, 0]);
  });

  it("uses the energy fallback when events contain no confident drop or entry", () => {
    const energy = Float64Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.1 : 0.95));
    const [cuts, measured] = resolveDropPoints([
      { time: 8, detectedAt: 8.02, type: "breakdown", strength: 0.1, confidence: 0.9, end: 12, measurements: {} },
      { time: 14, detectedAt: 14.03, type: "build_up", strength: 0.2, confidence: 0.8, end: 20, measurements: {} },
    ], energy, []);
    expect(measured.some((time) => Math.abs(time - 20) < 0.2)).toBe(true);
    expect(cuts).toEqual(measured);
  });

  it("keeps beat-snapped cut points separate from raw detected drop times", () => {
    const [cuts, measured] = resolveDropPoints([
      { time: 20, detectedAt: 19.86, type: "possible_drop", strength: 0.9, confidence: 0.9, end: null, measurements: {} },
    ], new Float64Array(400), []);
    expect(cuts).toEqual([20]);
    expect(measured).toEqual([19.86]);
  });

  it("finds a drop and the loud section", () => {
    const e = Float64Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.1 : 0.95));
    const [cuts, measured] = findDrops(e, Array.from({ length: 80 }, (_, i) => i * 0.37));
    expect(measured.some((d) => Math.abs(d - 20) < 0.2)).toBe(true); // the measured time, not moved
    expect(cuts.every((c) => Number.isInteger(Math.round(c / 0.37 * 1000) / 1000))).toBe(true); // the cut point is a beat
    const secs = highEnergySections(e);
    expect(secs.length && secs[0].start >= 19).toBeTruthy();
    const r = rng(1);
    expect(computeEnergy(Float32Array.from({ length: SR * 3 }, () => (r.next() - 0.5) * 0.2), SR).length).toBeGreaterThan(20);
  });

  it("has no accents in flat or tiny signals, and one huge hit does not hide the others", () => {
    expect(findAccents(new Float64Array(800), SR)).toEqual([[], []]);
    expect(findAccents(new Float64Array(800).fill(0.7), SR)).toEqual([[], []]);
    expect(findAccents(Float64Array.from([0, 1, 0]), SR)).toEqual([[], []]);
    const r = rng(0);
    const env = Float64Array.from({ length: 4000 }, () => 0.5 + 0.15 * r.next());
    for (let i = 0; i < env.length; i += 40) env[i] += 3;
    env[2000] = 40;
    const [times, strengths] = findAccents(env, SR);
    expect(times.length).toBeGreaterThan(60);
    expect(strengths.filter((x) => x >= 0.55).length).toBeGreaterThan(60);
    expect(Math.max(...strengths)).toBe(1);
  });
});
