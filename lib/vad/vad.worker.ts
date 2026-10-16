/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";

/** Where people speak, on the phone: Silero VAD v6 (MIT, 1.3 MB, 16 kHz) run with ONNX Runtime's WebAssembly backend in
 * this worker. In: 16 kHz mono. Out: the probability of speech for every 32 ms (512 samples), as Silero's own wrapper
 * computes it (each window sees the 64 samples before it). The model is kept in the browser's Cache Storage. */

type In = { id: number; samples: Float32Array; model: string; wasm: string };
const CACHE = "brs-models-v1", WIN = 512, CTX = 64;
let ready: Promise<ort.InferenceSession> | null = null;

async function bytes(url: string): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`speech model download failed (${res.status})`);
  const b = new Uint8Array(await res.arrayBuffer());
  try { await cache?.put(url, new Response(b.slice().buffer, { headers: { "content-type": "application/octet-stream" } })); } catch { /* storage full: works this time */ }
  return b;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data, post = (o: object) => (self as unknown as Worker).postMessage(o);
  try {
    ready ??= (async () => {
      ort.env.wasm.wasmPaths = msg.wasm; ort.env.wasm.numThreads = 1;   // tiny model: one thread is fastest
      return ort.InferenceSession.create(await bytes(msg.model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    })().catch((err) => { ready = null; throw err; });
    const session = await ready, x = msg.samples, n = Math.floor(x.length / WIN), probs = new Float32Array(n);
    let state: ort.Tensor = new ort.Tensor("float32", new Float32Array(2 * 128), [2, 1, 128]);
    const sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(16000)]), []), inp = new Float32Array(CTX + WIN);
    for (let k = 0; k < n; k++) {
      inp.fill(0, 0, CTX); if (k) inp.set(x.subarray(k * WIN - CTX, k * WIN), 0);
      inp.set(x.subarray(k * WIN, (k + 1) * WIN), CTX);
      const o = await session.run({ input: new ort.Tensor("float32", inp.slice(), [1, CTX + WIN]), state, sr });
      probs[k] = (o.output.data as Float32Array)[0]; state = o.stateN as ort.Tensor;
      if (k % 200 === 199) post({ id: msg.id, type: "progress", p: k / n });
    }
    post({ id: msg.id, type: "done", probs });
  } catch (err) {
    post({ id: msg.id, type: "error", message: String((err as Error)?.message ?? err) });
  }
};
