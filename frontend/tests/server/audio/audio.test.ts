// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyze as accents, snapToHits } from "@/server/audio/accents";
import { analyzeAudio, ANALYSIS_VERSION, computeEnergy, findAccents, findDrops, highEnergySections } from "@/server/audio/analyzer";
import { fillHalfTime } from "@/server/audio/beats";
import { bpmFromBeats, foldBpm } from "@/server/audio/bpm";
import { timeToFrames } from "@/server/audio/dsp/spectral";
import { median, percentile } from "@/server/audio/dsp/util";
import type { AudioAnalysis } from "@/server/models/analysis";
import { meanEnergy } from "@/server/models/analysis";
import { AppError } from "@/server/core/errors";
import { barSong, makeClickTrack, SR, writeWav } from "./fixtures";
import { rng } from "../parity";

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

  it("finds a drop and the loud section", () => {
    const e = Float64Array.from({ length: 400 }, (_, i) => (i < 200 ? 0.1 : 0.95));
    expect(findDrops(e, Array.from({ length: 80 }, (_, i) => i * 0.5)).some((d) => Math.abs(d - 20) < 1.5)).toBe(true);
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

  it("adds half-time beats only where the music hits between them, at the hit", () => {
    const beats: number[] = [];
    for (let t = 1; t < 20; t += 0.86) beats.push(t);
    const env = new Float64Array(timeToFrames(22)).fill(0.7);
    for (const b of beats) {
      env[timeToFrames(b)] = 8.7;
      if (b >= 10) env[timeToFrames(b + 0.45)] = 3.4;
    }
    const r3 = (x: number) => Math.round(x * 1000) / 1000;
    const set = new Set(beats.map(r3));
    const added = [...new Set(fillHalfTime(beats, env).map(r3))].filter((t) => !set.has(t)).sort((a, b) => a - b);
    expect(added.length && added.every((t) => t > 10)).toBeTruthy();
    expect(added.every((t) => beats.some((b) => Math.abs(t - (b + 0.45)) < 0.03))).toBe(true);
    expect(added.length).toBe(beats.slice(0, -1).filter((b) => b >= 10).length);
    const quiet = new Float64Array(timeToFrames(22)).fill(0.7);
    for (const b of beats) quiet[timeToFrames(b)] = 8.7;
    expect(fillHalfTime(beats, quiet).length).toBe(beats.length);
  });
});

describe("strong beats, bar starts and exact hits", () => {
  it("finds the bar starts from the kick, chords and bass", { timeout: 120_000 }, () => {
    const { y, downs, beats } = barSong(120, 16, 2);
    const r = accents(y, SR, beats);
    const found = downs.filter((d) => r.downbeats.some((x) => Math.abs(d - x) < 0.03)).length;
    expect(found).toBe(downs.length);
    expect(r.downbeatConfidence).toBeGreaterThanOrEqual(0.6);
    expect(r.strongBeats.length / beats.length).toBeGreaterThanOrEqual(0.18);
    expect(r.strongBeats.length / beats.length).toBeLessThanOrEqual(0.35);
    // at least a third of the bar starts are among the strong beats (this song's snare noise differs from the Python
    // test's; on this exact signal the Python code gives the same count: tests/server/accents.parity.test.ts)
    expect(r.strongBeats.filter((s) => downs.some((d) => Math.abs(s - d) < 0.03)).length).toBeGreaterThanOrEqual(Math.floor(downs.length / 3));
    expect([3, 4]).toContain(r.levels[2]);
    expect(r.levels[3]).toBe(2);
    expect(r.levels[0]).toBe(1);
    expect(r.levels.length).toBe(beats.length);
    expect(r.kick.length).toBe(beats.length);
  });

  it("moves beats onto their real hits; weak beats are not medium", { timeout: 120_000 }, () => {
    const { y, beats } = barSong(120, 16, 0);
    const off = beats.map((b) => b + 0.025);
    const [exact, clear] = snapToHits(y, SR, off);
    const err = exact.map((t, i) => Math.abs(t - beats[i])).slice(1);
    expect(clear.filter(Boolean).length / clear.length).toBeGreaterThan(0.9);
    expect(median(err)).toBeLessThan(0.003);
    expect(Math.max(...err)).toBeLessThan(0.012);
    const acc = accents(y, SR, off);
    expect(Math.abs(acc.beats![4] - beats[4])).toBeLessThan(0.006);
    const strong = new Set(acc.strongBeats), medium = new Set(acc.mediumBeats ?? []);
    expect([...strong].some((s) => medium.has(s))).toBe(false);
    expect(strong.size + medium.size).toBeLessThan(beats.length);
  });
});
