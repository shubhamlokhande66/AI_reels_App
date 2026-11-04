/** Person masks and faces on the phone (lib/vision/vision.worker.ts). Pixels go in as RGBA (256x256 for a mask, 128x128
 * squares for faces); rejects when the models cannot run, and the editor keeps its older ways. */

import { phoneModels } from "../nativeModels";

const BASE = "/api/studio/model/", WASM = "/vendor/ort/";
let worker: Worker | null = null, nextId = 1;

function call<T>(msg: object, transfer: Transferable[]): Promise<T> {
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") return Promise.reject(new Error("no WebAssembly here"));
  worker ??= new Worker("/w/vision.worker.js", { type: "module" });
  const w = worker, id = nextId++;
  return new Promise((resolve, reject) => {
    const done = () => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); };
    const onMsg = (e: MessageEvent) => { const d = e.data; if (d.id !== id) return; done(); if (d.type === "done") resolve(d as T); else reject(new Error(d.message)); };
    const onErr = (e: ErrorEvent) => { done(); worker = null; reject(new Error(e.message || "vision worker failed")); };
    w.addEventListener("message", onMsg); w.addEventListener("error", onErr);
    w.postMessage({ ...msg, id, base: new URL(BASE, location.href).href, wasm: new URL(WASM, location.href).href, native: phoneModels() }, transfer);
  });
}
/** a person mask, 256x256 values in [0,1], from 256x256 RGBA pixels */
export async function personMask(rgba: Uint8ClampedArray): Promise<Float32Array> {
  return (await call<{ mask: Float32Array }>({ type: "seg", rgba }, [rgba.buffer])).mask;
}
/** faces in each 128x128 RGBA square: [score, cx, cy, w, h] in the square's fractions */
export async function findFaces(squares: Uint8ClampedArray[]): Promise<number[][][]> {
  return (await call<{ faces: number[][][] }>({ type: "face", rgba: squares }, squares.map((s) => s.buffer))).faces;
}
