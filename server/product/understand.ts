import "server-only";
import sharp from "sharp";
import { CorruptedMedia } from "@/server/core/errors";
import { PyRandom } from "@/server/core/random";
import { opencv, withMats, type CV, type Mat } from "@/server/video/cv";
import type { Highlight, ImageUnderstanding, Rect, Region } from "./director";

/** Understand a product photo before planning anything (was product/understand.py): the product's outline, where the
 * fine detail is, which spots truly reflect light (the only places sparkles may appear), the colours, and whether the
 * photo is sharp enough to zoom into. Classical image analysis (OpenCV), offline and deterministic. */

const ANALYSIS_SIDE = 720;

/** A photo as BGR bytes, upright (the camera's EXIF rotation applied). */
export async function loadBgr(file: string): Promise<{ data: Uint8Array; w: number; h: number }> {
  try {
    const { data, info } = await sharp(file).rotate().toColourspace("srgb").removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width < 16 || info.height < 16 || info.channels !== 3) throw new Error("too small");
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 3) { out[i] = data[i + 2]; out[i + 1] = data[i + 1]; out[i + 2] = data[i]; }
    return { data: out, w: info.width, h: info.height };
  } catch {
    throw new CorruptedMedia("The image could not be read (or is too small to use).", { code: "CORRUPTED_IMAGE" });
  }
}
export function matOf(cv: CV, img: { data: Uint8Array; w: number; h: number }): Mat {
  const m = new cv.Mat(img.h, img.w, cv.CV_8UC3);
  m.data.set(img.data);
  return m;
}
const hex = (b: number, g: number, r: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).toUpperCase().padStart(2, "0")).join("")}`;
const median = (xs: Float64Array | number[]) => { const s = Float64Array.from(xs).sort(), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
function percentile(xs: Float32Array, q: number) {
  const s = Float32Array.from(xs).sort(), pos = (q / 100) * (s.length - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
function bboxOfComponents(cv: CV, mask: Uint8Array, w: number, h: number, keepRatio = 0.08): [number, number, number, number] | null {
  return withMats((keep) => {
    const m = keep(new cv.Mat(h, w, cv.CV_8UC1)); m.data.set(mask);
    const labels = keep(new cv.Mat()), stats = keep(new cv.Mat()), cents = keep(new cv.Mat());
    const n = cv.connectedComponentsWithStats(m, labels, stats, cents, 8, cv.CV_32S);
    if (n <= 1) return null;
    const st = (i: number, k: number) => stats.data32S[i * 5 + k];
    let biggest = 0;
    for (let i = 1; i < n; i++) biggest = Math.max(biggest, st(i, 4));
    const floor = Math.max(keepRatio * biggest, 0.003 * w * h);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 1; i < n; i++) if (st(i, 4) >= floor) { x0 = Math.min(x0, st(i, 0)); y0 = Math.min(y0, st(i, 1)); x1 = Math.max(x1, st(i, 0) + st(i, 2)); y1 = Math.max(y1, st(i, 1) + st(i, 3)); }
    return x0 === Infinity ? null : [x0, y0, x1, y1];
  });
}
const r = (x: number, n: number) => { const k = 10 ** n; return Math.round(x * k) / k; };

export async function understandImage(file: string, mediaId: string, name = ""): Promise<ImageUnderstanding> {
  const cv = await opencv(), img = await loadBgr(file), W = img.w, H = img.h, k = ANALYSIS_SIDE / Math.max(H, W);
  return withMats((keep) => {
    const full = keep(matOf(cv, img)), small = keep(new cv.Mat());
    if (k < 1) cv.resize(full, small, new cv.Size(Math.max(Math.trunc(W * k), 16), Math.max(Math.trunc(H * k), 16)), 0, 0, cv.INTER_AREA); else full.copyTo(small);
    const w = small.cols, h = small.rows, n = w * h, px = small.data as Uint8Array, notes: string[] = [];
    const labM = keep(new cv.Mat()); cv.cvtColor(small, labM, cv.COLOR_BGR2Lab);
    const lab = labM.data as Uint8Array;
    const t = Math.max(2, Math.trunc(0.04 * Math.min(h, w))), ring = new Uint8Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y < t || y >= h - t || x < t || x >= w - t) ring[y * w + x] = 1;
    const ringIdx: number[] = [];
    for (let i = 0; i < n; i++) if (ring[i]) ringIdx.push(i);
    const chan = (arr: Uint8Array, c: number) => ringIdx.map((i) => arr[i * 3 + c]);
    const bgLab = [0, 1, 2].map((c) => median(chan(lab, c))), bgBgr = [0, 1, 2].map((c) => median(chan(px, c)));
    const std = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };
    const spread = [0, 1, 2].reduce((s, c) => s + std(chan(lab, c)), 0) / 3, plain = spread < 14;
    const bg8 = bgBgr.map((v) => Math.trunc(v)), dark = Math.round(0.114 * bg8[0] + 0.587 * bg8[1] + 0.299 * bg8[2]) < 90;
    const grayM = keep(new cv.Mat()); cv.cvtColor(small, grayM, cv.COLOR_BGR2GRAY);
    let mask = new Uint8Array(n);
    if (plain) {
      const dist = new Float32Array(n), d8 = keep(new cv.Mat(h, w, cv.CV_8UC1));
      for (let i = 0; i < n; i++) { dist[i] = Math.hypot(lab[i * 3] - bgLab[0], lab[i * 3 + 1] - bgLab[1], lab[i * 3 + 2] - bgLab[2]); d8.data[i] = Math.min(Math.max(Math.trunc(dist[i] * 4), 0), 255); }
      const otsu = cv.threshold(d8, keep(new cv.Mat()), 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU), thr = Math.max(otsu / 4, 16);
      for (let i = 0; i < n; i++) mask[i] = dist[i] > thr ? 1 : 0;
      notes.push("Plain background: the product's outline is reliable.");
    } else {
      const gx = keep(new cv.Mat()), gy = keep(new cv.Mat()), mag = keep(new cv.Mat()), sal = keep(new cv.Mat());
      cv.Sobel(grayM, gx, cv.CV_32F, 1, 0); cv.Sobel(grayM, gy, cv.CV_32F, 0, 1); cv.magnitude(gx, gy, mag);
      cv.GaussianBlur(mag, sal, new cv.Size(0, 0), Math.max(h, w) / 60);
      const s = sal.data32F as Float32Array;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) s[y * w + x] *= Math.exp(-(((x / w - 0.5) / 0.45) ** 2 + ((y / h - 0.5) / 0.45) ** 2));
      const p70 = percentile(s, 70);
      for (let i = 0; i < n; i++) mask[i] = s[i] > p70 ? 1 : 0;
      notes.push("Busy background: the product's outline is an estimate, so close-ups stay closer to the centre.");
    }
    const ksz = Math.max(3, Math.trunc(Math.min(h, w) / 90) | 1), mm = keep(new cv.Mat(h, w, cv.CV_8UC1));
    mm.data.set(mask);
    cv.morphologyEx(mm, mm, cv.MORPH_OPEN, keep(cv.Mat.ones(ksz, ksz, cv.CV_8U)));
    cv.morphologyEx(mm, mm, cv.MORPH_CLOSE, keep(cv.Mat.ones(ksz * 3, ksz * 3, cv.CV_8U)));
    mask = Uint8Array.from(mm.data as Uint8Array, (v) => (v ? 1 : 0));
    let box = bboxOfComponents(cv, mask, w, h), confidence = plain ? 0.9 : 0.4;
    if (box) { const area = ((box[2] - box[0]) * (box[3] - box[1])) / (w * h); if (!(area >= 0.02 && area <= 0.97)) box = null; }
    if (!box) {
      box = [Math.trunc(0.12 * w), Math.trunc(0.12 * h), Math.trunc(0.88 * w), Math.trunc(0.88 * h)];
      mask = new Uint8Array(n);
      for (let y = box[1]; y < box[3]; y++) for (let x = box[0]; x < box[2]; x++) mask[y * w + x] = 1;
      confidence = 0.2;
      notes.push("The product could not be outlined confidently; the centre of the photo is used.");
    }
    const [x0, y0, x1, y1] = box, pad = 0.03, sx = Math.max(x0 / w - pad, 0), sy = Math.max(y0 / h - pad, 0);
    const subject: Rect = { x: sx, y: sy, w: Math.min((x1 - x0) / w + 2 * pad, 1 - sx), h: Math.min((y1 - y0) / h + 2 * pad, 1 - sy) };
    // fine detail: where the picture holds the most sharp texture inside the product
    const gb = keep(new cv.Mat()), lapM = keep(new cv.Mat()), lapB = keep(new cv.Mat());
    cv.GaussianBlur(grayM, gb, new cv.Size(0, 0), 1.0); cv.Laplacian(gb, lapM, cv.CV_32F);
    const la = lapM.data32F as Float32Array;
    for (let i = 0; i < n; i++) la[i] = Math.abs(la[i]);
    cv.GaussianBlur(lapM, lapB, new cv.Size(0, 0), 2.0);
    const lap = lapB.data32F as Float32Array;
    const sx0 = Math.trunc(subject.x * w), sy0 = Math.trunc(subject.y * h), sx1 = Math.trunc((subject.x + subject.w) * w), sy1 = Math.trunc((subject.y + subject.h) * h), N = 8;
    const tiles: [number, number, number][] = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const ty0 = sy0 + Math.floor(((sy1 - sy0) * j) / N), ty1 = sy0 + Math.floor(((sy1 - sy0) * (j + 1)) / N), tx0 = sx0 + Math.floor(((sx1 - sx0) * i) / N), tx1 = sx0 + Math.floor(((sx1 - sx0) * (i + 1)) / N);
      if (ty1 <= ty0 || tx1 <= tx0) continue;
      let cover = 0, sum = 0;
      for (let y = ty0; y < ty1; y++) for (let x = tx0; x < tx1; x++) { cover += mask[y * w + x]; sum += lap[y * w + x]; }
      const cnt = (ty1 - ty0) * (tx1 - tx0);
      tiles.push([(sum / cnt) * (0.35 + 0.65 * (cover / cnt)), (tx0 + tx1) / 2 / w, (ty0 + ty1) / 2 / h]);
    }
    tiles.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
    const top = tiles.length && tiles[0][0] > 0 ? tiles[0][0] : 1, side = k < 1 ? (0.3 * Math.max(sx1 - sx0, sy1 - sy0)) / k : 0.3 * Math.max(sx1 - sx0, sy1 - sy0);
    const minGap = (1.3 * Math.max(sx1 - sx0, sy1 - sy0)) / (w * N), regions: Region[] = [];
    for (const [score, cx, cy] of tiles) {
      if (regions.length >= 5) break;
      if (regions.some((g) => Math.abs(cx - (g.rect.x + g.rect.w / 2)) < minGap && (Math.abs(cy - (g.rect.y + g.rect.h / 2)) * h) / w < minGap)) continue;
      const rw = side / W, rh = side / H, rel = score / top;
      regions.push({ rect: { x: Math.min(Math.max(cx - rw / 2, 0), 1 - rw), y: Math.min(Math.max(cy - rh / 2, 0), 1 - rh), w: Math.min(rw, 1), h: Math.min(rh, 1) }, score: r(rel, 3), kind: rel >= 0.7 ? "macro" : "detail" });
    }
    // reflective highlights: small, bright, unsaturated spots brighter than their surroundings, on the product
    const hsvM = keep(new cv.Mat()); cv.cvtColor(small, hsvM, cv.COLOR_BGR2HSV);
    const hsv = hsvM.data as Uint8Array, vM = keep(new cv.Mat(h, w, cv.CV_32FC1)), vB = keep(new cv.Mat());
    for (let i = 0; i < n; i++) vM.data32F[i] = hsv[i * 3 + 2];
    cv.GaussianBlur(vM, vB, new cv.Size(0, 0), Math.max(h, w) / 40);
    const local = new Float32Array(n);
    for (let i = 0; i < n; i++) local[i] = vM.data32F[i] - vB.data32F[i];
    const dil = keep(new cv.Mat()), mk = keep(new cv.Mat(h, w, cv.CV_8UC1));
    mk.data.set(mask);
    cv.dilate(mk, dil, keep(cv.Mat.ones(7, 7, cv.CV_8U)));
    const spec = keep(new cv.Mat(h, w, cv.CV_8UC1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, inside = dil.data[i] && x >= sx0 && x < sx1 && y >= sy0 && y < sy1;
      spec.data[i] = inside && hsv[i * 3 + 2] >= 225 && hsv[i * 3 + 1] <= 80 && local[i] > 22 ? 1 : 0;
    }
    const labels = keep(new cv.Mat()), stats = keep(new cv.Mat()), cents = keep(new cv.Mat());
    const cnt = cv.connectedComponentsWithStats(spec, labels, stats, cents, 8, cv.CV_32S), cand: [number, number, number][] = [];
    for (let c = 1; c < cnt; c++) {
      const st = (j: number) => stats.data32S[c * 5 + j], area = st(4);
      if (area < 2 || area > 0.006 * w * h) continue;
      let lmax = -Infinity, vmax = 0;
      for (let y = st(1); y < st(1) + st(3); y++) for (let x = st(0); x < st(0) + st(2); x++) { lmax = Math.max(lmax, local[y * w + x]); vmax = Math.max(vmax, hsv[(y * w + x) * 3 + 2]); }
      cand.push([0.55 * Math.min(Math.max(lmax / 90, 0), 1) + 0.45 * (vmax / 255), cents.data64F[c * 2] / w, cents.data64F[c * 2 + 1] / h]);
    }
    cand.sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
    const highlights: Highlight[] = [];
    for (const [strength, cx, cy] of cand) {
      if (highlights.length >= 12) break;
      if (highlights.every((hl) => Math.abs(cx - hl.x) > 0.03 || (Math.abs(cy - hl.y) * h) / w > 0.03)) highlights.push({ x: r(cx, 4), y: r(cy, 4), strength: r(Math.min(strength, 1), 3) });
    }
    if (!highlights.length) notes.push("No reflective highlights were found, so sparkles will not be used on this photo.");
    // the product's colours: 3 clusters of its pixels, biggest first
    const pts: number[][] = [];
    for (let i = 0; i < n; i++) if (mask[i]) pts.push([px[i * 3], px[i * 3 + 1], px[i * 3 + 2]]);
    const palette: string[] = [];
    if (pts.length >= 30) {
      const sample = pts.filter((_, i) => i % Math.max(Math.trunc(pts.length / 4000), 1) === 0), rng = new PyRandom(0);
      let centers = [sample[rng.randrange(sample.length)]];
      while (centers.length < 3) {
        const d = sample.map((p) => Math.min(...centers.map((c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2))), sum = d.reduce((a, b) => a + b, 0);
        let x = rng.random() * sum, j = 0;
        while (j < d.length - 1 && x > d[j]) { x -= d[j]; j++; }
        centers.push(sample[j]);
      }
      let lbl = new Array(sample.length).fill(0);
      for (let it = 0; it < 10; it++) {
        lbl = sample.map((p) => centers.reduce((b, c, ci) => ((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2 < (p[0] - centers[b][0]) ** 2 + (p[1] - centers[b][1]) ** 2 + (p[2] - centers[b][2]) ** 2 ? ci : b), 0));
        const nw = centers.map((c, ci) => { const m = sample.filter((_, i) => lbl[i] === ci); return m.length ? [0, 1, 2].map((d) => m.reduce((s, p) => s + p[d], 0) / m.length) : c; });
        const moved = Math.max(...nw.map((c, ci) => Math.hypot(c[0] - centers[ci][0], c[1] - centers[ci][1], c[2] - centers[ci][2])));
        centers = nw;
        if (moved < 1) break;
      }
      const counts = centers.map((_, ci) => lbl.filter((l) => l === ci).length);
      for (const ci of [0, 1, 2].sort((a, b) => counts[b] - counts[a] || a - b)) palette.push(hex(centers[ci][0], centers[ci][1], centers[ci][2]));
    }
    let sharpness = 0;
    if (sx1 > sx0 && sy1 > sy0) {
      const roi = keep(grayM.roi(new cv.Rect(sx0, sy0, sx1 - sx0, sy1 - sy0))), l2 = keep(new cv.Mat());
      cv.Laplacian(roi, l2, cv.CV_32F);
      const d = l2.data32F as Float32Array, m = d.reduce((a, b) => a + b, 0) / d.length;
      sharpness = Math.log1p(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length);
    }
    if (Math.max(H, W) < 1200) notes.push(`The photo is ${W}x${H}: close-ups and macro shots are limited to stay sharp.`);
    return { mediaId, name, width: W, height: H, subject, subjectConfidence: r(confidence, 2), background: plain ? "plain" : "busy", backgroundColor: hex(bgBgr[0], bgBgr[1], bgBgr[2]),
      darkBackground: dark, palette, regions, highlights, sharpness: r(sharpness, 2), notes };
  });
}
