import "server-only";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { AppError } from "@/server/core/errors";

/** Essentia's beat tracking and onsets, each in its own worker thread (they run side by side; the server stays free).
 * One worker per task, kept alive between songs (loading the WebAssembly once). */

export interface EssentiaBeats {
  bpm: number;
  beats: number[];
  /** RhythmExtractor2013's confidence: 0..5.32 (above ~3.5 very sure, below ~1.5 unsure) */
  confidence: number;
  estimates: number[];
}

type Task = "beats" | "onsets";
const g = globalThis as unknown as { __essentia?: Partial<Record<Task, Worker>>; __essentiaSeq?: number };

function worker(task: Task): Worker {
  const pool = (g.__essentia ??= {});
  let w = pool[task];
  if (!w) {
    w = new Worker(path.join(process.cwd(), "server", "audio", "essentia-worker.cjs"));
    w.unref(); // never keeps the process alive on its own
    w.on("error", () => { delete pool[task]; });
    w.on("exit", () => { delete pool[task]; });
    pool[task] = w;
  }
  return w;
}

function run<T>(task: Task, samples: Float32Array): Promise<T> {
  const w = worker(task);
  const id = (g.__essentiaSeq = (g.__essentiaSeq ?? 0) + 1);
  return new Promise<T>((resolve, reject) => {
    const onMessage = (m: { id: number; ok: boolean; out: T; error?: string }) => {
      if (m.id !== id) return;
      w.off("message", onMessage);
      if (m.ok) resolve(m.out);
      else reject(new AppError(`Essentia failed: ${m.error?.split("\n")[0]}`, { code: "BEAT_TRACKING_FAILED", status: 500 }));
    };
    w.on("message", onMessage);
    w.postMessage({ id, task, samples: samples.slice() }); // a copy: the caller keeps its samples
  });
}

/** Beats and tempo of mono 44.1 kHz samples (RhythmExtractor2013, multifeature). */
export const essentiaBeats = (samples44k: Float32Array) => run<EssentiaBeats>("beats", samples44k);

/** Onsets (s) of mono 44.1 kHz samples (SuperFlux). */
export const essentiaOnsets = async (samples44k: Float32Array) => (await run<{ onsets: number[] }>("onsets", samples44k)).onsets;
