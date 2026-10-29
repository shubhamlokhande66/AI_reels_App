import { fftFrequencies, stftMag } from "./dsp/spectral";

/** Transients: the attacks of percussive hits, per frequency band, each with a time and a strength (0..1).
 * A transient is not a beat (it can fall between beats) and not every onset (a soft note change is an onset but rarely an
 * attack worth cutting on): this list is kept apart from both.
 *
 * Method: band energy in short frames (1024-point STFT, 5.8 ms hop at 22.05 kHz); the attack function is the rise of the
 * band's level in dB over ~17 ms; a hit is a local maximum of that rise above an adaptive threshold (the local median plus
 * a multiple of the local spread, and a minimum rise), on a band that is not in silence. Each hit is then placed on the
 * steepest rise of a 1 ms energy envelope near the frame, because a band's frame energy starts rising a little before the
 * real attack (the analysis window reaches it first). */

export type Band = "low" | "mid" | "high";
export interface Transient { t: number; band: Band; strength: number }

const N_FFT = 1024, HOP = 128;
const BANDS: Record<Band, [number, number]> = { low: [30, 150], mid: [150, 4000], high: [6000, 11000] }; // kick / snare, clap, voice attacks / hi-hat, cymbals
const RISE_FRAMES = 3; // the rise is measured against the quietest of the last 3 frames (~17 ms)
const LOCAL_S = 0.75, K_SPREAD = 2.0, MIN_RISE_DB = 6, MIN_GAP_S = 0.05, PEAK_S = 0.035, FLOOR_ABOVE_DB = 6;
const BELOW_LOUD_DB = 35; // a hit is at most this far below the band's loud level (noise between hits never counts)
const BELOW_LOCAL_DB = 20, LOCAL_LOUD_S = 1.5; // and peaks within 20 dB of the band's loudest hit in the 1.5 s around it:
// another instrument's spill into the band (a snare's faint low end, in the kick band) is not a hit of that band
const REFINE_BEFORE_S = 0.03, REFINE_AFTER_S = 0.01, FINE_S = 0.001;

const quantile = (xs: Float64Array | number[], q: number) => {
  if (!xs.length) return 0;
  const s = Float64Array.from(xs).sort(), pos = q * (s.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Sliding median and median absolute deviation over +-w frames (sampled every `step` frames, then held). */
function localStats(x: Float64Array, w: number, step = 8): [Float64Array, Float64Array] {
  const n = x.length, med = new Float64Array(n), spread = new Float64Array(n);
  for (let c = 0; c < n; c += step) {
    const win = x.subarray(Math.max(0, c - w), Math.min(n, c + w + 1)), m = quantile(win, 0.5);
    const dev = quantile(Float64Array.from(win, (v) => Math.abs(v - m)), 0.5);
    for (let i = c; i < Math.min(n, c + step); i++) { med[i] = m; spread[i] = dev; }
  }
  return [med, spread];
}

/** Sliding maximum over +-w frames (sampled every `step` frames, then held). */
function localMax(x: Float64Array, w: number, step = 8): Float64Array {
  const n = x.length, out = new Float64Array(n);
  for (let c = 0; c < n; c += step) {
    let m = -Infinity;
    for (let k = Math.max(0, c - w); k < Math.min(n, c + w + 1); k++) m = Math.max(m, x[k]);
    for (let i = c; i < Math.min(n, c + step); i++) out[i] = m;
  }
  return out;
}

/** Energy of the signal in ~1 ms steps, in dB (the timing reference for each hit), and the exact step in seconds. */
function fineEnvelopeDb(y: Float32Array, sr: number): [Float64Array, number] {
  const step = Math.max(1, Math.round(FINE_S * sr)), n = Math.ceil(y.length / step), out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    let e = 0;
    for (let i = k * step; i < Math.min(y.length, (k + 1) * step); i++) e += y[i] * y[i];
    out[k] = 10 * Math.log10(e / step + 1e-12);
  }
  return [out, step / sr]; // the real step (22 samples at 22.05 kHz is 0.998 ms, not 1 ms)
}

/** The steepest rise of the 1 ms envelope near t: the attack time. */
function refine(t: number, fine: Float64Array, dt: number): number {
  const a = Math.max(1, Math.floor((t - REFINE_BEFORE_S) / dt)), b = Math.min(fine.length - 1, Math.ceil((t + REFINE_AFTER_S) / dt));
  let best = -Infinity, at = t;
  for (let k = a; k <= b; k++) {
    const rise = fine[k] - fine[k - 1];
    if (rise > best) { best = rise; at = k * dt; }
  }
  return at;
}

export function detectTransients(y: Float32Array, sr: number): Transient[] {
  if (y.length < N_FFT * 4) return [];
  const S = stftMag(y, N_FFT, HOP, 2), freqs = fftFrequencies(sr, N_FFT), nFrames = S.cols, frameS = HOP / sr;
  const [fine, dt] = fineEnvelopeDb(y, sr), out: Transient[] = [];
  for (const band of Object.keys(BANDS) as Band[]) {
    const [lo, hi] = BANDS[band], bins = [...freqs.keys()].filter((i) => freqs[i] >= lo && freqs[i] < Math.min(hi, sr / 2));
    if (!bins.length) continue;
    const db = new Float64Array(nFrames);
    for (let t = 0; t < nFrames; t++) {
      let e = 0;
      for (const f of bins) e += S.data[f * nFrames + t];
      db[t] = 10 * Math.log10(e + 1e-12);
    }
    const rise = new Float64Array(nFrames);
    for (let t = RISE_FRAMES; t < nFrames; t++) {
      let low = Infinity;
      for (let k = 1; k <= RISE_FRAMES; k++) low = Math.min(low, db[t - k]);
      rise[t] = Math.max(0, db[t] - low);
    }
    const [med, spread] = localStats(rise, Math.round(LOCAL_S / frameS));
    const floor = Math.max(quantile(db, 0.2) + FLOOR_ABOVE_DB, quantile(db, 0.95) - BELOW_LOUD_DB), peakW = Math.round(PEAK_S / frameS);
    const near = localMax(db, Math.round(LOCAL_LOUD_S / frameS));
    const cands: [number, number][] = [];
    for (let t = 1; t < nFrames - 1; t++) {
      const r = rise[t], thr = Math.max(MIN_RISE_DB, med[t] + K_SPREAD * Math.max(spread[t], 0.5));
      if (r < thr || db[t] < floor) continue;
      let isMax = true;
      for (let k = Math.max(0, t - peakW); k <= Math.min(nFrames - 1, t + peakW) && isMax; k++) if (rise[k] > r || (rise[k] === r && k < t)) isMax = false;
      if (!isMax) continue;
      let peak = db[t];
      for (let k = t; k <= Math.min(nFrames - 1, t + peakW); k++) peak = Math.max(peak, db[k]);
      if (peak >= near[t] - BELOW_LOCAL_DB) cands.push([t, r]);
    }
    if (!cands.length) continue;
    const top = Math.max(quantile(cands.map(([, r]) => r), 0.95), MIN_RISE_DB);
    let last = -Infinity;
    for (const [t, r] of cands) {
      const time = refine(t * frameS, fine, dt);
      if (time - last < MIN_GAP_S) continue;
      last = time;
      out.push({ t: Math.round(time * 1000) / 1000, band, strength: Math.round(Math.min(1, r / top) * 1000) / 1000 });
    }
  }
  return out.sort((a, b) => a.t - b.t || a.band.localeCompare(b.band));
}

/** All bands merged: one hit per 30 ms, the strongest (for features that need "an impact here", not its band). */
export function mergedHits(ts: Transient[], within = 0.03): [number[], number[]] {
  const times: number[] = [], strengths: number[] = [];
  for (const x of ts) {
    const i = times.length - 1;
    if (i >= 0 && x.t - times[i] < within) { if (x.strength > strengths[i]) { times[i] = x.t; strengths[i] = x.strength; } }
    else { times.push(x.t); strengths.push(x.strength); }
  }
  return [times, strengths];
}
