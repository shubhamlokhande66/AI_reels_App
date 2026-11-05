/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { runBeatThis } from "@mobile/core/lib/beatThis/device";
import { ortThreads } from "../ortThreads";
import { phoneFirst, type Native } from "../nativeModels";

/** Beat This! on the phone: the same 8-bit model and the same pre- / post-processing as the server
 * (lib/beatThis/core.ts), run with ONNX Runtime's WebAssembly backend in this worker so the page never stalls. The model
 * (23 MB) and the mel filterbank are downloaded once and kept in the browser's Cache Storage (Shared/core
 * lib/beatThis/device.ts: the same code runs in the phone app's engine page). */

type In = { id: number; samples: Float32Array; model: string; filterbank: string; wasm: string; native?: Native };

self.onmessage = async (e: MessageEvent<In>) => {
  const msg = e.data, post = (o: object) => (self as unknown as Worker).postMessage(o);
  try {
    const threads = ortThreads(self.crossOriginIsolated ? Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)) : 1);
    const { ms, ...result } = await runBeatThis(ort, msg.samples, { ...msg, open: (url, wasm, onP) => phoneFirst(msg.native, url, wasm, onP) }, threads, (stage, p) => post({ id: msg.id, type: "progress", stage, p }));
    post({ id: msg.id, type: "done", result, ms });
  } catch (err) {
    post({ id: msg.id, type: "error", message: String((err as Error)?.message ?? err) });
  }
};
