/** Small helpers that behave exactly like the Python they replace, so numbers and messages come out the same. */

/** Python's round(x, n): correctly rounded, exact ties to even (round(0.0625, 3) = 0.062, JS would say 0.063). */
export function round(x: number, n = 0): number {
  if (!Number.isFinite(x)) return x;
  if (Math.abs(x) >= 1e21) return x;
  if (n < 0) return round(x / 10 ** -n, 0) * 10 ** -n; // round(1234567, -2) = 1234600
  // toFixed is correctly rounded on the exact binary value (ties away from zero); Python rounds exact ties to even.
  // An exact tie: the exact decimal expansion has a 5 at digit n+1 and only zeros after it.
  const exact = Math.abs(x).toFixed(Math.min(n + 60, 100));
  const dot = exact.indexOf(".");
  const rest = exact.slice(dot + 1 + n);
  if (rest[0] === "5" && /^50*$/.test(rest)) {
    const kept = exact.slice(0, dot + 1 + n).replace(".", "");
    const last = Number(kept[kept.length - 1] ?? 0);
    const down = Number(exact.slice(0, dot + 1 + n).replace(/\.$/, ""));
    const v = last % 2 === 0 ? down : down + 10 ** -n;
    return Math.sign(x) * Number(v.toFixed(n));
  }
  return Number(x.toFixed(n));
}

/** Python's f"{v:g}" / "%.6g" (6 significant digits, exact ties to even, no trailing zeros). */
export function g(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return v > 0 ? "inf" : v < 0 ? "-inf" : "nan";
  if (v === 0) return Object.is(v, -0) ? "-0" : "0";
  let e = Math.floor(Math.log10(Math.abs(v)));
  let r = round(v, digits - 1 - e);
  if (Math.abs(r) >= 10 ** (e + 1)) { e += 1; r = round(v, digits - 1 - e); } // 9.999995 -> 10
  if (e < -4 || e >= digits) {
    const m = round(v / 10 ** e, digits - 1);
    const mm = m.toFixed(digits - 1).replace(/\.?0+$/, "");
    return `${mm}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  return r.toFixed(Math.max(digits - 1 - e, 0)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Python's f"{v:.Nf}". */
export const fixed = (v: number, n: number) => round(v, n).toFixed(n);

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** A new id like models/timeline.new_id: 12 hex characters. */
export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Deep copy of plain JSON-like data. */
export const clone = <T>(v: T): T => structuredClone(v);

/** Python 3.12+'s sum() of floats: Neumaier compensated summation (a plain loop differs in the last bits). */
export function sum(xs: Iterable<number>): number {
  let s = 0, c = 0;
  for (const x of xs) {
    const t = s + x;
    if (Math.abs(s) >= Math.abs(x)) c += s - t + x;
    else c += x - t + s;
    s = t;
  }
  return s + c;
}
