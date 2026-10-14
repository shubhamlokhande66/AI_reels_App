// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyzeAudio } from "@/server/audio/analyzer";
import { decode } from "@/server/audio/decode";
import { essentiaBeats } from "@/server/audio/essentia";
import { detectTransients, type Transient } from "@/server/audio/transients";
import { findBinary } from "@/server/core/ffmpeg";
import type { AudioAnalysis } from "@/server/models/analysis";
import { rng } from "../rng";
import { SR, writeWav } from "./fixtures";

/** The analysis measured against a song whose every hit is known (ground truth), with the metrics beat-tracking research
 * uses (mir_eval): F-measure with a +-70 ms window (precision, recall), and the mean timing offset. Also the decoding and
 * encoder offset: the same song as WAV, MP3 and AAC must give the same times. */

const BPM = 100, BEAT = 60 / BPM, SECONDS = 40, START = 0.5;

/** One-to-one matching inside the window (greedy, closest first), as mir_eval does for beats and onsets. */
function score(est: number[], ref: number[], window = 0.07) {
  const pairs: [number, number, number][] = [];
  est.forEach((e, i) => ref.forEach((r, j) => { if (Math.abs(e - r) <= window) pairs.push([Math.abs(e - r), i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ue = new Set<number>(), ur = new Set<number>(), offsets: number[] = [];
  for (const [, i, j] of pairs) if (!ue.has(i) && !ur.has(j)) { ue.add(i); ur.add(j); offsets.push(est[i] - ref[j]); }
  const p = est.length ? ue.size / est.length : 0, r = ref.length ? ur.size / ref.length : 0;
  return { f: p + r ? (2 * p * r) / (p + r) : 0, precision: p, recall: r, meanOffsetMs: offsets.length ? (1000 * offsets.reduce((a, b) => a + b, 0)) / offsets.length : NaN };
}

const truth = { beats: [] as number[], bars: [] as number[], kicks: [] as number[], snares: [] as number[], hats: [] as number[] };
function drumSong(file: string) {
  const n = Math.round((SECONDS + 1) * SR), y = new Float32Array(n), r = rng(7), noise = () => r.next() * 2 - 1;
  const add = (t: number, len: number, f: (i: number) => number) => { const s = Math.round(t * SR); for (let i = 0; i < len && s + i < n; i++) y[s + i] += f(i); };
  let hp = 0, prev = 0; // a one-pole high-pass, for the hi-hat noise
  for (let k = 0; START + k * BEAT < SECONDS - 0.5; k++) {
    const t = START + k * BEAT, inBar = k % 4;
    truth.beats.push(t);
    if (inBar === 0) truth.bars.push(t);
    if (inBar === 0 || inBar === 2) { // kick: a 55 Hz body with a falling pitch, louder on the bar start
      truth.kicks.push(t);
      const g = inBar === 0 ? 0.9 : 0.55;
      add(t, Math.round(0.25 * SR), (i) => g * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-i / (0.03 * SR))) * (i / SR)) * Math.exp(-i / (0.09 * SR)));
    } else { // snare: noise and a 190 Hz tone
      truth.snares.push(t);
      add(t, Math.round(0.18 * SR), (i) => 0.45 * (0.7 * noise() + 0.3 * Math.sin(2 * Math.PI * 190 * (i / SR))) * Math.exp(-i / (0.045 * SR)));
    }
    for (const h of [t, t + BEAT / 2]) { // hi-hat on every eighth note (off-beats too)
      truth.hats.push(h);
      add(h, Math.round(0.04 * SR), (i) => { const x = noise(); hp = 0.85 * (hp + x - prev); prev = x; return 0.18 * hp * Math.exp(-i / (0.008 * SR)); });
    }
  }
  for (let i = 0; i < n; i++) y[i] += 0.002 * noise();
  writeWav(file, y);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gt_")), wav = path.join(dir, "drums.wav");
let analysis: AudioAnalysis;
const band = (ts: Transient[], b: Transient["band"]) => ts.filter((x) => x.band === b).map((x) => x.t);

beforeAll(async () => {
  drumSong(wav);
  analysis = await analyzeAudio(wav);
}, 600_000);

describe("analysis against ground truth (100 BPM drums, 4/4)", () => {
  it("keeps Essentia's beats exactly as detected", { timeout: 300_000 }, async () => {
    const raw = await essentiaBeats(await decode(wav, 44100));
    expect(analysis.beatSource).toBe("essentia");
    expect(analysis.beats).toEqual(raw.beats.filter((t) => t >= 0 && t <= analysis.duration + 0.05).map((t) => Math.round(t * 1000) / 1000));
  });

  it("finds the tempo, with two independent estimates that agree", () => {
    expect(analysis.bpm).toBeGreaterThan(BPM * 0.98);
    expect(analysis.bpm).toBeLessThan(BPM * 1.02);
    expect(analysis.bpmEstimates.percival).not.toBeNull();
    expect(analysis.bpmAgreement).toBe("agree");
  });

  it("tracks the beats (F-measure, 70 ms window)", () => {
    const s = score(analysis.beats, truth.beats);
    console.log("beats", JSON.stringify(s));
    expect(s.f).toBeGreaterThanOrEqual(0.9);
    expect(Math.abs(s.meanOffsetMs)).toBeLessThan(25); // Essentia's beat times are a little early: measured, never changed
  });

  it("finds the kick, snare and hi-hat attacks in their bands", () => {
    const low = score(band(analysis.transients, "low"), truth.kicks, 0.05);
    const mid = score(band(analysis.transients, "mid"), truth.snares, 0.05);
    const high = score(band(analysis.transients, "high"), truth.hats, 0.05);
    console.log("low", JSON.stringify(low), "\nmid", JSON.stringify(mid), "\nhigh", JSON.stringify(high));
    expect(low.f).toBeGreaterThanOrEqual(0.9);
    expect(mid.recall).toBeGreaterThanOrEqual(0.9); // a kick's attack reaches the mid band too: recall is the measure here
    expect(high.f).toBeGreaterThanOrEqual(0.9);
    for (const x of [low, mid, high]) expect(Math.abs(x.meanOffsetMs)).toBeLessThan(10);
  });

  it("keeps transients apart from beats: the off-beat hi-hats are transients, not beats", () => {
    const offBeats = truth.hats.filter((_, i) => i % 2 === 1);
    expect(score(band(analysis.transients, "high"), offBeats, 0.05).recall).toBeGreaterThanOrEqual(0.9);
    expect(score(analysis.beats, offBeats, 0.07).precision).toBeLessThan(0.1);
  });

  it("finds the meter and the bar starts from the louder first kick", () => {
    expect(analysis.meter).toBe(4);
    expect(score(analysis.downbeats, truth.bars).f).toBeGreaterThanOrEqual(0.85);
  });

  it("decodes at the real sample rate, with no offset from MP3 or AAC encoding", { timeout: 300_000 }, async () => {
    for (const sr of [22050, 44100]) expect(Math.abs((await decode(wav, sr)).length / sr - SECONDS - 1)).toBeLessThan(0.01);
    const ref = detectTransients(await decode(wav, SR), SR);
    for (const [ext, codec] of [["mp3", "libmp3lame"], ["m4a", "aac"]] as const) {
      const f = path.join(dir, `drums.${ext}`);
      execFileSync(findBinary("ffmpeg"), ["-y", "-loglevel", "error", "-i", wav, "-c:a", codec, "-b:a", "192k", f]);
      const enc = detectTransients(await decode(f, SR), SR);
      const s = score(band(enc, "low"), band(ref, "low"), 0.02);
      console.log(ext, "offset vs WAV (ms):", s.meanOffsetMs.toFixed(2), "matched:", s.recall.toFixed(2));
      expect(s.recall).toBeGreaterThanOrEqual(0.95);
      expect(Math.abs(s.meanOffsetMs)).toBeLessThan(3);
    }
  });
});

describe("bar phase with a missed beat", () => {
  it("keeps the bar starts after a beat the tracker missed", async () => {
    const { barPhase, beatPositions } = await import("@/server/audio/beats");
    const all = Array.from({ length: 40 }, (_, i) => 1 + i * 0.5);
    const levels = all.map((_, i) => (i % 4 === 0 ? -5 : -12));
    const missed = 17; // a beat in the middle of bar 5 is missing
    const beats = all.filter((_, i) => i !== missed), lv = levels.filter((_, i) => i !== missed);
    expect(beatPositions(beats)[missed]).toBe(missed + 1);
    const bar = barPhase(beats, lv)!;
    expect(bar).toMatchObject({ meter: 4, phase: 0 });
    expect(bar.confidence).toBeGreaterThan(0.9);
  });
});
