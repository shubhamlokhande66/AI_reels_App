import "server-only";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

/** Face detection spread over a few worker threads (face-worker.cjs; Haar cascades are slow in WebAssembly). The pool
 * is kept alive between clips so OpenCV loads once per worker. */

export type FaceBox = [number, number, number, number];
type Pending = { resolve: (b: FaceBox | null) => void; reject: (e: Error) => void };
interface Slot { worker: Worker; busy: number }

const g = globalThis as unknown as { __faces?: Slot[]; __faceSeq?: number; __facePending?: Map<number, Pending> };
const SIZE = Math.max(1, Math.min(3, os.availableParallelism() - 1));

function pool(): Slot[] {
  const pending = (g.__facePending ??= new Map());
  if (!g.__faces) {
    g.__faces = [];
    for (let i = 0; i < SIZE; i++) spawnSlot(pending);
  }
  return g.__faces;
}

function spawnSlot(pending: Map<number, Pending>) {
  const worker = new Worker(path.join(process.cwd(), "server", "video", "face-worker.cjs"), { workerData: { dataDir: path.join(process.cwd(), "server", "video", "data") } });
  worker.unref();
  const slot: Slot = { worker, busy: 0 };
  worker.on("message", (m: { id: number; ok: boolean; box?: FaceBox | null; error?: string }) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    slot.busy--;
    if (m.ok) p.resolve(m.box ?? null);
    else p.reject(new Error(`Face detection failed: ${m.error?.split("\n")[0]}`));
  });
  const drop = () => { g.__faces = g.__faces?.filter((s) => s !== slot); if (!g.__faces?.length) g.__faces = undefined; };
  worker.on("error", drop);
  worker.on("exit", drop);
  g.__faces!.push(slot);
}

/** The largest face (x, y, w, h in pixels) in one small frame, or null. Frames are copied to the worker. */
export function findFace(gray: Uint8Array, bgr: Uint8Array, w: number, h: number): Promise<FaceBox | null> {
  const slots = pool();
  const slot = slots.reduce((a, b) => (b.busy < a.busy ? b : a), slots[0]);
  const id = (g.__faceSeq = (g.__faceSeq ?? 0) + 1);
  slot.busy++;
  return new Promise((resolve, reject) => {
    g.__facePending!.set(id, { resolve, reject });
    slot.worker.postMessage({ id, gray: gray.slice(), bgr: bgr.slice(), w, h });
  });
}
