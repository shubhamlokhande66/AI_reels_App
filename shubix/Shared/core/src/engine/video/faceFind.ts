import type { FaceBox } from "./clipAnalysisCore";
import type { CV, Mat } from "./cvOps";

/** Face finding for the clip analysis in the browser (lib/clipAnalysis): the same steps as the server's worker threads
 * (server/video/face-worker.cjs, plain Node, so it cannot import this; keep the two in step). The largest frontal face,
 * else a profile facing either way, whose box has skin in it (cascades also fire on foliage and brickwork). */

export interface Cascades { face: Mat | null; profile: Mat | null }

/** The two Haar cascades, from their XML text, loaded into OpenCV's in-memory file system. */
export function loadCascades(cv: CV, files: Record<string, Uint8Array>): Cascades {
  const out: Record<string, Mat | null> = {};
  for (const [name, bytes] of Object.entries(files)) {
    try { cv.FS_createDataFile("/", name, bytes, true, false, false); } catch { /* already there */ }
    const c = new cv.CascadeClassifier();
    out[name] = c.load(name) ? c : (c.delete(), null);
  }
  return { face: out["haarcascade_frontalface_default.xml"] ?? null, profile: out["haarcascade_profileface.xml"] ?? null };
}

function skinShare(cv: CV, bgr: Mat): number {
  if (!bgr.rows || !bgr.cols) return 0;
  const ycc = new cv.Mat();
  cv.cvtColor(bgr, ycc, cv.COLOR_BGR2YCrCb);
  const d = ycc.data as Uint8Array;
  let hit = 0;
  for (let i = 0; i < d.length; i += 3) { const cr = d[i + 1], cb = d[i + 2]; if (cr >= 128 && cr <= 185 && cb >= 70 && cb <= 140) hit++; }
  ycc.delete();
  return hit / (d.length / 3);
}

/** The largest face (x, y, w, h in pixels) in one small frame, or null. */
export function findFaceIn(cv: CV, { face, profile }: Cascades, grayBytes: Uint8Array, bgrBytes: Uint8Array, w: number, h: number): FaceBox | null {
  if (!face) return null;
  const made: { delete(): void }[] = [];
  const keep = <M extends { delete(): void }>(m: M) => { made.push(m); return m; };
  try {
    const gray = keep(new cv.Mat(h, w, cv.CV_8UC1));
    gray.data.set(grayBytes);
    const bgr = keep(new cv.Mat(h, w, cv.CV_8UC3));
    bgr.data.set(bgrBytes);
    const eq = keep(new cv.Mat());
    cv.equalizeHist(gray, eq);
    const side = Math.max(Math.trunc(w / 14), 18);
    const detect = (cls: Mat, img: Mat): FaceBox[] => {
      const rects = keep(new cv.RectVector());
      cls.detectMultiScale(img, rects, 1.1, 4, 0, new cv.Size(side, side));
      const out: FaceBox[] = [];
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
      try { return skinShare(cv, roi) >= 0.2; } finally { roi.delete(); }
    });
    return found.length ? found.reduce((best, f) => (f[2] * f[3] > best[2] * best[3] ? f : best), found[0]) : null;
  } finally {
    for (const m of made) try { m.delete(); } catch { /* gone */ }
  }
}
