import "server-only";
import { probe } from "@/server/core/ffmpeg";
import { round } from "@/server/core/py";
import { parseVideoProbe } from "@/server/media/probe";
import { readFrames } from "./frames";

/** Uploads that are the same video under another name (WhatsApp "(1)" copies, a re-exported or trimmed copy) - was
 * backend/app/video/duplicates.py. Each clip becomes small grey thumbnails, one every STEP seconds; clip B is a copy of
 * A when its sampled frames all match frames of A at one consistent offset (so a trimmed copy is found too). */

const STEP = 0.25, THUMB = 32, MATCH = 10, PROBES = 6, OFFSET_TOLERANCE = 0.6, ASPECT_TOLERANCE = 0.1;

export interface Duplicate { clipId: string; sameAs: string; offset: number }
export interface Thumbs { frames: Float32Array[]; aspect: number }

/** One 32x32 thumbnail every STEP seconds, mean-removed (a re-encode with other brightness still matches). */
export async function thumbnails(file: string): Promise<Thumbs> {
  const meta = parseVideoProbe(await probe(file));
  const step = Math.max(round((meta.fps || 30) * STEP), 1);
  const frames: Float32Array[] = [];
  for await (const f of readFrames(file, { step, rect: null, srcW: meta.width, srcH: meta.height, width: THUMB, height: THUMB, gray: true })) {
    let m = 0;
    for (const v of f.data) m += v;
    m /= f.data.length;
    frames.push(Float32Array.from(f.data, (v) => v - m));
  }
  return { frames, aspect: meta.width / Math.max(meta.height, 1) };
}

const sameShape = (a: Thumbs, b: Thumbs) => !(a.aspect && b.aspect) || Math.abs(a.aspect - b.aspect) / Math.max(a.aspect, b.aspect) <= ASPECT_TOLERANCE;

function mad(x: Float32Array, y: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
  return s / x.length;
}

/** The offset (s) at which every probe frame of b is found in a; null = b is not a copy of a. */
function contained(b: Float32Array[], a: Float32Array[]): number | null {
  if (b.length < 2 || a.length < 2) return null;
  const k = Math.min(PROBES, b.length);
  const probes = Array.from({ length: k }, (_, i) => Math.trunc(k === 1 ? 0 : (i * (b.length - 1)) / (k - 1)));
  const first = a.map((f) => mad(f, b[probes[0]]));
  const slack = Math.max(round(OFFSET_TOLERANCE / STEP), 1);
  // every place the first probe appears in a is a candidate offset; the copy is the one where ALL probes match
  for (const j of first.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0] || p[1] - q[1]).map(([, i]) => i)) {
    if (first[j] > MATCH) break;
    const off = j - probes[0];
    const ok = probes.slice(1).every((p) => {
      const lo = Math.max(p + off - slack, 0), hi = Math.min(p + off + slack + 1, a.length);
      if (lo >= hi) return false;
      let best = Infinity;
      for (let i = lo; i < hi; i++) best = Math.min(best, mad(a[i], b[p]));
      return best <= MATCH;
    });
    if (ok) return off * STEP;
  }
  return null;
}

/** `clips`: (clip id, thumbnails) in upload order. The longer copy (or the first uploaded) is kept. */
export function findDuplicates(clips: [string, Thumbs][]): Duplicate[] {
  const dups: Duplicate[] = [];
  const gone = new Set<string>();
  const order = clips.map((_, i) => i).sort((i, j) => clips[j][1].frames.length - clips[i][1].frames.length || i - j);
  order.forEach((i, x) => {
    const [aId, a] = clips[i];
    if (gone.has(aId)) return;
    for (const j of order.slice(x + 1)) {
      const [bId, b] = clips[j];
      if (gone.has(bId)) continue;
      const off = sameShape(a, b) ? contained(b.frames, a.frames) : null;
      if (off !== null) {
        dups.push({ clipId: bId, sameAs: aId, offset: round(off, 2) });
        gone.add(bId);
      }
    }
  });
  return dups;
}
