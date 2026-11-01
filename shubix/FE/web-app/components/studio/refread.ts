/** Reading a reference Reel like an editor would, from small grey frames (measured on the phone, nothing uploaded):
 *  - revealShape(): a transition that opens the next shot through a shape: a circle (iris), a diamond, a heart, a star,
 *    a straight wipe or bars. At a frame in the middle of the transition each pixel is either still the old shot or
 *    already the new one; that map of "new" pixels is matched against each shape.
 *  - motionBetween(): how the picture moved from one frame to the next: zoom, sideways / up-down shift and rotation.
 *  - shotMove(): the whole shot's camera move as a few keyframes (zoom, position, rotation, ease), plus a shake and a
 *    freeze when there is one. These are what the AI copies onto the new Reel's shots.
 * Frames are Float32Array brightness (0-1), row by row, W x H (the studio reads them 64 wide). */

export type Shape = "iris" | "diamond" | "heart" | "star" | "wipe" | "bars";
export const SHAPES: Shape[] = ["iris", "diamond", "heart", "star", "wipe", "bars"];
/** the centred shapes, as the studio draws them: is (x, y) inside the unit shape? (y grows downwards, the shape's size R = 1) */
export function shapeInside(kind: "iris" | "diamond" | "heart" | "star", x: number, y: number): boolean {
  if (kind === "iris") return x * x + y * y <= 1;
  if (kind === "diamond") return Math.abs(x) + Math.abs(y) <= 1;
  if (kind === "heart") { const X = x * 1.15, Y = -y * 1.15 + 0.3, a = X * X + Y * Y - 1; return a * a * a - X * X * Y * Y * Y <= 0; }
  const r = Math.hypot(x, y), a = Math.atan2(y, x);
  return r <= 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(5 * a + Math.PI / 2), 3);   // a five-pointed star, a point at the top
}
/** how big R must be (times the distance to the farthest corner) for the shape to cover the whole frame */
export const SHAPE_REACH: Record<"iris" | "diamond" | "heart" | "star", number> = { iris: 1.05, diamond: 1.45, heart: 1.9, star: 1.85 };

/** Which shape the new shot opens through, at a frame F in the middle of a transition from A to B (or null: a plain
 * blend such as a dissolve, or not readable). */
export function revealShape(A: Float32Array, B: Float32Array, F: Float32Array, W: number, H: number): Shape | null {
  const idx: number[] = [], isNew: boolean[] = [];
  let sharp = 0;
  for (let i = 0; i < W * H; i++) {
    const dAB = Math.abs(A[i] - B[i]); if (dAB < 0.1) continue;   // only where the two shots look different
    const w = Math.abs(F[i] - A[i]) / (Math.abs(F[i] - A[i]) + Math.abs(F[i] - B[i]) + 1e-6);
    if (w < 0.3 || w > 0.7) sharp++;
    idx.push(i); isNew.push(w > 0.5);
  }
  if (idx.length < 0.15 * W * H || sharp < 0.75 * idx.length) return null;   // a blend: every pixel half way
  const nNew = isNew.filter(Boolean).length, share = nNew / idx.length;
  if (share < 0.08 || share > 0.92) return null;
  const iou = (inside: (x: number, y: number) => boolean) => { let both = 0, either = 0; idx.forEach((i, k) => { const m = inside(i % W, (i / W) | 0); if (m && isNew[k]) both++; if (m || isNew[k]) either++; }); return either ? both / either : 0; };
  // where the new shot is: its middle
  let cx = 0, cy = 0; idx.forEach((i, k) => { if (isNew[k]) { cx += i % W; cy += (i / W) | 0; } }); cx /= nNew; cy /= nNew;
  const best: [Shape, number][] = [];
  for (const kind of ["iris", "diamond", "heart", "star"] as const) {
    // the size that gives the same amount of new picture, then how well the shape fits
    let lo = 0.5, hi = 2 * Math.hypot(W, H);
    for (let it = 0; it < 18; it++) { const R = (lo + hi) / 2; let n = 0; idx.forEach((i) => { if (shapeInside(kind, (i % W - cx) / R, (((i / W) | 0) - cy) / R)) n++; }); if (n / idx.length < share) lo = R; else hi = R; }
    const R = (lo + hi) / 2;
    best.push([kind, iou((x, y) => shapeInside(kind, (x - cx) / R, (y - cy) / R))]);
  }
  // a straight wipe: the best of 8 directions, its edge where the share matches
  let wipe = 0;
  for (let d = 0; d < 8; d++) {
    const ang = (d * Math.PI) / 4, ux = Math.cos(ang), uy = Math.sin(ang), proj = idx.map((i) => (i % W) * ux + ((i / W) | 0) * uy).sort((a, b) => a - b);
    const edge = proj[Math.min(proj.length - 1, Math.floor(share * proj.length))];
    wipe = Math.max(wipe, iou((x, y) => x * ux + y * uy <= edge));
  }
  best.push(["wipe", wipe]);
  // bars: columns that are mostly new next to columns that are mostly old, in a regular stripe
  const cols = 6, colNew = new Array(cols).fill(0), colN = new Array(cols).fill(0);
  idx.forEach((i, k) => { const c = Math.min(cols - 1, Math.floor(((i % W) / W) * cols)); colN[c]++; if (isNew[k]) colNew[c]++; });
  const fr = colNew.map((v, c) => (colN[c] ? v / colN[c] : 0.5));
  // alternate columns fill from opposite edges: within a column the new part is at the top for one, the bottom for the next
  let alt = 0; for (let c = 0; c < cols; c++) { let top = 0, bot = 0, nt = 0, nb = 0; idx.forEach((i, k) => { if (Math.min(cols - 1, Math.floor(((i % W) / W) * cols)) !== c) return; const y = (i / W) | 0; if (y < H / 2) { nt++; if (isNew[k]) top++; } else { nb++; if (isNew[k]) bot++; } });
    const d = (nt ? top / nt : 0) - (nb ? bot / nb : 0); alt += c % 2 ? d : -d; }
  const barsScore = Math.min(1, Math.abs(alt) / cols) * (1 - Math.abs(fr.reduce((a, b) => a + b, 0) / cols - share));
  best.push(["bars", barsScore]);
  best.sort((a, b) => b[1] - a[1]);
  return best[0][1] >= 0.55 ? best[0][0] : null;
}

export interface Motion { s: number; dx: number; dy: number; r: number; diff: number }
/** How frame B is frame A moved: zoomed by s, shifted by dx / dy (fractions of the frame) and turned by r degrees;
 * diff is how different they still are after that (0 = the same picture). Coarse to fine: zoom, then shift, then
 * zoom and turn again. */
export function motionBetween(A: Float32Array, B: Float32Array, W: number, H: number): Motion {
  const cx = W / 2, cy = H / 2, x0 = Math.round(W * 0.15), x1 = Math.round(W * 0.85), y0 = Math.round(H * 0.15), y1 = Math.round(H * 0.85);
  const cost = (s: number, dx: number, dy: number, rDeg: number) => {
    const c = Math.cos((-rDeg * Math.PI) / 180), sn = Math.sin((-rDeg * Math.PI) / 180);
    let sum = 0, n = 0;
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
      const u = (x - cx - dx) / s, v = (y - cy - dy) / s, ax = Math.round(cx + u * c - v * sn), ay = Math.round(cy + u * sn + v * c);
      if (ax < 0 || ay < 0 || ax >= W || ay >= H) continue;
      sum += Math.abs(B[y * W + x] - A[ay * W + ax]); n++;
    }
    return n ? sum / n + 0.0002 * (dx * dx + dy * dy) + 0.001 * Math.abs(s - 1) : 1;
  };
  let bs = 1, bdx = 0, bdy = 0, br = 0, best = cost(1, 0, 0, 0);
  for (let s = 0.86; s <= 1.18; s += 0.02) { const v = cost(s, 0, 0, 0); if (v < best) { best = v; bs = s; } }
  const m = Math.max(3, Math.round(W / 10));
  for (let dy = -m; dy <= m; dy++) for (let dx = -m; dx <= m; dx++) { const v = cost(bs, dx, dy, 0); if (v < best) { best = v; bdx = dx; bdy = dy; } }
  for (let s = bs - 0.02; s <= bs + 0.021; s += 0.01) for (let r = -8; r <= 8; r += 2) { const v = cost(s, bdx, bdy, r); if (v < best) { best = v; bs = s; br = r; } }
  return { s: +bs.toFixed(3), dx: bdx / W, dy: bdy / H, r: br, diff: best };
}

export interface MoveKey { f: number; s: number; x: number; y: number; r: number }
export interface ShotMove { keys: MoveKey[]; ease: "lin" | "inOut" | "outCubic" | "outExpo"; shake: boolean; freeze: number | null; zoom: "in" | "out" | "none" }
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** A shot's camera move from frames at fractions fs (0 = its start, 1 = its end): cumulative zoom / position /
 * rotation, kept to the few keyframes that matter (at most 5), the ease that shapes it, a shake, a freeze. */
export function shotMove(frames: Float32Array[], fs: number[], W: number, H: number): ShotMove {
  const pts: MoveKey[] = [{ f: fs[0] ?? 0, s: 1, x: 0, y: 0, r: 0 }];
  let S = 1, X = 0, Y = 0, R = 0, freeze: number | null = null, flips = 0, lastSign = 0;
  const meanOf = (F: Float32Array) => { let s = 0; for (let i = 0; i < F.length; i++) s += F[i]; return s / F.length; };
  for (let k = 1; k < frames.length; k++) {
    // a step across a flash, a fade or a jump in the light is not a camera move: it adds nothing (the move goes on after it)
    if (Math.abs(meanOf(frames[k - 1]) - meanOf(frames[k])) > 0.08) { pts.push({ f: fs[k], s: S, x: X, y: Y, r: R }); continue; }
    const m = motionBetween(frames[k - 1], frames[k], W, H);
    if (m.diff > 0.12) { pts.push({ f: fs[k], s: S, x: X, y: Y, r: R }); continue; }   // no move explains it (a cut inside the shot): not read
    const still = m.diff < 0.006 && Math.abs(m.s - 1) < 0.005 && !m.dx && !m.dy;
    if (still && freeze === null) freeze = fs[k - 1];
    S *= m.s; X += m.dx; Y += m.dy; R += m.r;
    const sg = Math.sign(m.dx); if (Math.abs(m.dx) * W >= 2 && sg && lastSign && sg !== lastSign) flips++; if (sg && Math.abs(m.dx) * W >= 2) lastSign = sg;
    pts.push({ f: fs[k], s: S, x: X, y: Y, r: R });
  }
  // the shot's own start and end set the move; points in between stay only where the path bends
  const keep = [pts[0], pts[pts.length - 1]];
  const bend = (p: MoveKey, a: MoveKey, b: MoveKey) => { const t = (p.f - a.f) / Math.max(1e-6, b.f - a.f), L = (u: number, v: number) => u + (v - u) * t;
    return Math.max(Math.abs(p.s - L(a.s, b.s)) * 4, Math.abs(p.x - L(a.x, b.x)) * 6, Math.abs(p.y - L(a.y, b.y)) * 6, Math.abs(p.r - L(a.r, b.r)) / 4); };
  for (let it = 0; it < 3; it++) {
    let worst = null as MoveKey | null, wv = 0.12;
    for (const p of pts) { if (keep.includes(p)) continue; const a = [...keep].filter((q) => q.f < p.f).sort((u, v) => v.f - u.f)[0], b = [...keep].filter((q) => q.f > p.f).sort((u, v) => u.f - v.f)[0]; if (!a || !b) continue; const v = bend(p, a, b); if (v > wv) { wv = v; worst = p; } }
    if (!worst) break; keep.push(worst); keep.sort((u, v) => u.f - v.f);
  }
  const end = pts[pts.length - 1], total = Math.abs(end.s - 1) * 4 + Math.hypot(end.x, end.y) * 6 + Math.abs(end.r) / 4;
  // ease: how much of the move is done a quarter of the way in
  let ease: ShotMove["ease"] = "lin";
  if (total > 0.08 && pts.length >= 3) {
    const q = pts.reduce((b, p) => (Math.abs(p.f - (pts[0].f + 0.25 * (end.f - pts[0].f))) < Math.abs(b.f - (pts[0].f + 0.25 * (end.f - pts[0].f))) ? p : b), pts[0]);
    const done = (Math.abs(q.s - 1) * 4 + Math.hypot(q.x, q.y) * 6 + Math.abs(q.r) / 4) / total;
    ease = done > 0.7 ? "outExpo" : done > 0.45 ? "outCubic" : done < 0.15 ? "inOut" : "lin";
  }
  const zoom = end.s >= 1.04 ? "in" : end.s <= 0.96 ? "out" : "none";
  return { keys: keep.map((p) => ({ f: r3(p.f), s: r3(p.s), x: r3(p.x), y: r3(p.y), r: Math.round(p.r) })), ease, shake: flips >= 2, freeze, zoom };
}
