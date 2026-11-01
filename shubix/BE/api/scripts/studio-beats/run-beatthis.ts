// Runs the server's Beat This! on every .wav of the given folders and writes beatthis.json there:
//   (in BE/api) npx tsx scripts/studio-beats/run-beatthis.ts ../../FE/web-app/scripts/studio-beats/set3
import fs from "node:fs";
import path from "node:path";
import { beatThis, BEAT_THIS_SR } from "../../src/server/audio/beatThis";
function readWav(f: string) { const d = fs.readFileSync(f); let o = 12, sr = 44100, data: Buffer | null = null;
  while (o < d.length) { const id = d.toString("ascii", o, o + 4), sz = d.readUInt32LE(o + 4); if (id === "fmt ") sr = d.readUInt32LE(o + 12); if (id === "data") { data = d.subarray(o + 8, o + 8 + sz); break; } o += 8 + sz; }
  const x = new Float32Array(data!.length / 2); for (let i = 0; i < x.length; i++) x[i] = data!.readInt16LE(i * 2) / 32768; return { x, sr }; }
function resample(x: Float32Array, sr: number, to: number) { const n = Math.floor(x.length * to / sr), y = new Float32Array(n), r = sr / to;
  for (let i = 0; i < n; i++) { const t = i * r, k = Math.floor(t), f = t - k; y[i] = (x[k] ?? 0) * (1 - f) + (x[k + 1] ?? 0) * f; } return y; }
(async () => {
  for (const dir of process.argv.slice(2)) {
    const out: Record<string, { beats: number[]; downbeats: number[]; ms: number }> = {};
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".wav")).sort()) {
      const { x, sr } = readWav(path.join(dir, f)); const t0 = Date.now();
      const r = await beatThis(resample(x, sr, BEAT_THIS_SR)); out[f.slice(0, -4)] = { beats: r.beats, downbeats: r.downbeats, ms: Date.now() - t0 };
      console.log(dir.split("/").pop(), f, r.beats.length, "beats", Date.now() - t0, "ms");
    }
    fs.writeFileSync(path.join(dir, "beatthis.json"), JSON.stringify(out));
  }
})();
