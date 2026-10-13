import "server-only";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/** OpenCV (opencv.js 4.10, WebAssembly) for the video analysis: the same library the Python analyzer used (cv2), loaded
 * once per server. Every Mat made here must be deleted (WebAssembly memory is not garbage collected): `withMats`. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Mat = any;

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

/** Run `fn`, then delete every Mat / vector it registered with `keep`. */
export function withMats<T>(fn: (keep: <M extends { delete(): void }>(m: M) => M) => T): T {
  const made: { delete(): void }[] = [];
  try {
    return fn((m) => { made.push(m); return m; });
  } finally {
    for (const m of made) try { m.delete(); } catch { /* already gone */ }
  }
}

/** A BGR frame (h x w x 3 bytes) as a CV_8UC3 Mat. */
export function bgrMat(cv: CV, data: Uint8Array, w: number, h: number): Mat {
  const m = new cv.Mat(h, w, cv.CV_8UC3);
  m.data.set(data);
  return m;
}

/** cv2.phaseCorrelate(a, b): [dx, dy, response] - the translation of b relative to a (OpenCV's own steps: pad to the
 * optimal DFT size, normalised cross-power spectrum, inverse DFT, shift, 5x5 weighted centroid around the peak). */
export function phaseCorrelate(cv: CV, a: Mat, b: Mat): [number, number, number] {
  return withMats((keep) => {
    const M = cv.getOptimalDFTSize(a.rows), N = cv.getOptimalDFTSize(a.cols);
    const pad = (src: Mat) => {
      const f = keep(new cv.Mat());
      src.convertTo(f, cv.CV_32F);
      const p = keep(new cv.Mat());
      cv.copyMakeBorder(f, p, 0, M - a.rows, 0, N - a.cols, cv.BORDER_CONSTANT, new cv.Scalar(0));
      const out = keep(new cv.Mat());
      cv.dft(p, out, cv.DFT_COMPLEX_OUTPUT);
      return out;
    };
    const A = pad(a), B = pad(b);
    const C = keep(new cv.Mat(M, N, cv.CV_32FC2));
    const ad = A.data32F, bd = B.data32F, cd = C.data32F;
    for (let i = 0; i < ad.length; i += 2) {
      // A * conj(B), normalised to unit magnitude
      const re = ad[i] * bd[i] + ad[i + 1] * bd[i + 1], im = ad[i + 1] * bd[i] - ad[i] * bd[i + 1];
      const mag = Math.hypot(re, im);
      cd[i] = mag > 0 ? re / mag : 0;
      cd[i + 1] = mag > 0 ? im / mag : 0;
    }
    const inv = keep(new cv.Mat());
    cv.dft(C, inv, cv.DFT_INVERSE | cv.DFT_REAL_OUTPUT);
    const d = inv.data32F as Float32Array;
    // fftShift + the peak
    const at = (y: number, x: number) => d[((y + Math.floor(M / 2)) % M) * N + ((x + Math.floor(N / 2)) % N)];
    let py = 0, px = 0, best = -Infinity;
    for (let y = 0; y < M; y++) for (let x = 0; x < N; x++) { const v = at(y, x); if (v > best) { best = v; py = y; px = x; } }
    let sx = 0, sy = 0, sum = 0;
    for (let y = Math.max(py - 2, 0); y <= Math.min(py + 2, M - 1); y++) {
      for (let x = Math.max(px - 2, 0); x <= Math.min(px + 2, N - 1); x++) { const v = at(y, x); sx += v * x; sy += v * y; sum += v; }
    }
    const cx = sum ? sx / sum : px, cy = sum ? sy / sum : py;
    return [N / 2 - cx, M / 2 - cy, sum / (M * N)];
  });
}
