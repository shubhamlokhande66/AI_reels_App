import { beatThisWith, BEAT_THIS_SR, BINS, MELS, type BeatThisResult } from "./core";

/** Beat This! on a device, in a browser engine (the website's worker FE/web-app/lib/beatThis, the phone's hidden engine
 * page Shared/core engine/studio/host.ts): the song resampled to 22 050 Hz by the browser's own resampler, the 8-bit
 * model and the mel filterbank downloaded once and kept in Cache Storage, the network run with ONNX Runtime's
 * WebAssembly backend (`ort`: onnxruntime-web, passed in by the caller). */
export const MODEL_PATH = "/api/studio/model/beat_this_final0.int8.onnx";
export const FILTERBANK_PATH = "/api/studio/model/mel-filterbank.bin";
export type Progress = (stage: "download" | "run", p: number) => void;
// onnxruntime-web (the caller's copy: its types are the caller's package's)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ort = any;
type Session = { run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: unknown }>> };
const CACHE = "brs-models-v1";
type Urls = { model: string; filterbank: string; wasm: string; headers?: Record<string, string>; open?: (url: string, wasm: () => Promise<Session>, onProgress: (p: number) => void) => Promise<Session> };

/** WebAssembly SIMD (the runtime needs it): a tiny module using a v128 instruction must validate. */
export function simdOk(): boolean {
  try {
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch { return false; }
}

/** The song at Beat This!'s rate (OfflineAudioContext; without it, linear interpolation). */
export async function resample(mono: Float32Array, sr: number): Promise<Float32Array> {
  if (sr === BEAT_THIS_SR) return mono.slice();
  const len = Math.ceil(mono.length * BEAT_THIS_SR / sr);
  try {
    const oc = new OfflineAudioContext(1, len, BEAT_THIS_SR), b = oc.createBuffer(1, mono.length, sr);
    b.copyToChannel(mono as Float32Array<ArrayBuffer>, 0); const s = oc.createBufferSource(); s.buffer = b; s.connect(oc.destination); s.start();
    return (await oc.startRendering()).getChannelData(0).slice();
  } catch {
    const y = new Float32Array(len), r = sr / BEAT_THIS_SR;
    for (let i = 0; i < len; i++) { const t = i * r, k = Math.floor(t), f = t - k; y[i] = (mono[k] ?? 0) * (1 - f) + (mono[k + 1] ?? 0) * f; }
    return y;
  }
}

/** A file, from Cache Storage when it was downloaded before (progress 0…1 while downloading; `headers`: the phone app's sign-in). */
export async function getBytes(url: string, onProgress: (p: number) => void, headers?: Record<string, string>): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) { onProgress(1); return await hit.arrayBuffer(); } } catch { cache = null; }
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0, reader = res.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (total) onProgress(got / total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  try { await cache?.put(url, new Response(out.slice().buffer, { headers: { "content-type": "application/octet-stream" } })); } catch { /* storage full: still works this time */ }
  onProgress(1);
  return out.buffer;
}

let ready: Promise<{ session: Session; fb: Float32Array }> | null = null;
/** The model, loaded once (`wasm`: where ONNX Runtime's WebAssembly files are; `threads`: its threads). */
function load(ort: Ort, urls: Urls, threads: number, onProgress: Progress) {
  ready ??= (async () => {
    ort.env.wasm.wasmPaths = urls.wasm;
    ort.env.wasm.numThreads = threads;
    let pm = 0, pf = 0;
    const tell = () => onProgress("download", 0.97 * pm + 0.03 * pf);
    const onModel = (p: number) => { pm = p; tell(); };
    const wasm = async (): Promise<Session> => ort.InferenceSession.create(new Uint8Array(await getBytes(urls.model, onModel, urls.headers)), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    const fbBuf = await getBytes(urls.filterbank, (p) => { pf = p; tell(); }, urls.headers), fb = new Float32Array(fbBuf);
    if (fb.length !== BINS * MELS) throw new Error("Beat This! mel filterbank has the wrong size");
    return { session: await (urls.open ? urls.open(urls.model, wasm, onModel) : wasm()), fb };
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

/** The beats of `samples` (at 22 050 Hz), with the load and run times. */
export async function runBeatThis(ort: Ort, samples: Float32Array, urls: Urls, threads: number, onProgress: Progress): Promise<BeatThisResult & { ms: { load: number; run: number } }> {
  const t0 = performance.now();
  const { session, fb } = await load(ort, urls, threads, onProgress);
  const t1 = performance.now();
  const result = await beatThisWith(samples, fb, async (input, len) => {
    const res = await session.run({ spect: new ort.Tensor("float32", input, [1, len, MELS]) });
    return [Float32Array.from(res.beat.data as Float32Array), Float32Array.from(res.downbeat.data as Float32Array)];
  }, (done, total) => onProgress("run", done / total));
  return { ...result, ms: { load: Math.round(t1 - t0), run: Math.round(performance.now() - t1) } };
}
