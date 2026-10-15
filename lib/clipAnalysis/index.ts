import type { ClipAnalysis } from "@/server/models/clip";

/** Clips measured on the person's own device (light, sharpness, motion, shake, faces, best moments) with the server's
 * analysis code, in a background thread, while they upload: the server then has nothing to analyse. Never throws: null
 * means this device could not do it (an old browser, an unusual file), and the server analyses that clip as before. */

const TIMEOUT_MS = 5 * 60_000;
type Reply = { id: number; progress?: number; ok?: boolean; analysis?: ClipAnalysis; error?: string };

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, { resolve: (a: ClipAnalysis | null) => void; progress?: (f: number) => void }>();
let queue: Promise<unknown> = Promise.resolve(); // one clip at a time: a phone has a few cores, and the upload needs one

/** Can this browser analyse clips itself? (WebCodecs decoding, workers, offscreen canvases) */
export const canAnalyzeHere = () =>
  typeof window !== "undefined" && typeof Worker !== "undefined" && typeof VideoDecoder !== "undefined" && typeof OffscreenCanvas !== "undefined";

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./clipAnalysis.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<Reply>) => {
    const w = waiting.get(e.data.id);
    if (!w) return;
    if (e.data.progress !== undefined && e.data.ok === undefined) return w.progress?.(e.data.progress);
    waiting.delete(e.data.id);
    if (!e.data.ok) console.warn("clip analysed on the server instead:", e.data.error);
    w.resolve(e.data.ok ? e.data.analysis ?? null : null);
  };
  worker.onerror = (e) => { // the worker itself broke (e.g. it could not load): every waiting clip goes to the server
    console.warn("clip analysis in the browser is unavailable:", e.message);
    for (const w of waiting.values()) w.resolve(null);
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** The clip's analysis made on this device, or null (then the server makes it). */
export function analyzeInBrowser(file: Blob, clipId: string, onProgress?: (f: number) => void): Promise<ClipAnalysis | null> {
  if (!canAnalyzeHere()) return Promise.resolve(null);
  const run = queue.then(() => new Promise<ClipAnalysis | null>((resolve) => {
    let w: Worker;
    try { w = getWorker(); } catch { return resolve(null); }
    const id = ++seq;
    const timer = setTimeout(() => { if (waiting.delete(id)) resolve(null); }, TIMEOUT_MS);
    waiting.set(id, { resolve: (a) => { clearTimeout(timer); resolve(a); }, progress: onProgress });
    w.postMessage({ id, file, clipId });
  }));
  queue = run.catch(() => null);
  return run.catch(() => null);
}
