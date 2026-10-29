/** A small seeded random generator (the same cases every run). */
export function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    num: (lo: number, hi: number, dp = 3) => Number((lo + next() * (hi - lo)).toFixed(dp)),
  };
}
