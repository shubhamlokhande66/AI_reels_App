import fs from "node:fs";
import { rng } from "../rng";

/** Synthetic songs with known answers (were backend/tests/conftest.make_click_track and tests/bar_song.py). */

export const SR = 22050;

/** Gaussian noise from the seeded generator (Box-Muller). */
function gauss(r: ReturnType<typeof rng>) {
  return () => Math.sqrt(-2 * Math.log(Math.max(r.next(), 1e-12))) * Math.cos(2 * Math.PI * r.next());
}

export function writeWav(path: string, y: Float32Array, sr = SR) {
  const n = y.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.trunc(Math.max(-1, Math.min(1, y[i])) * 32767), 44 + 2 * i);
  fs.writeFileSync(path, buf);
}

/** Kick-like clicks on every beat, louder on bar downbeats, with a louder second half. */
export function makeClickTrack(path: string, bpm = 120, seconds = 30, sr = SR) {
  const n = Math.trunc(seconds * sr);
  const y = new Float32Array(n);
  const period = 60 / bpm;
  const len = Math.trunc(0.08 * sr);
  const click = Float32Array.from({ length: len }, (_, i) => { const t = i / sr; return Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 45); });
  for (let k = 0; ; k++) {
    const start = Math.trunc(k * period * sr);
    if (start >= n - len) break;
    let gain = k % 4 === 0 ? 1 : 0.7;
    if (start / sr > seconds / 2) gain *= 1.4;
    for (let i = 0; i < len; i++) y[start + i] += gain * click[i];
  }
  const g = gauss(rng(0));
  for (let i = 0; i < n; i++) y[i] += 0.01 * g();
  let m = 1;
  for (const v of y) m = Math.max(m, Math.abs(v));
  for (let i = 0; i < n; i++) y[i] = Math.max(-1, Math.min(1, y[i] / m));
  writeWav(path, y, sr);
}

/** 4/4: kick on 1 (hard) and 3 (softer), snare on 2 and 4, a new chord every bar; starts `pickup` beats before bar 1. */
export function barSong(bpm = 120, bars = 16, pickup = 2, seed = 0): { y: Float32Array; downs: number[]; beats: number[] } {
  const g = gauss(rng(seed));
  const p = 60 / bpm, n = bars * 4 + pickup;
  const y = new Float64Array(Math.trunc((n * p + 1) * SR));
  const len = Math.trunc(0.12 * SR);
  const kick = Float64Array.from({ length: len }, (_, i) => { const t = i / SR; return Math.sin(2 * Math.PI * (60 + 80 * Math.exp(-t * 30)) * t) * Math.exp(-t * 18); });
  const snare = Float64Array.from({ length: len }, (_, i) => g() * Math.exp(-(i / SR) * 35) * 0.5);
  const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [247, 311, 370]];
  const downs: number[] = [];
  const mod = (a: number, m: number) => ((a % m) + m) % m;
  for (let k = 0; k < n; k++) {
    const i = Math.trunc(k * p * SR);
    const pos = mod(k - pickup, 4);
    const add = (x: Float64Array, gain: number) => { for (let j = 0; j < x.length && i + j < y.length; j++) y[i + j] += gain * x[j]; };
    if (pos === 0) { add(kick, 1); downs.push(Math.round(k * p * 1000) / 1000); }
    else if (pos === 2) add(kick, 0.75);
    else add(snare, 1);
    if (pos === 0) {
      const c = chords[mod(Math.floor((k - pickup) / 4), 4)];
      const dur = Math.trunc(4 * p * SR);
      for (let j = 0; j < dur && i + j < y.length; j++) { const tt = j / SR; y[i + j] += 0.06 * c.reduce((s, f) => s + Math.sin(2 * Math.PI * f * tt), 0); }
    }
  }
  let m = 0;
  for (const v of y) m = Math.max(m, Math.abs(v));
  return { y: Float32Array.from(y, (v) => v / m), downs, beats: Array.from({ length: n }, (_, k) => Math.round(k * p * 1000) / 1000) };
}
