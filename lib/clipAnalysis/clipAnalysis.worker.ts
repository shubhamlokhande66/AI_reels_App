/// <reference lib="webworker" />
import { analyzeFrames, VIDEO_ANALYSIS_VERSION, type FaceBox } from "@/server/video/clipAnalysisCore";
import { findFaceIn } from "@/server/video/faceFind";
import { openClip } from "./browserFrames";
import { loadOpenCv } from "./opencv";

/** The clip analysis in a background thread of the browser, so the page stays smooth: each clip sent here is measured
 * with the server's own code (server/video/clipAnalysisCore.ts). Faces, the slowest step, go to helper threads
 * (face.worker.ts) on devices with the cores and memory for them, else they are found here.
 * In: { id, file, clipId }. Out: { id, progress } while it works, then { id, ok, analysis } or { id, ok: false, error }. */

const post = (m: unknown) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

// ---- face helpers: two on a device with >= 6 cores and >= 4 GB (each holds its own OpenCV), none on smaller ones
type Pending = { resolve: (b: FaceBox | null) => void; reject: (e: Error) => void };
interface Helper { worker: Worker; busy: number }
const nav = self.navigator as Navigator & { deviceMemory?: number };
const HELPERS = (nav.hardwareConcurrency ?? 2) >= 6 && (nav.deviceMemory ?? 4) >= 4 ? 2 : 0;
let helpers: Helper[] | null = null, faceSeq = 0;
const pending = new Map<number, Pending>();

function faceHelpers(): Helper[] {
  if (helpers) return helpers;
  helpers = [];
  if (!HELPERS || typeof Worker === "undefined") return helpers; // no nested workers here: faces are found inline
  try {
    for (let i = 0; i < HELPERS; i++) {
      const worker = new Worker(new URL("./face.worker.ts", import.meta.url), { type: "module" });
      const h: Helper = { worker, busy: 0 };
      worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; box?: FaceBox | null; error?: string }>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        pending.delete(e.data.id);
        h.busy--;
        if (e.data.ok) p.resolve(e.data.box ?? null);
        else p.reject(new Error(e.data.error));
      };
      helpers.push(h);
    }
  } catch {
    helpers = [];
  }
  return helpers;
}

async function findFace(gray: Uint8Array, bgr: Uint8Array, w: number, h: number): Promise<FaceBox | null> {
  const pool = faceHelpers();
  if (pool.length) {
    const helper = pool.reduce((a, b) => (b.busy < a.busy ? b : a), pool[0]);
    const id = ++faceSeq;
    helper.busy++;
    try {
      return await new Promise<FaceBox | null>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        helper.worker.postMessage({ id, gray: gray.slice(), bgr: bgr.slice(), w, h });
      });
    } catch { /* that helper failed: find it here */ }
  }
  const { cv, cascades } = await loadOpenCv();
  return findFaceIn(cv, cascades, gray, bgr, w, h);
}

self.onmessage = async (e: MessageEvent<{ id: number; file: Blob; clipId: string }>) => {
  const { id, file, clipId } = e.data;
  let clip: Awaited<ReturnType<typeof openClip>> = null;
  try {
    faceHelpers(); // the helpers load their OpenCV while the clip opens
    const [{ cv }, opened] = await Promise.all([loadOpenCv(), openClip(file)]);
    clip = opened;
    if (!clip) return post({ id, ok: false, error: "This browser cannot decode the clip." });
    let last = -1;
    const analysis = await analyzeFrames({ cv, readFrames: clip.readFrames, findFace }, clip.meta, clipId,
      (f) => { const p = Math.round(f * 100); if (p !== last) { last = p; post({ id, progress: f }); } });
    post({ id, ok: true, analysis: { ...analysis, analysisVersion: VIDEO_ANALYSIS_VERSION } });
  } catch (err) {
    post({ id, ok: false, error: String((err as Error)?.message ?? err) });
  } finally {
    clip?.dispose();
  }
};
