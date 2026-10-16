import { BEAT_THIS_SR, type BeatThisResult } from "./core";

/** Fast Studio's on-device beat tracker: Beat This! in a worker (lib/beatThis/beatThis.worker.ts). The song is resampled
 * to 22 050 Hz here (the browser's own resampler), the network runs in the worker. Rejects when this device cannot run
 * it (no WebAssembly SIMD, too little memory, the model cannot be downloaded); the editor then keeps its own tracker. */

export const MODEL_URL = "/api/studio/model/beat_this_final0.int8.onnx";
export const FILTERBANK_URL = "/api/studio/model/mel-filterbank.bin";
export const WASM_BASE = "/vendor/ort/";

export type Progress = (stage: "download" | "run", p: number) => void;
export type OnDeviceBeats = BeatThisResult & { ms: { resample: number; load: number; run: number } };

let worker: Worker | null = null, nextId = 1;

/** WebAssembly SIMD (the runtime needs it): a tiny module using a v128 instruction must validate. */
function simdOk(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

export function canRunOnDevice(): boolean {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined" || !simdOk()) return false;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return !(mem !== undefined && mem < 2);   // under 2 GB: the 23 MB model plus the song would crowd the tab
}

async function resample(mono: Float32Array, sr: number): Promise<Float32Array> {
  if (sr === BEAT_THIS_SR) return mono.slice();
  const len = Math.ceil(mono.length * BEAT_THIS_SR / sr);
  try {
    const oc = new OfflineAudioContext(1, len, BEAT_THIS_SR), b = oc.createBuffer(1, mono.length, sr);
    b.copyToChannel(new Float32Array(mono), 0); const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
    return (await oc.startRendering()).getChannelData(0).slice();
  } catch {   // no OfflineAudioContext: linear interpolation
    const y = new Float32Array(len), r = sr / BEAT_THIS_SR;
    for (let i = 0; i < len; i++) { const t = i * r, k = Math.floor(t), f = t - k; y[i] = (mono[k] ?? 0) * (1 - f) + (mono[k + 1] ?? 0) * f; }
    return y;
  }
}

export async function beatThisOnDevice(mono: Float32Array, sr: number, onProgress?: Progress): Promise<OnDeviceBeats> {
  if (!canRunOnDevice()) throw new Error("this device cannot run the AI beat tracker");
  const t0 = performance.now();
  const samples = await resample(mono, sr);
  const tr = Math.round(performance.now() - t0);
  worker ??= new Worker(new URL("./beatThis.worker.ts", import.meta.url), { type: "module" });
  const w = worker, id = nextId++;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data; if (d.id !== id) return;
      if (d.type === "progress") { onProgress?.(d.stage, d.p); return; }
      w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr);
      if (d.type === "done") resolve({ ...d.result, ms: { resample: tr, ...d.ms } });
      else reject(new Error(d.message));
    };
    const onErr = (e: ErrorEvent) => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); worker = null; reject(new Error(e.message || "beat worker failed")); };
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
    w.postMessage({ id, samples, model: new URL(MODEL_URL, location.href).href, filterbank: new URL(FILTERBANK_URL, location.href).href, wasm: new URL(WASM_BASE, location.href).href }, [samples.buffer]);
  });
}
