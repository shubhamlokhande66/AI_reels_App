import "server-only";
import fs from "node:fs";
import path from "node:path";
import { rfftMag } from "./dsp/fft";

/** Beats and bar starts (downbeats) from "Beat This!" (Foscarin, Schlueter & Widmer, ISMIR 2024; CPJKU/beat_this,
 * checkpoint final0, MIT licence), run with ONNX Runtime on the CPU - a neural network trained on thousands of
 * hand-annotated songs. It finds the beats and the bar starts directly, so nothing has to be guessed afterwards.
 *
 * This file reproduces the reference inference exactly (beat_this/inference.py, model/postprocessor.py):
 *   samples: mono as the mean of the two channels, 22 050 Hz
 *   features: STFT n_fft 1024, hop 441 (50 frames / s), periodic Hann, centred with reflect padding, magnitude divided
 *     by sqrt(1024), 128 Slaney mel bands 30-11 000 Hz (the exported filterbank), log1p(1000 x)
 *   the network: 1500-frame windows (30 s), 6-frame borders, overlapping windows "keep_first", the last window shifted
 *     to end with the piece
 *   peaks: a frame is a beat when its logit > 0 and it is the maximum of the 7 frames around it; neighbouring peak
 *     frames are merged (mean); each downbeat is moved to its nearest beat.
 * The model ships with the app (server/audio/data/beat-this): the official checkpoint exported once to ONNX with a
 * free number of frames (so a window is never padded with silence), weights stored as 8-bit (23 MB); its beats match
 * the official PyTorch pipeline (tests/server/audio/beatthis.test.ts). The mel filterbank is torchaudio's, saved
 * from the reference code. */

const DATA = path.join(process.cwd(), "server", "audio", "data", "beat-this");
/** the 8-bit model (default) or the full-precision one (BEAT_THIS_MODEL=fp32), for checking the two agree */
const modelName = () => (process.env.BEAT_THIS_MODEL === "fp32" ? "beat_this_final0.onnx" : "beat_this_final0.int8.onnx");
export const BEAT_THIS_SR = 22050;
const N_FFT = 1024, HOP = 441, BINS = N_FFT / 2 + 1, MELS = 128, FPS = 50, LOG_MUL = 1000;
const CHUNK = 1500, BORDER = 6, PEAK_KERNEL = 7, DEDUP_WIDTH = 1;

export interface BeatThisResult {
  beats: number[];
  downbeats: number[];
  /** per beat: the network's probability for it (sigmoid of the logit at the peak), 0..1 */
  beatProbabilities: number[];
  downbeatProbabilities: number[];
}

type Ort = typeof import("onnxruntime-node");
type Session = import("onnxruntime-node").InferenceSession;
const g = globalThis as unknown as { __beatThis?: Promise<{ ort: Ort; session: Session; fb: Float32Array }>; __beatThisModel?: string };

/** The ONNX session and the mel filterbank, loaded once per process. */
function load() {
  if (g.__beatThisModel !== modelName()) delete g.__beatThis;
  g.__beatThisModel = modelName();
  g.__beatThis ??= (async () => {
    const ort: Ort = await import("onnxruntime-node");
    // one thread: a render (FFmpeg) running at the same time keeps the other CPU
    const session = await ort.InferenceSession.create(path.join(DATA, modelName()), { graphOptimizationLevel: "all", intraOpNumThreads: 1, interOpNumThreads: 1 });
    const buf = fs.readFileSync(path.join(DATA, "mel-filterbank.bin"));
    const fb = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); // [513][128], row-major
    if (fb.length !== BINS * MELS) throw new Error("Beat This! mel filterbank has the wrong size");
    return { ort, session, fb };
  })().catch((e) => { delete g.__beatThis; throw e; });
  return g.__beatThis;
}

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
async function predict(spect: Float32Array, frames: number, ort: Ort, session: Session): Promise<[Float32Array, Float32Array]> {
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
    const res = await session.run({ spect: new ort.Tensor("float32", input, [1, len, MELS]) });
    preds.push([Float32Array.from(res.beat.data as Float32Array), Float32Array.from(res.downbeat.data as Float32Array)]);
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
function peaks(logits: Float32Array): number[] {
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

/** Beats and bar starts of mono 22 050 Hz samples (the mean of both channels). */
export async function beatThis(y: Float32Array): Promise<BeatThisResult> {
  const { ort, session, fb } = await load();
  const frames = 1 + Math.floor(y.length / HOP);
  const [beatLogits, downLogits] = await predict(logMel(y, fb), frames, ort, session);
  const beatFrames = peaks(beatLogits), downFrames = peaks(downLogits);
  const beats = beatFrames.map((f) => f / FPS);
  // each downbeat onto its nearest beat, then unique
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

/** Starts loading the model without waiting. */
export const warmBeatThis = () => { load().catch(() => {}); };
