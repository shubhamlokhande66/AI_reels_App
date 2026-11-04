/** Fast Studio's speech finder on the phone (lib/vad/vad.worker.ts): the probability of speech every 32 ms of a sound.
 * The sound is resampled to 16 kHz here (the browser's own resampler); rejects when the model cannot run, and the editor
 * then falls back to loudness. */

export const VAD_MODEL_URL = "/api/studio/model/silero_vad_16k_op15.onnx";
export const VAD_HOP = 512 / 16000;
let worker: Worker | null = null, nextId = 1;

async function to16k(mono: Float32Array, sr: number): Promise<Float32Array> {
  if (sr === 16000) return mono.slice();
  const len = Math.ceil(mono.length * 16000 / sr);
  try {
    const oc = new OfflineAudioContext(1, len, 16000), b = oc.createBuffer(1, mono.length, sr);
    b.copyToChannel(new Float32Array(mono), 0); const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
    return (await oc.startRendering()).getChannelData(0).slice();
  } catch {
    const y = new Float32Array(len), r = sr / 16000;
    for (let i = 0; i < len; i++) { const t = i * r, k = Math.floor(t), f = t - k; y[i] = (mono[k] ?? 0) * (1 - f) + (mono[k + 1] ?? 0) * f; }
    return y;
  }
}

export async function speechProbs(mono: Float32Array, sr: number): Promise<Float32Array> {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") throw new Error("no WebAssembly here");
  const samples = await to16k(mono, sr);
  worker ??= new Worker("/w/vad.worker.js", { type: "module" });
  const w = worker, id = nextId++;
  return new Promise((resolve, reject) => {
    const done = () => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); };
    const onMsg = (e: MessageEvent) => { const d = e.data; if (d.id !== id || d.type === "progress") return; done(); if (d.type === "done") resolve(d.probs); else reject(new Error(d.message)); };
    const onErr = (e: ErrorEvent) => { done(); worker = null; reject(new Error(e.message || "speech worker failed")); };
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
    w.postMessage({ id, samples, model: new URL(VAD_MODEL_URL, location.href).href, wasm: new URL("/vendor/ort/", location.href).href }, [samples.buffer]);
  });
}
