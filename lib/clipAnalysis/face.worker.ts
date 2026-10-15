/// <reference lib="webworker" />
import { findFaceIn } from "@/server/video/faceFind";
import { loadOpenCv } from "./opencv";

/** A helper thread of the browser's clip analysis that only finds faces (the slowest step: Haar cascades in WebAssembly),
 * so several frames are looked at side by side, like the server's face worker pool. In: { id, gray, bgr, w, h }.
 * Out: { id, ok, box } or { id, ok: false, error }. */

self.onmessage = async (e: MessageEvent<{ id: number; gray: Uint8Array; bgr: Uint8Array; w: number; h: number }>) => {
  const { id, gray, bgr, w, h } = e.data;
  try {
    const { cv, cascades } = await loadOpenCv();
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, box: findFaceIn(cv, cascades, gray, bgr, w, h) });
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
