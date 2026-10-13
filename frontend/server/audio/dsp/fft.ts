/** An iterative radix-2 FFT (sizes are powers of two), with cached twiddles and bit reversal. */

const tables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function table(n: number) {
  let t = tables.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    const bits = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    t = { cos, sin, rev };
    tables.set(n, t);
  }
  return t;
}

export const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;
export const nextPow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1)));

/** In place: re/im of length n (a power of two) become their DFT. `inverse` = the inverse DFT (scaled by 1/n). */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (!isPow2(n)) throw new Error(`fft size ${n} is not a power of two`);
  const { cos, sin, rev } = table(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sgn = inverse ? -1 : 1;
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sgn * sin[k * step];
        const a = start + k, b = a + half;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

const acBuffers = new Map<number, [Float64Array, Float64Array, Float64Array, Float64Array, Float64Array]>();

/** The autocorrelation of a real signal (all lags 0..n-1), as librosa.autocorrelate: the inverse of the power spectrum.
 * Both transforms are real, so each runs as a complex FFT of half the size (even / odd samples packed together). */
export function autocorrelate(x: ArrayLike<number>, maxSize = x.length): Float64Array {
  const n = x.length;
  const m = nextPow2(2 * n - 1), h = m / 2;
  let buf = acBuffers.get(m);
  if (!buf) {
    const cs = new Float64Array(h + 1), sn = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) { cs[k] = Math.cos((2 * Math.PI * k) / m); sn[k] = Math.sin((2 * Math.PI * k) / m); }
    acBuffers.set(m, (buf = [new Float64Array(h), new Float64Array(h), new Float64Array(h + 1), cs, sn]));
  }
  const [re, im, P, cs, sn] = buf;
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) { if (i % 2) im[i >> 1] = x[i]; else re[i >> 1] = x[i]; }
  fft(re, im);
  for (let k = 0; k <= h; k++) { // the power spectrum |X[k]|^2, k = 0..h
    const a = k % h, b = (h - k) % h;
    const zr = re[a], zi = im[a], cr = re[b], ci = -im[b];
    const er = 0.5 * (zr + cr), ei = 0.5 * (zi + ci), or_ = 0.5 * (zi - ci), oi = -0.5 * (zr - cr);
    const wr = cs[k], wi = -sn[k];
    const xr = er + (or_ * wr - oi * wi), xi = ei + (or_ * wi + oi * wr);
    P[k] = xr * xr + xi * xi;
  }
  for (let k = 0; k < h; k++) { // back: E[k] + i O[k] from the (real, symmetric) spectrum
    const e = 0.5 * (P[k] + P[h - k]), d = 0.5 * (P[k] - P[h - k]);
    // O[k] = d * W^-k = d (cos + i sin);  Z = E + i O
    re[k] = e - d * sn[k];
    im[k] = d * cs[k];
  }
  fft(re, im, true);
  const len = Math.min(maxSize, n);
  const out = new Float64Array(len);
  for (let i = 0; i < len; i++) out[i] = i % 2 ? im[i >> 1] : re[i >> 1];
  return out;
}

const realTables = new Map<number, { cos: Float64Array; sin: Float64Array }>();

/** |DFT| of a real frame of length n (a power of two): bins 0..n/2, via one complex FFT of n/2 (the even / odd samples
 * as real / imaginary parts), written into `out`. `re` / `im` are scratch of length n/2. */
export function rfftMag(frame: Float64Array, out: Float64Array, re: Float64Array, im: Float64Array): void {
  const n = frame.length, h = n / 2;
  for (let i = 0; i < h; i++) { re[i] = frame[2 * i]; im[i] = frame[2 * i + 1]; }
  fft(re, im);
  let t = realTables.get(n);
  if (!t) {
    const cos = new Float64Array(h + 1), sin = new Float64Array(h + 1);
    for (let k = 0; k <= h; k++) { cos[k] = Math.cos((2 * Math.PI * k) / n); sin[k] = Math.sin((2 * Math.PI * k) / n); }
    realTables.set(n, (t = { cos, sin }));
  }
  for (let k = 0; k <= h; k++) {
    const a = k % h, b = (h - k) % h;
    const zr = re[a], zi = im[a], cr = re[b], ci = -im[b]; // Z[k] and conj(Z[h-k])
    const er = 0.5 * (zr + cr), ei = 0.5 * (zi + ci); // even part
    const or_ = 0.5 * (zi - ci), oi = -0.5 * (zr - cr); // odd part (divided by i)
    const wr = t.cos[k], wi = -t.sin[k];
    const xr = er + (or_ * wr - oi * wi), xi = ei + (or_ * wi + oi * wr);
    out[k] = Math.sqrt(xr * xr + xi * xi);
  }
}
