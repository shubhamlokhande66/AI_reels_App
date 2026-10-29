import * as cvModule from "@techstark/opencv-js";
import type { CV } from "@shubix/core/engine/video/cvOps";
import { loadCascades, type Cascades } from "@shubix/core/engine/video/faceFind";

/** OpenCV (WebAssembly) and the face models, loaded once per browser worker. A static import on purpose: opencv.js is an
 * Emscripten "thenable", so awaiting import() of it would never finish. */

const CASCADES = ["haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"];
let ready: Promise<{ cv: CV; cascades: Cascades }> | null = null;

export function loadOpenCv(): Promise<{ cv: CV; cascades: Cascades }> {
  ready ??= (async () => {
    const cv: CV = (cvModule as { default?: CV }).default ?? cvModule;
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => { if (cv.Mat) { clearInterval(poll); resolve(); } }, 20);
    });
    delete cv.then; // never let a promise unwrap it
    const files = Object.fromEntries(await Promise.all(CASCADES.map(async (name) => {
      const res = await fetch(`/api/models/${name}`);
      if (!res.ok) throw new Error(`face model ${name}: ${res.status}`);
      return [name, new Uint8Array(await res.arrayBuffer())] as const;
    })));
    return { cv, cascades: loadCascades(cv, files) };
  })();
  ready.catch(() => { ready = null; }); // a failed load is tried again next time
  return ready;
}
