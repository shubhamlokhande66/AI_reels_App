// Face detection (OpenCV Haar cascades, opencv.js WebAssembly) in a worker thread (the browser runs the same steps:
// server/video/faceFind.ts; keep the two in step): about half a second per frame in
// WebAssembly, so the analyzer spreads frames over a few of these. Input: { id, gray, bgr, w, h } (bytes of one small
// frame). Output: { id, ok, box: [x, y, w, h] | null } - the largest frontal face, else a profile facing either way,
// whose box has skin in it (cascades also fire on foliage and brickwork).
/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node worker, loaded outside the Next.js bundle */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");

const cv = require("@techstark/opencv-js");
let ready = null;

function load() {
  ready ??= new Promise((resolve) => {
    const done = () => {
      clearInterval(poll);
      delete cv.then; // an Emscripten thenable: never let a promise unwrap it
      const files = {};
      for (const name of ["haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"]) {
        try {
          cv.FS_createDataFile("/", name, fs.readFileSync(path.join(workerData.dataDir, name)), true, false, false);
        } catch { /* already there */ }
        const c = new cv.CascadeClassifier();
        files[name] = c.load(name) ? c : (c.delete(), null);
      }
      resolve({ face: files["haarcascade_frontalface_default.xml"], profile: files["haarcascade_profileface.xml"] });
    };
    const poll = setInterval(() => { if (cv.Mat) done(); }, 20);
  });
  return ready;
}

function skinShare(bgr) {
  if (!bgr.rows || !bgr.cols) return 0;
  const ycc = new cv.Mat();
  cv.cvtColor(bgr, ycc, cv.COLOR_BGR2YCrCb);
  const d = ycc.data;
  let hit = 0;
  for (let i = 0; i < d.length; i += 3) { const cr = d[i + 1], cb = d[i + 2]; if (cr >= 128 && cr <= 185 && cb >= 70 && cb <= 140) hit++; }
  ycc.delete();
  return hit / (d.length / 3);
}

function find({ face, profile }, grayBytes, bgrBytes, w, h) {
  if (!face) return null;
  const made = [];
  const keep = (m) => { made.push(m); return m; };
  try {
    const gray = keep(new cv.Mat(h, w, cv.CV_8UC1));
    gray.data.set(grayBytes);
    const bgr = keep(new cv.Mat(h, w, cv.CV_8UC3));
    bgr.data.set(bgrBytes);
    const eq = keep(new cv.Mat());
    cv.equalizeHist(gray, eq);
    const side = Math.max(Math.trunc(w / 14), 18);
    const detect = (cls, img) => {
      const rects = keep(new cv.RectVector());
      cls.detectMultiScale(img, rects, 1.1, 4, 0, new cv.Size(side, side));
      const out = [];
      for (let i = 0; i < rects.size(); i++) { const r = rects.get(i); out.push([r.x, r.y, r.width, r.height]); }
      return out;
    };
    let found = detect(face, eq);
    if (!found.length && profile) {
      found = detect(profile, eq);
      const flipped = keep(new cv.Mat());
      cv.flip(eq, flipped, 1);
      for (const [x, y, fw, fh] of detect(profile, flipped)) found.push([w - x - fw, y, fw, fh]);
    }
    found = found.filter(([x, y, fw, fh]) => {
      const roi = bgr.roi(new cv.Rect(x, y, fw, fh));
      try { return skinShare(roi) >= 0.2; } finally { roi.delete(); }
    });
    return found.length ? found.reduce((best, f) => (f[2] * f[3] > best[2] * best[3] ? f : best), found[0]) : null;
  } finally {
    for (const m of made) try { m.delete(); } catch { /* gone */ }
  }
}

parentPort.on("message", async ({ id, gray, bgr, w, h }) => {
  try {
    const det = await load();
    parentPort.postMessage({ id, ok: true, box: find(det, gray, bgr, w, h) });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err && err.stack ? err.stack : err) });
  }
});
