import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/** OpenCV (opencv.js 4.10, WebAssembly) for the video analysis: the same library the Python analyzer used (cv2), loaded
 * once per server. Every Mat made here must be deleted (WebAssembly memory is not garbage collected): `withMats`. */

import type { CV } from "./cvOps";
export { bgrMat, phaseCorrelate, withMats, type CV, type Mat } from "./cvOps";

const g = globalThis as unknown as { __cv?: Promise<CV> };

export function opencv(): Promise<CV> {
  g.__cv ??= new Promise((resolve) => {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const cv = req("@techstark/opencv-js");
    let ready = false;
    const done = () => {
      if (ready) return;
      ready = true;
      clearInterval(poll);
      // the module is an Emscripten thenable: awaiting it would keep unwrapping it forever
      delete cv.then;
      for (const name of ["haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"]) {
        try {
          cv.FS_createDataFile("/", name, fs.readFileSync(path.join(process.cwd(), "server", "video", "data", name)), true, false, false);
        } catch { /* already there */ }
      }
      resolve(cv);
    };
    cv.onRuntimeInitialized = done;
    const poll = setInterval(() => { if (cv.Mat) done(); }, 50);
  });
  return g.__cv;
}
