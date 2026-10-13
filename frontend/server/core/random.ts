/** Python's random.Random (Mersenne Twister MT19937, seeded like CPython's random.seed(int)): the same seed gives the
 * same numbers as the Python backend did, so a version's seed still gives the same edit. */
export class PyRandom {
  private mt = new Uint32Array(624);
  private i = 625;

  constructor(seed = 0) {
    this.seed(seed);
  }

  private initGenrand(s: number) {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = (Math.imul(1812433253, prev) + i) >>> 0;
    }
    this.i = 624;
  }

  /** random.seed(n) for an int: the absolute value split into 32-bit words (little end first). */
  seed(n: number) {
    let v = BigInt(Math.abs(Math.trunc(n)));
    const key: number[] = [];
    const MASK = BigInt(0xffffffff), SHIFT = BigInt(32), ZERO = BigInt(0);
    do {
      key.push(Number(v & MASK));
      v >>= SHIFT;
    } while (v > ZERO);
    this.initGenrand(19650218);
    let i = 1, j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ Math.imul(prev, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { this.mt[0] = this.mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const prev = this.mt[i - 1] ^ (this.mt[i - 1] >>> 30);
      this.mt[i] = ((this.mt[i] ^ Math.imul(prev, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { this.mt[0] = this.mt[623]; i = 1; }
    }
    this.mt[0] = 0x80000000;
    this.i = 624;
  }

  private next32(): number {
    if (this.i >= 624) {
      const mt = this.mt;
      for (let k = 0; k < 624; k++) {
        const y = (mt[k] & 0x80000000) | (mt[(k + 1) % 624] & 0x7fffffff);
        mt[k] = mt[(k + 397) % 624] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.i = 0;
    }
    let y = this.mt[this.i++];
    y ^= y >>> 11;
    y = (y ^ ((y << 7) & 0x9d2c5680)) >>> 0;
    y = (y ^ ((y << 15) & 0xefc60000)) >>> 0;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** random.random(): 53-bit float in [0, 1). */
  random(): number {
    const a = this.next32() >>> 5, b = this.next32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  /** random.uniform(a, b) */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.random();
  }

  /** random.getrandbits(k) (k up to 53 here), as a number. */
  getrandbits(k: number): number {
    if (k <= 32) return this.next32() >>> (32 - k);
    let out = 0, shift = 0;
    while (k > 0) {
      let r = this.next32();
      if (k < 32) r >>>= 32 - k;
      out += r * 2 ** shift;
      shift += 32;
      k -= 32;
    }
    return out;
  }
}
