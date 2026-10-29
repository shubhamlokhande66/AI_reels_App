/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { beatThisWith, BINS, MELS } from "@shubix/core/lib/beatThis/core";
import { ortThreads } from "../ortThreads";

/** Beat This! on the phone: the same 8-bit model and the same pre- / post-processing as the server
 * (lib/beatThis/core.ts), run with ONNX Runtime's WebAssembly backend in this worker so the page never stalls. The model
 * (23 MB) and the mel filterbank are downloaded once and kept in the browser's Cache Storage. */

type In = { id: number; samples: Float32Array; model: string; filterbank: string; wasm: string };
const CACHE = "brs-models-v1";
let ready: Promise<{ session: ort.InferenceSession; fb: Float32Array }> | null = null;

async function getBytes(url: string, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) { onProgress(1); return await hit.arrayBuffer(); } } catch { cache = null; }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 0, reader = res.body.getReader(), parts: Uint8Array[] = [];
  let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (total) onProgress(got / total); }
  const out = new Uint8Array(got); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  try { await cache?.put(url, new Response(out.slice().buffer, { headers: { "content-type": "application/octet-stream" } })); } catch { /* storage full: still works this time */ }
  onProgress(1);
  return out.buffer;
}

function load(msg: In, post: (o: object) => void) {
  ready ??= (async () => {
    ort.env.wasm.wasmPaths = msg.wasm;
    ort.env.wasm.numThreads = ortThreads(self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1);
    let pm = 0, pf = 0;
    const tell = () => post({ id: msg.id, type: "progress", stage: "download", p: 0.97 * pm + 0.03 * pf });
    const [model, fbBuf] = await Promise.all([getBytes(msg.model, (p) => { pm = p; tell(); }), getBytes(msg.filterbank, (p) => { pf = p; tell(); })]);
    const fb = new Float32Array(fbBuf);
    if (fb.length !== BINS * MELS) throw new Error("Beat This! mel filterbank has the wrong size");
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    return { session, fb };
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data, post = (o: object) => (self as unknown as Worker).postMessage(o);
  try {
    const t0 = performance.now();
    const { session, fb } = await load(msg, post);
    const t1 = performance.now();
    const result = await beatThisWith(msg.samples, fb, async (input, len) => {
      const res = await session.run({ spect: new ort.Tensor("float32", input, [1, len, MELS]) });
      return [Float32Array.from(res.beat.data as Float32Array), Float32Array.from(res.downbeat.data as Float32Array)];
    }, (done, total) => post({ id: msg.id, type: "progress", stage: "run", p: done / total }));
    post({ id: msg.id, type: "done", result, ms: { load: Math.round(t1 - t0), run: Math.round(performance.now() - t1) } });
  } catch (err) {
    post({ id: msg.id, type: "error", message: String((err as Error)?.message ?? err) });
  }
};
