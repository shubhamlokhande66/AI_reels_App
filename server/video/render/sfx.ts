import fs from "node:fs";

/** Sound effects synthesised here (was audio/sfx.py): whoosh, impact, riser, pop, rendered into one stereo track at
 * their Reel times. Deterministic: seeded noise. */

const SR = 48000;
export const SFX_TYPES = ["whoosh", "impact", "riser", "pop"] as const;
const LENGTH: Record<string, number> = { whoosh: 0.45, impact: 0.7, riser: 1.5, pop: 0.12 };

function noise(n: number, seed: number): Float64Array {
  let s = (seed * 2654435761 + 1) >>> 0;
  const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 1) / 4294967297; };
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  return out;
}
const env = (n: number, attack: number, release: number) => Float64Array.from({ length: n }, (_, i) => {
  const t = i / n;
  return Math.min(Math.max(t / Math.max(attack, 1e-4), 0), 1) * Math.min(Math.max((1 - t) / Math.max(release, 1e-4), 0), 1);
});
function lowpass(x: Float64Array, cutoff: (i: number) => number): Float64Array {
  const y = new Float64Array(x.length);
  let acc = 0;
  for (let i = 0; i < x.length; i++) { acc += (1 - Math.exp((-2 * Math.PI * cutoff(i)) / SR)) * (x[i] - acc); y[i] = acc; }
  return y;
}
const geom = (a: number, b: number, n: number) => (i: number) => a * (b / a) ** (n > 1 ? i / (n - 1) : 0);

const MAKERS: Record<string, (seed: number) => Float64Array> = {
  whoosh(seed) {
    const n = Math.trunc(LENGTH.whoosh * SR), g = geom(400, 6000, n), m = 2 * n;
    const x = lowpass(noise(n, seed), (i) => { const k = Math.floor(n / 2) + i; return g(i) * (0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (m - 1))) + 300; });
    const e = env(n, 0.55, 0.45);
    return x.map((v, i) => v * e[i] * 0.9);
  },
  impact(seed) {
    const n = Math.trunc(LENGTH.impact * SR), click = lowpass(noise(n, seed), () => 2500);
    let phase = 0;
    return Float64Array.from({ length: n }, (_, i) => {
      const t = i / SR;
      phase += 55 + 70 * Math.exp(-t * 18);
      return 0.9 * Math.sin((2 * Math.PI * phase) / SR) * Math.exp(-t * 6) + 0.35 * click[i] * Math.exp(-t * 60);
    });
  },
  riser(seed) {
    const n = Math.trunc(LENGTH.riser * SR), f = geom(180, 1400, n), air = lowpass(noise(n, seed), geom(500, 9000, n)), e = env(n, 0.05, 0.03);
    let phase = 0;
    return Float64Array.from({ length: n }, (_, i) => {
      phase += f(i);
      return (0.35 * Math.sin((2 * Math.PI * phase) / SR) + 0.65 * air[i]) * (i / (n - 1)) ** 2.2 * e[i];
    });
  },
  pop() {
    const n = Math.trunc(LENGTH.pop * SR);
    return Float64Array.from({ length: n }, (_, i) => { const t = i / SR; return Math.sin(2 * Math.PI * (900 - 2500 * t) * t) * Math.exp(-t * 45) * 0.7; });
  },
};

/** Every effect ({type, at, volume}) mixed into one stereo float WAV of `duration` seconds. */
export function synthTrack(events: { type: string; at: number; volume: number }[], duration: number, out: string): string {
  const total = Math.trunc(duration * SR) + 1;
  const track = new Float64Array(total);
  events.forEach((e, i) => {
    const snd = MAKERS[e.type]?.(i);
    if (!snd) return;
    const a = Math.trunc(Math.max(e.at, 0) * SR), b = Math.min(a + snd.length, total);
    for (let k = a; k < b; k++) track[k] += snd[k - a] * e.volume;
  });
  let peak = 0;
  for (const v of track) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0.98 ? 0.98 / peak : 1;
  const buf = Buffer.alloc(44 + total * 8);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + total * 8, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write("data", 36); buf.writeUInt32LE(total * 8, 40);
  for (let i = 0; i < total; i++) { const v = track[i] * gain; buf.writeFloatLE(v, 44 + i * 8); buf.writeFloatLE(v, 48 + i * 8); }
  fs.writeFileSync(out, buf);
  return out;
}
