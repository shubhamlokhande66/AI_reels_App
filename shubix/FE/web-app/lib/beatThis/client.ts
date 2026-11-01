import type { BeatThisResult } from "@shubix/core/lib/beatThis/core";
import { FILTERBANK_PATH, MODEL_PATH, resample, simdOk } from "@shubix/core/lib/beatThis/device";
import { isIOS } from "../ortThreads";

/** Fast Studio's on-device beat tracker: Beat This! in a worker (lib/beatThis/beatThis.worker.ts). The song is resampled
 * to 22 050 Hz here (the browser's own resampler), the network runs in the worker. Rejects when this device cannot run
 * it (no WebAssembly SIMD, too little memory, the model cannot be downloaded); the editor then keeps its own tracker. */

export const MODEL_URL = MODEL_PATH;
export const FILTERBANK_URL = FILTERBANK_PATH;
export const WASM_BASE = "/vendor/ort/";

export type Progress = (stage: "download" | "run", p: number) => void;
export type OnDeviceBeats = BeatThisResult & { ms: { resample: number; load: number; run: number } };

// waiting: the requests the current worker still owes an answer (a new song can be picked while one is checked)
let worker: Worker | null = null, nextId = 1, waiting = 0;

export function canRunOnDevice(): boolean {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined" || !simdOk()) return false;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  return !(mem !== undefined && mem < 2);   // under 2 GB: the 23 MB model plus the song would crowd the tab
}

export async function beatThisOnDevice(mono: Float32Array, sr: number, onProgress?: Progress): Promise<OnDeviceBeats> {
  if (!canRunOnDevice()) throw new Error("this device cannot run the AI beat tracker");
  const t0 = performance.now();
  const samples = await resample(mono, sr);
  const tr = Math.round(performance.now() - t0);
  worker ??= new Worker(new URL("./beatThis.worker.ts", import.meta.url), { type: "module" });
  const w = worker, id = nextId++;
  waiting++;
  // an iPhone: the worker goes once nothing more is asked of it. Its WebAssembly memory (the model, a few hundred MB)
  // never shrinks, and the clips and the Reel need it next; the model stays in Cache Storage, so the next song loads
  // fast. Not while another request waits on it (a second song picked meanwhile): that one would never be answered.
  const settle = () => { waiting = Math.max(0, waiting - 1); if (isIOS() && waiting === 0 && worker === w) { w.terminate(); worker = null; } };
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data; if (d.id !== id) return;
      if (d.type === "progress") { onProgress?.(d.stage, d.p); return; }
      w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr);
      settle();
      if (d.type === "done") resolve({ ...d.result, ms: { resample: tr, ...d.ms } });
      else reject(new Error(d.message));
    };
    const onErr = (e: ErrorEvent) => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); if (worker === w) worker = null; settle(); reject(new Error(e.message || "beat worker failed")); };
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
    w.postMessage({ id, samples, model: new URL(MODEL_URL, location.href).href, filterbank: new URL(FILTERBANK_URL, location.href).href, wasm: new URL(WASM_BASE, location.href).href }, [samples.buffer]);
  });
}
