import fs from "node:fs";
import path from "node:path";
import { BEAT_THIS_SR, beatThisWith, BINS, MELS, type BeatThisResult } from "@shubix/core/lib/beatThis/core";

/** Beats and bar starts (downbeats) from "Beat This!" (Foscarin, Schlueter & Widmer, ISMIR 2024; CPJKU/beat_this,
 * checkpoint final0, MIT licence), run with ONNX Runtime on the CPU - a neural network trained on thousands of
 * hand-annotated songs. It finds the beats and the bar starts directly, so nothing has to be guessed afterwards.
 *
 * The reference pre- and post-processing lives in lib/beatThis/core.ts (shared with Fast Studio, which runs the same
 * model on the phone with onnxruntime-web). The model ships with the app (server/audio/data/beat-this): the official
 * checkpoint exported once to ONNX with a free number of frames (so a window is never padded with silence), weights
 * stored as 8-bit (23 MB); its beats match the official PyTorch pipeline (tests/server/audio/beatthis.test.ts). The mel
 * filterbank is torchaudio's, saved from the reference code. */

export { BEAT_THIS_SR, type BeatThisResult };
export const BEAT_THIS_DIR = path.join(process.cwd(), "src", "server", "audio", "data", "beat-this");
const DATA = BEAT_THIS_DIR;
/** the 8-bit model (default) or the full-precision one (BEAT_THIS_MODEL=fp32), for checking the two agree */
const modelName = () => (process.env.BEAT_THIS_MODEL === "fp32" ? "beat_this_final0.onnx" : "beat_this_final0.int8.onnx");

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

/** Beats and bar starts of mono 22 050 Hz samples (the mean of both channels). */
export async function beatThis(y: Float32Array): Promise<BeatThisResult> {
  const { ort, session, fb } = await load();
  return beatThisWith(y, fb, async (input, len) => {
    const res = await session.run({ spect: new ort.Tensor("float32", input, [1, len, MELS]) });
    return [Float32Array.from(res.beat.data as Float32Array), Float32Array.from(res.downbeat.data as Float32Array)];
  });
}

/** Starts loading the model without waiting. */
export const warmBeatThis = () => { load().catch(() => {}); };
