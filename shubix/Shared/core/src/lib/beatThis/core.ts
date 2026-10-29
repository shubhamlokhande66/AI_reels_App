import { rfftMag } from "../../engine/audio/dsp/fft";

/** "Beat This!" (Foscarin, Schlueter & Widmer, ISMIR 2024; CPJKU/beat_this, checkpoint final0, MIT licence) without
 * the runtime: the exact reference pre- and post-processing, shared by the server (onnxruntime-node,
 * server/audio/beatThis.ts) and the phone (onnxruntime-web, lib/beatThis/beatThis.worker.ts), so both give the same beats.
 *
 *   samples: mono as the mean of the two channels, 22 050 Hz
 *   features: STFT n_fft 1024, hop 441 (50 frames / s), periodic Hann, centred with reflect padding, magnitude divided
 *     by sqrt(1024), 128 Slaney mel bands 30-11 000 Hz (the exported filterbank), log1p(1000 x)
 *   the network: 1500-frame windows (30 s), 6-frame borders, overlapping windows "keep_first", the last window shifted
 *     to end with the piece
 *   peaks: a frame is a beat when its logit > 0 and it is the maximum of the 7 frames around it; neighbouring peak
 *     frames are merged (mean); each downbeat is moved to its nearest beat. */

export const BEAT_THIS_SR = 22050;
export const N_FFT = 1024, HOP = 441, BINS = N_FFT / 2 + 1, MELS = 128, FPS = 50, LOG_MUL = 1000;
const CHUNK = 1500, BORDER = 6, PEAK_KERNEL = 7, DEDUP_WIDTH = 1;

export interface BeatThisResult {
  beats: number[];
  downbeats: number[];
  /** per beat: the network's probability for it (sigmoid of the logit at the peak), 0..1 */
  beatProbabilities: number[];
  downbeatProbabilities: number[];
}

/** Runs the network on one window: input [frames][128] row-major -> [beat logits, downbeat logits] per frame. */
export type RunWindow = (input: Float32Array, frames: number) => Promise<[Float32Array, Float32Array]>;

/** The log-mel spectrogram: [frames][128], frames = 1 + floor(samples / 441). */
export function logMel(y: Float32Array, fb: Float32Array): Float32Array {
  const pad = N_FFT / 2, n = y.length, frames = 1 + Math.floor(n / HOP);
  const out = new Float32Array(frames * MELS);
  const win = Float64Array.from({ length: N_FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)); // periodic Hann
  const frame = new Float64Array(N_FFT), mag = new Float64Array(BINS), re = new Float64Array(N_FFT / 2), im = new Float64Array(N_FFT / 2);
  const reflect = (k: number) => (k < 0 ? -k : k >= n ? 2 * (n - 1) - k : k);
  const norm = 1 / Math.sqrt(N_FFT);
  for (let t = 0; t < frames; t++) {
    const off = t * HOP - pad;
    for (let i = 0; i < N_FFT; i++) {
      const k = reflect(off + i);
      frame[i] = (k >= 0 && k < n ? y[k] : 0) * win[i];
    }
    rfftMag(frame, mag, re, im);
    const row = t * MELS;
    for (let f = 0; f < BINS; f++) {
      const m = mag[f] * norm;
      if (m === 0) continue;
      const fr = f * MELS;
      for (let b = 0; b < MELS; b++) out[row + b] += m * fb[fr + b];
    }
    for (let b = 0; b < MELS; b++) out[row + b] = Math.log1p(LOG_MUL * out[row + b]);
  }
  return out;
}

/** split_piece (avoid_short_end) -> the model -> aggregate_prediction (keep_first): a logit per frame. */
export async function predict(spect: Float32Array, frames: number, run: RunWindow, onWindow?: (done: number, total: number) => void): Promise<[Float32Array, Float32Array]> {
  const starts: number[] = [];
  for (let s = -BORDER; s < frames - BORDER; s += CHUNK - 2 * BORDER) starts.push(s);
  if (frames > CHUNK - 2 * BORDER) starts[starts.length - 1] = frames - (CHUNK - BORDER);
  const beat = new Float32Array(frames).fill(-1000), down = new Float32Array(frames).fill(-1000);
  const preds: [Float32Array, Float32Array][] = [];
  for (const start of starts) {
    // the chunk, zero-padded on the left (before the piece) and on the right up to the border
    const from = Math.max(start, 0), to = Math.min(start + CHUNK, frames), left = Math.max(0, -start);
    const right = Math.max(0, Math.min(BORDER, start + CHUNK - frames));
    const len = left + (to - from) + right;
    const input = new Float32Array(len * MELS); // exactly as long as the chunk (the model takes any number of frames)
    input.set(spect.subarray(from * MELS, to * MELS), left * MELS);
    preds.push(await run(input, len));
    onWindow?.(preds.length, starts.length);
  }
  // keep_first: later windows are written first, so the earlier window wins where they overlap
  for (let k = starts.length - 1; k >= 0; k--) {
    const [b, d] = preds[k], start = starts[k];
    const kb = b.subarray(BORDER, b.length - BORDER), kd = d.subarray(BORDER, d.length - BORDER);
    for (let i = 0; i < kb.length; i++) {
      const at = start + BORDER + i;
      if (at >= 0 && at < frames) { beat[at] = kb[i]; down[at] = kd[i]; }
    }
  }
  return [beat, down];
}

/** Peak frames (logit > 0, the maximum of the 7 frames around it), neighbours merged into their mean frame. */
export function peaks(logits: Float32Array): number[] {
  const half = PEAK_KERNEL >> 1, idx: number[] = [];
  for (let i = 0; i < logits.length; i++) {
    if (!(logits[i] > 0)) continue;
    let max = -Infinity;
    for (let k = Math.max(0, i - half); k <= Math.min(logits.length - 1, i + half); k++) max = Math.max(max, logits[k]);
    if (logits[i] === max) idx.push(i);
  }
  const out: number[] = []; // deduplicate_peaks(width=1): a running mean of each run of close frames
  let p = idx[0], c = 1;
  for (let k = 1; k < idx.length; k++) {
    if (idx[k] - p <= DEDUP_WIDTH) { c += 1; p += (idx[k] - p) / c; }
    else { out.push(p); p = idx[k]; c = 1; }
  }
  if (idx.length) out.push(p);
  return out;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const at = (logits: Float32Array, frame: number) => logits[Math.min(Math.max(Math.round(frame), 0), logits.length - 1)];

/** Logits -> beats, downbeats (each on its nearest beat) and their probabilities, in seconds. */
export function toResult(beatLogits: Float32Array, downLogits: Float32Array): BeatThisResult {
  const beatFrames = peaks(beatLogits), downFrames = peaks(downLogits);
  const beats = beatFrames.map((f) => f / FPS);
  const downs = [...new Set(downFrames.map((f) => {
    const t = f / FPS;
    return beats.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), beats[0] ?? t);
  }))].sort((a, b) => a - b);
  const r3 = (t: number) => Math.round(t * 1000) / 1000;
  return {
    beats: beats.map(r3),
    downbeats: downs.map(r3),
    beatProbabilities: beatFrames.map((f) => r3(sigmoid(at(beatLogits, f)))),
    downbeatProbabilities: downs.map((t) => r3(sigmoid(at(downLogits, t * FPS)))),
  };
}

/** The whole pipeline for mono 22 050 Hz samples, with the network supplied by the caller. */
export async function beatThisWith(y: Float32Array, fb: Float32Array, run: RunWindow, onWindow?: (done: number, total: number) => void): Promise<BeatThisResult> {
  const frames = 1 + Math.floor(y.length / HOP);
  const [b, d] = await predict(logMel(y, fb), frames, run, onWindow);
  return toResult(b, d);
}
