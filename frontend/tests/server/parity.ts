import { spawnSync } from "node:child_process";
import path from "node:path";

/** Run cases through the Python backend (backend/tools/parity/run.py) and return its results, so a TypeScript port can
 * be checked against the code it replaces, case by case. Skips (returns null) when Python is not available. */
const BACKEND = path.resolve(__dirname, "../../../backend");
const PY = path.join(BACKEND, ".venv", "Scripts", "python.exe");

export function python<T = unknown>(cases: unknown[]): T[] | null {
  const r = spawnSync(PY, ["-m", "tools.parity.run"], { cwd: BACKEND, input: JSON.stringify(cases), encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    if ((r.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return null;
    throw new Error(`python parity failed: ${r.stderr || r.error}`);
  }
  return JSON.parse(r.stdout) as T[];
}

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
