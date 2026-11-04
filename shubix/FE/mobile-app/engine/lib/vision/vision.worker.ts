/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { phoneFirst, type Native } from "../nativeModels";
import { ortThreads } from "../ortThreads";

/** Fast Studio's eyes on the phone, in a worker (ONNX Runtime WebAssembly): MediaPipe Selfie Segmentation (who is the
 * person: a 256x256 mask) and BlazeFace short range (where faces are), both Apache-2.0, converted to ONNX
 * (server/vision/data). Inputs arrive as RGBA pixels and are turned into the tensors each model wants here. */

type Msg =
  | { id: number; type: "seg"; rgba: Uint8ClampedArray; base: string; wasm: string; native?: Native }
  | { id: number; type: "face"; rgba: Uint8ClampedArray[]; base: string; wasm: string; native?: Native };
const CACHE = "brs-models-v1";
const sessions = new Map<string, Promise<ort.InferenceSession>>();

async function bytes(url: string): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
  const res = await fetch(url); if (!res.ok) throw new Error(`vision model download failed (${res.status})`);
  const b = new Uint8Array(await res.arrayBuffer());
  try { await cache?.put(url, new Response(b.slice().buffer, { headers: { "content-type": "application/octet-stream" } })); } catch { /* storage full */ }
  return b;
}
function session(name: string, base: string, wasm: string, native?: Native) {
  let s = sessions.get(name);
  if (!s) {
    ort.env.wasm.wasmPaths = wasm;
    ort.env.wasm.numThreads = ortThreads(self.crossOriginIsolated ? Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1);
    s = phoneFirst(native, base + name, () => bytes(base + name).then((b) => ort.InferenceSession.create(b, { executionProviders: ["wasm"], graphOptimizationLevel: "all" })));
    s.catch(() => sessions.delete(name)); sessions.set(name, s);
  }
  return s;
}
// BlazeFace short range: 896 anchors (16x16 cells x 2 at stride 8, 8x8 cells x 6 at stride 16), centres in [0,1]
const ANCH: Float32Array = (() => { const a: number[] = []; for (const [g, n] of [[16, 2], [8, 6]]) for (let y = 0; y < g; y++) for (let x = 0; x < g; x++) for (let k = 0; k < n; k++) a.push((x + 0.5) / g, (y + 0.5) / g); return Float32Array.from(a); })();
function tensor(rgba: Uint8ClampedArray, side: number, lo: number, hi: number) {
  const t = new Float32Array(side * side * 3), sc = (hi - lo) / 255;
  for (let i = 0, j = 0; i < side * side; i++, j += 4) { t[i * 3] = rgba[j] * sc + lo; t[i * 3 + 1] = rgba[j + 1] * sc + lo; t[i * 3 + 2] = rgba[j + 2] * sc + lo; }
  return new ort.Tensor("float32", t, [1, side, side, 3]);
}

self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data, post = (o: object, tr: Transferable[] = []) => (self as unknown as Worker).postMessage(o, tr);
  try {
    if (m.type === "seg") {
      const s = await session("selfie_segmentation.onnx", m.base, m.wasm, m.native);
      const o = await s.run({ input_1: tensor(m.rgba, 256, 0, 1) });
      const mask = Float32Array.from(o.activation_10.data as Float32Array);
      post({ id: m.id, type: "done", mask }, [mask.buffer]);
    } else {
      const s = await session("face_detection_short_range.onnx", m.base, m.wasm, m.native), all: number[][][] = [];
      for (const px of m.rgba) {
        const o = await s.run({ input: tensor(px, 128, -1, 1) });
        const reg = o.regressors.data as Float32Array, cls = o.classificators.data as Float32Array, found: number[][] = [];
        for (let k = 0; k < 896; k++) {
          const sc = 1 / (1 + Math.exp(-Math.max(-80, Math.min(80, cls[k])))); if (sc < 0.55) continue;
          const r = k * 16; found.push([sc, reg[r] / 128 + ANCH[k * 2], reg[r + 1] / 128 + ANCH[k * 2 + 1], reg[r + 2] / 128, reg[r + 3] / 128]);
        }
        all.push(found);   // [score, cx, cy, w, h] in the input square's fractions
      }
      post({ id: m.id, type: "done", faces: all });
    }
  } catch (err) {
    post({ id: m.id, type: "error", message: String((err as Error)?.message ?? err) });
  }
};
