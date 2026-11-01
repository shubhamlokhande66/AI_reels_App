/** numpy / scipy behaviour the music analysis relies on, reproduced exactly (index rules, edge modes, interpolation). */

export type Vec = Float64Array;

export const vec = (n: number) => new Float64Array(n);
export const from = (xs: ArrayLike<number>) => Float64Array.from(xs);

/** A 2-D array like numpy's (rows x cols, C order): rows are frequency bins / features, cols are frames. */
export class Mat {
  constructor(public rows: number, public cols: number, public data: Float64Array = new Float64Array(rows * cols)) {}
  get(r: number, c: number) {
    return this.data[r * this.cols + c];
  }
  set(r: number, c: number, v: number) {
    this.data[r * this.cols + c] = v;
  }
  row(r: number): Float64Array {
    return this.data.subarray(r * this.cols, (r + 1) * this.cols);
  }
  col(c: number): Float64Array {
    const out = new Float64Array(this.rows);
    for (let r = 0; r < this.rows; r++) out[r] = this.data[r * this.cols + c];
    return out;
  }
  map(f: (v: number) => number): Mat {
    const out = new Mat(this.rows, this.cols);
    for (let i = 0; i < this.data.length; i++) out.data[i] = f(this.data[i]);
    return out;
  }
  /** rows [a, b) */
  slice(a: number, b: number): Mat {
    return new Mat(b - a, this.cols, this.data.slice(a * this.cols, b * this.cols));
  }
  max(): number {
    let m = -Infinity;
    for (const v of this.data) if (v > m) m = v;
    return m;
  }
}

export function sum(x: ArrayLike<number>, a = 0, b = x.length): number {
  // numpy's pairwise summation is close enough here (all comparisons are tolerant); a plain loop in float64
  let s = 0;
  for (let i = a; i < b; i++) s += x[i];
  return s;
}
export const mean = (x: ArrayLike<number>, a = 0, b = x.length) => (b > a ? sum(x, a, b) / (b - a) : NaN);
export function max(x: ArrayLike<number>, a = 0, b = x.length) {
  let m = -Infinity;
  for (let i = a; i < b; i++) if (x[i] > m) m = x[i];
  return m;
}
export function min(x: ArrayLike<number>, a = 0, b = x.length) {
  let m = Infinity;
  for (let i = a; i < b; i++) if (x[i] < m) m = x[i];
  return m;
}
/** numpy.argmax: the first index of the largest value. */
export function argmax(x: ArrayLike<number>, a = 0, b = x.length) {
  let k = a;
  for (let i = a + 1; i < b; i++) if (x[i] > x[k]) k = i;
  return k;
}

/** numpy.percentile, "linear" interpolation. */
export function percentile(x: ArrayLike<number>, q: number): number {
  const n = x.length;
  if (!n) return NaN;
  const s = Float64Array.from(x).sort();
  const pos = (q / 100) * (n - 1);
  const lo = Math.floor(pos), hi = Math.min(lo + 1, n - 1);
  const f = pos - lo;
  return s[lo] + (s[hi] - s[lo]) * f;
}

export const median = (x: ArrayLike<number>) => percentile(x, 50);

/** numpy.median of a slice. */
export const medianOf = (x: ArrayLike<number>, a: number, b: number) => median(Array.prototype.slice.call(x, a, b));

/** scipy.ndimage.uniform_filter1d (mode "nearest"; an even size leans left like scipy's origin 0). */
export function uniformFilter1d(x: ArrayLike<number>, size: number): Vec {
  const n = x.length;
  const out = vec(n);
  if (!n) return out;
  const left = Math.floor(size / 2), right = size - 1 - left;
  const at = (i: number) => x[i < 0 ? 0 : i >= n ? n - 1 : i];
  let s = 0;
  for (let k = -left; k <= right; k++) s += at(k);
  for (let i = 0; i < n; i++) {
    out[i] = s / size;
    s += at(i + right + 1) - at(i - left);
  }
  return out;
}

/** numpy.convolve(a, v, mode="same"). */
export function convolveSame(a: ArrayLike<number>, v: ArrayLike<number>): Vec {
  const n = a.length, m = v.length;
  const full = vec(n + m - 1);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) full[i + j] += a[i] * v[j];
  const len = Math.max(n, m);
  const start = Math.floor((Math.min(n, m) - 1) / 2);
  return full.slice(start, start + len);
}

/** numpy.interp (xp increasing). */
export function interp(x: ArrayLike<number>, xp: ArrayLike<number>, fp: ArrayLike<number>): Vec {
  const out = vec(x.length);
  const n = xp.length;
  let j = 0;
  for (let i = 0; i < x.length; i++) {
    const t = x[i];
    if (t <= xp[0]) { out[i] = fp[0]; continue; }
    if (t >= xp[n - 1]) { out[i] = fp[n - 1]; continue; }
    while (j + 1 < n && xp[j + 1] < t) j++;
    while (j > 0 && xp[j] > t) j--;
    const x0 = xp[j], x1 = xp[j + 1];
    out[i] = x1 === x0 ? fp[j] : fp[j] + ((fp[j + 1] - fp[j]) * (t - x0)) / (x1 - x0);
  }
  return out;
}

/** The slope of numpy.polyfit(x, y, 1). */
export function slope(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  return den ? num / den : 0;
}

/** numpy.linspace. */
export function linspace(a: number, b: number, n: number): Vec {
  const out = vec(n);
  if (n === 1) { out[0] = a; return out; }
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + i * step;
  out[n - 1] = b;
  return out;
}

/** numpy.diff. */
export function diff(x: ArrayLike<number>): Vec {
  const out = vec(Math.max(x.length - 1, 0));
  for (let i = 0; i + 1 < x.length; i++) out[i] = x[i + 1] - x[i];
  return out;
}

/** numpy.argsort(x)[::-1]: indices by value, largest first (ties: the later index first, like reversing a stable sort). */
export function argsortDesc(x: ArrayLike<number>): number[] {
  return Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a] - x[b] || a - b).reverse();
}

/** numpy.argsort(x): indices by value, smallest first (stable). */
export function argsortAsc(x: ArrayLike<number>): number[] {
  return Array.from({ length: x.length }, (_, i) => i).sort((a, b) => x[a] - x[b] || a - b);
}

/** A running median along one axis with scipy's "reflect" edges (d c b a | a b c d | d c b a). */
export function medianFilter1d(x: ArrayLike<number>, size: number): Vec {
  const n = x.length;
  const out = vec(n);
  const half = Math.floor(size / 2);
  const at = (i: number) => {
    // scipy reflect: the edge sample repeats
    while (i < 0 || i >= n) i = i < 0 ? -i - 1 : 2 * n - i - 1;
    return x[i];
  };
  // a sorted window, updated one sample at a time
  const win: number[] = [];
  for (let k = -half; k < size - half; k++) win.push(at(k));
  win.sort((a, b) => a - b);
  const mid = Math.floor(size / 2);
  for (let i = 0; i < n; i++) {
    out[i] = win[mid];
    if (i + 1 >= n) break;
    const old = at(i - half), add = at(i + size - half);
    let lo = 0, hi = win.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < old) lo = m + 1; else hi = m; }
    win.splice(lo, 1);
    lo = 0; hi = win.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < add) lo = m + 1; else hi = m; }
    win.splice(lo, 0, add);
  }
  return out;
}

/** numpy.clip of a number. */
export const clip = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** numpy.finfo(float32).tiny: librosa's threshold for "zero" in float32 spectrograms. */
export const TINY32 = 1.1754943508222875e-38;
