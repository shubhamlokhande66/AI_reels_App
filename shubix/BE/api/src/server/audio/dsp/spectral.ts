import { autocorrelate, isPow2, rfftMag } from "@shubix/core/engine/audio/dsp/fft";
import { argmax, clip, linspace, Mat, max as vmax, mean, median, medianFilter1d, percentile, TINY32, vec, type Vec } from "./util";

/** librosa 1.0's spectral features, reproduced (backend/.venv/.../librosa): same windows, padding, filterbanks,
 * dB conversion and frame indexing, so the music rules tuned on librosa's curves read the same numbers. Spectrograms
 * are Mat(bins x frames). Checked against librosa in tests/server/dsp.parity.test.ts. */

export const SR = 22050;

// ---------------------------------------------------------------- frames and time
/** librosa.time_to_frames: int(t * sr) // hop. */
export const timeToFrames = (t: number, sr = SR, hop = 512) => Math.floor(Math.trunc(t * sr) / hop);
/** librosa.frames_to_time. */
export const framesToTime = (f: number, sr = SR, hop = 512) => (Math.trunc(f) * hop) / sr;

// ---------------------------------------------------------------- the STFT
const windows = new Map<number, Float64Array>();
/** scipy.signal.get_window("hann", n, fftbins=True): the periodic Hann window. */
export function hann(n: number): Float64Array {
  let w = windows.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    windows.set(n, w);
  }
  return w;
}

const stftCache = new WeakMap<object, Map<string, Mat>>();

/** |stft(y)|**power (center, zero padding, periodic Hann): bins (n_fft/2+1) x frames (1 + len(y) // hop). The magnitude
 * is kept per signal (one analysis computes the same spectrogram for several features); treat the result as read-only. */
export function stftMag(y: ArrayLike<number>, nFft = 2048, hop = 512, power = 1): Mat {
  if (!isPow2(nFft)) throw new Error("n_fft must be a power of two");
  const key = `${nFft}:${hop}`;
  let perSignal = stftCache.get(y as object);
  if (!perSignal) stftCache.set(y as object, (perSignal = new Map()));
  let S = perSignal.get(key);
  if (!S) {
    const pad = nFft / 2;
    const nFrames = 1 + Math.floor((y.length + 2 * pad - nFft) / hop);
    const bins = nFft / 2 + 1;
    S = new Mat(bins, nFrames);
    const w = hann(nFft);
    const frame = new Float64Array(nFft), mag = new Float64Array(bins);
    const re = new Float64Array(nFft / 2), im = new Float64Array(nFft / 2);
    for (let t = 0; t < nFrames; t++) {
      const off = t * hop - pad;
      for (let i = 0; i < nFft; i++) {
        const k = off + i;
        frame[i] = k >= 0 && k < y.length ? y[k] * w[i] : 0;
      }
      rfftMag(frame, mag, re, im);
      // librosa stores complex64: the magnitude in float32
      for (let f = 0; f < bins; f++) S.data[f * nFrames + t] = Math.fround(mag[f]);
    }
    perSignal.set(key, S);
  }
  if (power === 1) return S;
  return S.map((v) => (power === 2 ? v * v : v ** power));
}

/** numpy.fft.rfftfreq(n_fft, 1/sr). */
export function fftFrequencies(sr = SR, nFft = 2048): Vec {
  const out = vec(nFft / 2 + 1);
  for (let i = 0; i < out.length; i++) out[i] = (i * sr) / nFft;
  return out;
}

// ---------------------------------------------------------------- mel
const F_SP = 200 / 3, MIN_LOG_HZ = 1000, MIN_LOG_MEL = MIN_LOG_HZ / F_SP, LOGSTEP = Math.log(6.4) / 27;
export const hzToMel = (f: number) => (f >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP : f / F_SP);
export const melToHz = (m: number) => (m >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL)) : F_SP * m);

const melCache = new Map<string, Mat>();
/** librosa.filters.mel (Slaney scale and norm, float32 weights). */
export function melBasis(sr = SR, nFft = 2048, nMels = 128, fmin = 0, fmax = sr / 2): Mat {
  const key = `${sr}:${nFft}:${nMels}:${fmin}:${fmax}`;
  const hit = melCache.get(key);
  if (hit) return hit;
  const bins = nFft / 2 + 1;
  const fftf = fftFrequencies(sr, nFft);
  const melf = linspace(hzToMel(fmin), hzToMel(fmax), nMels + 2).map(melToHz);
  const W = new Mat(nMels, bins);
  for (let i = 0; i < nMels; i++) {
    const enorm = 2 / (melf[i + 2] - melf[i]);
    for (let f = 0; f < bins; f++) {
      const lower = -(melf[i] - fftf[f]) / (melf[i + 1] - melf[i]);
      const upper = (melf[i + 2] - fftf[f]) / (melf[i + 2] - melf[i + 1]);
      W.data[i * bins + f] = Math.fround(Math.fround(Math.max(0, Math.min(lower, upper))) * enorm);
    }
  }
  melCache.set(key, W);
  return W;
}

/** W (m x f) @ S (f x t). */
export function matmul(W: Mat, S: Mat): Mat {
  const out = new Mat(W.rows, S.cols);
  for (let m = 0; m < W.rows; m++) {
    const o = out.data.subarray(m * S.cols, (m + 1) * S.cols);
    for (let f = 0; f < W.cols; f++) {
      const w = W.data[m * W.cols + f];
      if (!w) continue;
      const s = S.data.subarray(f * S.cols, (f + 1) * S.cols);
      for (let t = 0; t < S.cols; t++) o[t] += w * s[t];
    }
  }
  return out;
}

export const melspectrogram = (y: ArrayLike<number>, sr = SR, nFft = 2048, hop = 512, power = 2, nMels = 128) =>
  matmul(melBasis(sr, nFft, nMels), stftMag(y, nFft, hop, power));

// ---------------------------------------------------------------- dB
/** librosa.power_to_db (ref a number, or "max" of the whole matrix; top_db below the matrix's maximum). */
export function powerToDb(S: Mat, ref: number | "max" = 1, amin = 1e-10, topDb: number | null = 80): Mat {
  const refValue = ref === "max" ? S.max() : Math.abs(ref);
  const sub = 10 * Math.log10(Math.max(amin, refValue));
  const out = S.map((v) => 10 * Math.log10(Math.max(amin, v)) - sub);
  if (topDb !== null) {
    const floor = out.max() - topDb;
    for (let i = 0; i < out.data.length; i++) if (out.data[i] < floor) out.data[i] = floor;
  }
  return out;
}

/** librosa.amplitude_to_db. */
export function amplitudeToDb(S: Mat, ref: number | "max" = 1, amin = 1e-5, topDb: number | null = 80): Mat {
  const refValue = ref === "max" ? S.max() : Math.abs(ref);
  return powerToDb(S.map((v) => v * v), refValue * refValue, amin * amin, topDb);
}

/** amplitude_to_db of a 1-D curve. */
export const amplitudeToDb1 = (x: ArrayLike<number>, ref = 1, amin = 1e-5, topDb: number | null = 80): Vec =>
  amplitudeToDb(new Mat(1, x.length, Float64Array.from(x)), ref, amin, topDb).data;

// ---------------------------------------------------------------- onsets
/** librosa.onset.onset_strength(S=S): the mean over bins of the positive frame-to-frame rise, padded as librosa pads
 * (lag + n_fft // (2 hop) zeros at the start) and cut to the frame count. */
export function onsetStrengthS(S: Mat, nFft = 2048, hop = 512, lag = 1): Vec {
  const T = S.cols;
  const pad = lag + Math.floor(nFft / (2 * hop));
  const out = vec(T);
  for (let t = lag; t < T; t++) {
    let s = 0;
    for (let f = 0; f < S.rows; f++) {
      const d = S.data[f * T + t] - S.data[f * T + t - lag];
      if (d > 0) s += d;
    }
    const k = t - lag + pad;
    if (k < T) out[k] = s / S.rows;
  }
  return out;
}

/** librosa.onset.onset_strength(y=y): on the mel spectrogram in dB. */
export const onsetStrength = (y: ArrayLike<number>, sr = SR, hop = 512, nFft = 2048) => onsetStrengthS(powerToDb(melspectrogram(y, sr, nFft, hop)), nFft, hop);

/** librosa.util.peak_pick (greedy). */
export function peakPick(x: ArrayLike<number>, preMax: number, postMax: number, preAvg: number, postAvg: number, delta: number, wait: number): number[] {
  [preMax, postMax, preAvg, postAvg, wait] = [preMax, postMax, preAvg, postAvg, wait].map((v) => Math.ceil(v));
  const n = x.length;
  const peaks: number[] = [];
  if (!n) return peaks;
  let first = x[0] >= vmax(x, 0, Math.min(postMax, n));
  first = first && x[0] >= mean(x, 0, Math.min(postAvg, n)) + delta;
  if (first) peaks.push(0);
  let i = first ? wait + 1 : 1;
  while (i < n) {
    const maxn = vmax(x, Math.max(0, i - preMax), Math.min(i + postMax, n));
    if (x[i] !== maxn) { i += 1; continue; }
    const avgn = mean(x, Math.max(0, i - preAvg), Math.min(i + postAvg, n));
    if (!(x[i] >= avgn + delta)) { i += 1; continue; }
    peaks.push(i);
    i += wait + 1;
  }
  return peaks;
}

/** librosa.onset.onset_detect(onset_envelope=env): normalised envelope, librosa's default peak-picking windows. */
export function onsetDetect(env: ArrayLike<number>, sr = SR, hop = 512): number[] {
  const lo = Math.min(...Array.from(env));
  const e = Float64Array.from(env, (v) => v - lo);
  const hi = vmax(e) + TINY32; // tiny of the envelope's float32
  for (let i = 0; i < e.length; i++) e[i] /= hi;
  if (!e.some((v) => v !== 0) || !e.every(Number.isFinite)) return [];
  const fl = (s: number) => Math.floor(s * sr / hop);
  return peakPick(e, fl(0.03), 0 + 1, fl(0.1), fl(0.1) + 1, 0.07, fl(0.03));
}

// ---------------------------------------------------------------- energy and spectral shape
/** librosa.feature.rms(y=y) (center, zero padding). */
export function rmsY(y: ArrayLike<number>, frameLength = 2048, hop = 512): Vec {
  const pad = Math.floor(frameLength / 2);
  const n = 1 + Math.floor((y.length + 2 * pad - frameLength) / hop);
  const out = vec(n);
  for (let t = 0; t < n; t++) {
    let s = 0;
    const off = t * hop - pad;
    for (let i = 0; i < frameLength; i++) {
      const k = off + i;
      if (k >= 0 && k < y.length) { const v = Math.fround(y[k]); s += Math.fround(v * v); }
    }
    out[t] = Math.sqrt(Math.fround(s / frameLength));
  }
  return out;
}

/** librosa.feature.rms(S=S) from a magnitude spectrogram. */
export function rmsS(S: Mat, frameLength = 2048): Vec {
  const T = S.cols, out = vec(T);
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (let f = 0; f < S.rows; f++) {
      let x = S.data[f * T + t] ** 2;
      if (f === 0 || (frameLength % 2 === 0 && f === S.rows - 1)) x *= 0.5;
      s += x;
    }
    out[t] = Math.sqrt((2 * s) / frameLength ** 2);
  }
  return out;
}

/** S normalised per frame (norm=1) as librosa.util.normalize does (a frame summing below tiny is left as it is). */
function l1Col(S: Mat, t: number): number {
  let s = 0;
  for (let f = 0; f < S.rows; f++) s += Math.abs(S.data[f * S.cols + t]);
  return s < TINY32 ? 1 : s;
}

export function spectralCentroid(S: Mat, sr = SR, nFft = 2 * (S.rows - 1)): Vec {
  const freq = fftFrequencies(sr, nFft);
  const T = S.cols, out = vec(T);
  for (let t = 0; t < T; t++) {
    const len = l1Col(S, t);
    let s = 0;
    for (let f = 0; f < S.rows; f++) s += freq[f] * (S.data[f * T + t] / len);
    out[t] = s;
  }
  return out;
}

export function spectralBandwidth(S: Mat, sr = SR, nFft = 2 * (S.rows - 1), p = 2): Vec {
  const freq = fftFrequencies(sr, nFft);
  const c = spectralCentroid(S, sr, nFft);
  const T = S.cols, out = vec(T);
  for (let t = 0; t < T; t++) {
    const len = l1Col(S, t);
    let s = 0;
    for (let f = 0; f < S.rows; f++) s += (S.data[f * T + t] / len) * Math.abs(freq[f] - c[t]) ** p;
    out[t] = s ** (1 / p);
  }
  return out;
}

export function spectralRolloff(S: Mat, sr = SR, nFft = 2 * (S.rows - 1), roll = 0.85): Vec {
  const freq = fftFrequencies(sr, nFft);
  const T = S.cols, out = vec(T);
  for (let t = 0; t < T; t++) {
    let total = 0;
    for (let f = 0; f < S.rows; f++) total += S.data[f * T + t];
    const thr = roll * total;
    let acc = 0, best = NaN;
    for (let f = 0; f < S.rows; f++) {
      acc += S.data[f * T + t];
      if (!(acc < thr)) { best = freq[f]; break; }
    }
    out[t] = best;
  }
  return out;
}

/** librosa.feature.zero_crossing_rate (center: edge padding). */
export function zeroCrossingRate(y: ArrayLike<number>, frameLength = 2048, hop = 512): Vec {
  const pad = Math.floor(frameLength / 2);
  const n = 1 + Math.floor((y.length + 2 * pad - frameLength) / hop);
  const at = (k: number) => y[k < 0 ? 0 : k >= y.length ? y.length - 1 : k];
  const sgn = (v: number) => (Math.abs(v) <= 1e-10 ? false : v < 0); // signbit, values within the threshold count as +0
  const out = vec(n);
  for (let t = 0; t < n; t++) {
    let c = 0;
    const off = t * hop - pad;
    for (let i = 1; i < frameLength; i++) if (sgn(at(off + i - 1)) !== sgn(at(off + i))) c++;
    out[t] = c / frameLength;
  }
  return out;
}

// ---------------------------------------------------------------- chroma and pitch
/** librosa.estimate_tuning(S=S) via piptrack (fmin 150, fmax 4000, threshold 0.1) and a 0.01-resolution histogram. */
export function estimateTuning(S: Mat, sr = SR, nFft = 2 * (S.rows - 1), binsPerOctave = 12): number {
  const F = S.rows, T = S.cols;
  const freqs = fftFrequencies(sr, nFft);
  const pitches: number[] = [], mags: number[] = [];
  for (let t = 0; t < T; t++) {
    let colMax = 0;
    for (let f = 0; f < F; f++) colMax = Math.max(colMax, S.data[f * T + t]);
    const ref = 0.1 * colMax;
    const masked = (f: number) => { const v = S.data[f * T + t]; return v > ref ? v : 0; };
    for (let f = 1; f < F - 1; f++) {
      if (!(freqs[f] >= 150 && freqs[f] < Math.min(4000, sr / 2))) continue;
      const v = masked(f);
      if (!(v > masked(f - 1) && v >= masked(f + 1))) continue; // localmax
      const x0 = S.data[f * T + t], xm = S.data[(f - 1) * T + t], xp = S.data[(f + 1) * T + t];
      const a = xp + xm - 2 * x0, b = (xp - xm) / 2;
      const shift = Math.abs(b) >= Math.abs(a) ? 0 : -b / a;
      const avg = (xp - xm) / 2; // np.gradient inside the array
      pitches.push(((f + shift) * sr) / nFft);
      mags.push(x0 + 0.5 * avg * shift);
    }
  }
  if (!pitches.length) return 0;
  const thr = median(mags);
  const freqsKept = pitches.filter((p, i) => mags[i] >= thr && p > 0);
  if (!freqsKept.length) return 0;
  const nb = Math.ceil(1 / 0.01) + 1;
  const edges = linspace(-0.5, 0.5, nb);
  const counts = new Array(nb - 1).fill(0);
  for (const fr of freqsKept) {
    let r = (binsPerOctave * Math.log2(fr / (440 / 16))) % 1;
    if (r < 0) r += 1;
    if (r >= 0.5) r -= 1;
    // numpy.histogram: [e_i, e_i+1), the last bin closed
    let k = Math.floor((r - edges[0]) / (edges[1] - edges[0]));
    if (k >= nb - 1) k = nb - 2;
    if (k < 0) continue;
    if (r < edges[k]) k -= 1;
    else if (k + 1 < nb - 1 && r >= edges[k + 1]) k += 1;
    if (k >= 0) counts[k]++;
  }
  return edges[argmax(counts)];
}

/** librosa.filters.chroma (2-octave Gaussian around C5, base C). */
export function chromaBasis(sr: number, nFft: number, tuning = 0, nChroma = 12): Mat {
  const ctroct = 5, octwidth = 2;
  const freqs = Float64Array.from({ length: nFft - 1 }, (_, i) => (i + 1) * (sr / nFft)); // linspace(0, sr, n_fft, endpoint=False)[1:]
  const A440 = 440 * 2 ** (tuning / nChroma);
  const frq = new Float64Array(nFft);
  for (let i = 0; i < nFft - 1; i++) frq[i + 1] = nChroma * Math.log2(freqs[i] / (A440 / 16));
  frq[0] = frq[1] - 1.5 * nChroma;
  const bw = new Float64Array(nFft);
  for (let i = 0; i < nFft - 1; i++) bw[i] = Math.max(frq[i + 1] - frq[i], 1);
  bw[nFft - 1] = 1;
  const half = Math.round(nChroma / 2);
  const W = new Mat(nChroma, nFft);
  for (let c = 0; c < nChroma; c++) {
    for (let f = 0; f < nFft; f++) {
      let D = frq[f] - c;
      D = ((((D + half + 10 * nChroma) % nChroma) + nChroma) % nChroma) - half;
      W.data[c * nFft + f] = Math.exp(-0.5 * ((2 * D) / bw[f]) ** 2);
    }
  }
  for (let f = 0; f < nFft; f++) { // normalise each column (L2), then the octave weighting
    let s = 0;
    for (let c = 0; c < nChroma; c++) s += W.data[c * nFft + f] ** 2;
    const len = Math.sqrt(s) < 2.2250738585072014e-308 ? 1 : Math.sqrt(s);
    const oct = Math.exp(-0.5 * ((frq[f] / nChroma - ctroct) / octwidth) ** 2);
    for (let c = 0; c < nChroma; c++) W.data[c * nFft + f] = (W.data[c * nFft + f] / len) * oct;
  }
  const shift = 3 * Math.floor(nChroma / 12); // roll -3: base C
  const bins = Math.floor(1 + nFft / 2);
  const out = new Mat(nChroma, bins);
  for (let c = 0; c < nChroma; c++) for (let f = 0; f < bins; f++) out.data[c * bins + f] = Math.fround(W.data[((c + shift) % nChroma) * nFft + f]);
  return out;
}

/** librosa.feature.chroma_stft(S=power spectrogram): tuning estimated, each frame normalised to its maximum. */
export function chromaStft(Spow: Mat, sr = SR): Mat {
  const nFft = 2 * (Spow.rows - 1);
  const C = matmul(chromaBasis(sr, nFft, estimateTuning(Spow, sr, nFft)), Spow);
  for (let t = 0; t < C.cols; t++) {
    let m = 0;
    for (let c = 0; c < C.rows; c++) m = Math.max(m, Math.abs(C.data[c * C.cols + t]));
    const len = m < TINY32 ? 1 : m;
    for (let c = 0; c < C.rows; c++) C.data[c * C.cols + t] /= len;
  }
  return C;
}

// ---------------------------------------------------------------- MFCC
/** librosa.feature.mfcc: dB mel spectrogram, DCT-II (orthonormal) over the mel bands, the first n. */
export function mfcc(y: ArrayLike<number>, sr = SR, nMfcc = 20, hop = 512): Mat {
  const S = powerToDb(melspectrogram(y, sr, 2048, hop));
  const M = S.rows, T = S.cols;
  const out = new Mat(nMfcc, T);
  for (let k = 0; k < nMfcc; k++) {
    const scale = 2 * (k === 0 ? Math.sqrt(1 / (4 * M)) : Math.sqrt(1 / (2 * M))); // scipy dct type 2, norm "ortho"
    for (let t = 0; t < T; t++) {
      let s = 0;
      for (let m = 0; m < M; m++) s += S.data[m * T + t] * Math.cos((Math.PI * k * (2 * m + 1)) / (2 * M));
      out.data[k * T + t] = Math.fround(s * scale);
    }
  }
  return out;
}

/** librosa.util.normalize(X, axis=1) (norm=inf along each row). */
export function normalizeRows(X: Mat): Mat {
  const out = new Mat(X.rows, X.cols, X.data.slice());
  for (let r = 0; r < X.rows; r++) {
    let m = 0;
    for (let c = 0; c < X.cols; c++) m = Math.max(m, Math.abs(X.data[r * X.cols + c]));
    const len = m < TINY32 ? 1 : m;
    for (let c = 0; c < X.cols; c++) out.data[r * X.cols + c] /= len;
  }
  return out;
}

// ---------------------------------------------------------------- tempo
/** librosa.feature.tempo(onset_envelope=env): the mean tempogram (8 s windows) weighted by a log-normal prior at 120. */
export function tempo(env: ArrayLike<number>, sr = SR, hop = 512, startBpm = 120, stdBpm = 1, acSize = 8, maxTempo = 320): number {
  const win = timeToFrames(acSize, sr, hop);
  const n = env.length;
  const half = Math.floor(win / 2);
  // linear_ramp padding to 0 at both ends
  const padded = new Float64Array(n + 2 * half);
  for (let i = 0; i < half; i++) padded[i] = (n ? env[0] : 0) * (i / half);
  for (let i = 0; i < n; i++) padded[half + i] = env[i];
  for (let i = 0; i < half; i++) padded[half + n + i] = (n ? env[n - 1] : 0) * (1 - (i + 1) / half);
  const w = hann(win);
  const meanAc = new Float64Array(win);
  const frame = new Float64Array(win);
  for (let t = 0; t < n; t++) {
    for (let i = 0; i < win; i++) frame[i] = padded[t + i] * w[i];
    const ac = autocorrelate(frame);
    let m = 0;
    for (let i = 0; i < win; i++) m = Math.max(m, Math.abs(ac[i]));
    const len = m < 2.2250738585072014e-308 ? 1 : m;
    for (let i = 0; i < win; i++) meanAc[i] += ac[i] / len;
  }
  for (let i = 0; i < win; i++) meanAc[i] /= Math.max(n, 1);
  const bpms = new Float64Array(win);
  bpms[0] = Infinity;
  for (let i = 1; i < win; i++) bpms[i] = (60 * sr) / (hop * i);
  let maxIdx = 0;
  for (let i = 0; i < win; i++) if (bpms[i] < maxTempo) { maxIdx = i; break; }
  let best = -Infinity, k = 0;
  for (let i = 0; i < win; i++) {
    const prior = i < maxIdx ? -Infinity : -0.5 * ((Math.log2(bpms[i]) - Math.log2(startBpm)) / stdBpm) ** 2;
    const v = Math.log1p(1e6 * meanAc[i]) + prior;
    if (v > best) { best = v; k = i; }
  }
  return bpms[k];
}

// ---------------------------------------------------------------- harmonic / percussive
/** librosa.decompose.hpss on a magnitude spectrogram: median filters across time (harmonic) and across frequency
 * (percussive), soft masks (power 2, margin 1). */
export function hpss(S: Mat, kernel: [number, number] = [31, 31]): [Mat, Mat] {
  const F = S.rows, T = S.cols;
  const harm = new Mat(F, T), perc = new Mat(F, T);
  for (let f = 0; f < F; f++) harm.data.set(medianFilter1d(S.data.subarray(f * T, (f + 1) * T), kernel[0]), f * T);
  const col = new Float64Array(F);
  for (let t = 0; t < T; t++) {
    for (let f = 0; f < F; f++) col[f] = S.data[f * T + t];
    const m = medianFilter1d(col, kernel[1]);
    for (let f = 0; f < F; f++) perc.data[f * T + t] = m[f];
  }
  const H = new Mat(F, T), P = new Mat(F, T);
  for (let i = 0; i < S.data.length; i++) {
    const h = harm.data[i], p = perc.data[i];
    const z = Math.max(h, p);
    if (z < TINY32) { H.data[i] = 0.5 * S.data[i]; P.data[i] = 0.5 * S.data[i]; continue; } // split zeros
    const mh = (h / z) ** 2, mp = (p / z) ** 2;
    H.data[i] = S.data[i] * (mh / (mh + mp));
    P.data[i] = S.data[i] * (mp / (mp + mh));
  }
  return [H, P];
}

export { clip, percentile, mean, median };
