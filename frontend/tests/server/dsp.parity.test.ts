// @vitest-environment node
import { describe, expect, it } from "vitest";
import { autocorrelate } from "@/server/audio/dsp/fft";
import { agglomerative } from "@/server/audio/dsp/segment";
import * as sp from "@/server/audio/dsp/spectral";
import { Mat, mean, percentile } from "@/server/audio/dsp/util";
import { python, rng } from "./parity";

/** The music analysis maths (server/audio/dsp) against librosa 1.0 itself: the same signal through both, every feature
 * compared (float32 vs float64 arithmetic: relative 1e-4; frame indices and segments exactly). */

function song(seconds: number, seed: number): Float32Array {
  const r = rng(seed);
  const sr = 22050, n = Math.floor(seconds * sr), y = new Float32Array(n);
  const beat = 60 / (96 + r.int(0, 50));
  for (let k = 0; k * beat < seconds; k++) {
    const i0 = Math.floor(k * beat * sr);
    for (let i = 0; i < 0.12 * sr && i0 + i < n; i++) {
      const t = i / sr;
      const kick = Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18);
      const snare = (r.next() * 2 - 1) * Math.exp(-t * 35) * 0.5;
      y[i0 + i] += k % 2 === 0 ? kick : snare;
    }
  }
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const chord = Math.floor(t / (beat * 4)) % 3;
    y[i] += 0.06 * [220, 277, 330].reduce((s, f) => s + Math.sin(2 * Math.PI * f * (1 + 0.06 * chord) * t), 0) + 0.01 * (r.next() * 2 - 1);
  }
  let m = 0;
  for (const v of y) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] = Math.fround(y[i] / m);
  return y;
}

/** max |a - b| relative to b's scale */
function rel(a: ArrayLike<number>, b: number[]): number {
  expect(a.length).toBe(b.length);
  let scale = 0, err = 0;
  for (let i = 0; i < b.length; i++) scale = Math.max(scale, Math.abs(b[i]));
  for (let i = 0; i < b.length; i++) err = Math.max(err, Math.abs(a[i] - b[i]));
  return err / Math.max(scale, 1e-12);
}

describe("DSP: the same numbers as librosa", () => {
  it("features of two synthetic songs", { timeout: 300_000 }, () => {
    const signals = [song(8, 1), song(8, 2)];
    const py = python<Record<string, number[] & number>>(signals.map((y) => ({ kind: "dsp", y: Array.from(y) })));
    if (!py) return;
    signals.forEach((y, k) => {
      const want = py[k];
      const S = sp.stftMag(y);
      expect([S.rows, S.cols]).toEqual(want.shape);
      expect(rel(S.data, want.S), "stft").toBeLessThan(1e-5);
      expect(rel(sp.melspectrogram(y).data, want.mel), "mel").toBeLessThan(1e-4);
      const env = sp.onsetStrength(y);
      expect(rel(env, want.env), "onset strength").toBeLessThan(1e-3);
      const freqs = sp.fftFrequencies();
      const lowRows = Array.from(freqs).filter((f) => f <= 150).length;
      expect(rel(sp.onsetStrengthS(sp.amplitudeToDb(S.slice(0, lowRows), "max")), want.bandOnset), "band onset").toBeLessThan(1e-3);
      expect(rel(sp.rmsY(y), want.rmsY), "rms(y)").toBeLessThan(1e-5);
      expect(rel(sp.rmsS(S), want.rmsS), "rms(S)").toBeLessThan(1e-5);
      expect(rel(sp.spectralCentroid(S), want.centroid), "centroid").toBeLessThan(1e-5);
      expect(rel(sp.spectralBandwidth(S), want.bandwidth), "bandwidth").toBeLessThan(1e-5);
      expect(rel(sp.spectralRolloff(S), want.rolloff), "rolloff").toBeLessThan(1e-9);
      expect(rel(sp.zeroCrossingRate(y), want.zcr), "zcr").toBeLessThan(1e-9);
      const Spow = S.map((v) => v * v);
      expect(sp.estimateTuning(Spow), "tuning").toBeCloseTo(want.tuning as unknown as number, 9);
      expect(rel(sp.chromaStft(Spow).data, want.chroma), "chroma").toBeLessThan(1e-4);
      const mf = sp.mfcc(y, sp.SR, 13, 2048);
      expect(rel(mf.data, want.mfcc), "mfcc").toBeLessThan(1e-4);
      expect(rel(sp.normalizeRows(mf).data, want.mfccNorm), "mfcc normalised").toBeLessThan(1e-4);
      expect(sp.tempo(Float64Array.from(want.env)), "tempo").toBeCloseTo(want.tempo as unknown as number, 6);
      expect(sp.onsetDetect(Float64Array.from(want.env)), "onset detect").toEqual(want.onsets);
      const e = Float64Array.from(want.env);
      expect(sp.peakPick(e, 6, 6, 12, 12, 0.4 * percentile(e, 97), 10), "peak pick").toEqual(want.peaks);
      const Sc = sp.stftMag(y, 1024, 1024);
      expect([Sc.rows, Sc.cols]).toEqual(want.percShape);
      const [H, P] = sp.hpss(Sc, [17, 17]);
      expect(rel(H.data, want.harm), "hpss harmonic").toBeLessThan(1e-4);
      expect(rel(P.data, want.perc), "hpss percussive").toBeLessThan(1e-4);
      const mfW = new Mat(13, want.mfcc.length / 13, Float64Array.from(want.mfcc));
      expect(agglomerative(mfW, 4), "segments").toEqual(want.segments);
      expect(agglomerative(sp.normalizeRows(mfW), 7), "segments (normalised)").toEqual(want.segments2);
      const m = mean(e);
      expect(rel(autocorrelate(e.map((v) => v - m)), want.ac), "autocorrelate").toBeLessThan(1e-6);
    });
  });
});
