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

/** The autocorrelation of a real signal (all lags 0..n-1), as librosa.autocorrelate: via the power spectrum. */
export function autocorrelate(x: ArrayLike<number>, maxSize = x.length): Float64Array {
  const n = x.length;
  const m = nextPow2(2 * n - 1);
  const re = new Float64Array(m), im = new Float64Array(m);
  for (let i = 0; i < n; i++) re[i] = x[i];
  fft(re, im);
  for (let i = 0; i < m; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
  fft(re, im, true);
  return re.slice(0, Math.min(maxSize, n));
}
