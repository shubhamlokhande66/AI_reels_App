// @vitest-environment node
import fs from "node:fs";
import { it } from "vitest";
import { beatThis } from "@/server/audio/beatThis";
import { decode } from "@/server/audio/decode";
const D = "C:/Users/acer/AppData/Local/Temp/claude/D--Project-AI-reels-App/14c32fb7-69c2-434e-9782-a3cfedb55487/scratchpad/testfile/";
function score(est: number[], ref: number[], win = 0.07) {
  const pairs: [number, number, number][] = [];
  est.forEach((e, i) => ref.forEach((r, j) => { if (Math.abs(e - r) <= win) pairs.push([Math.abs(e - r), i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ue = new Set<number>(), ur = new Set<number>(), off: number[] = [];
  for (const [, i, j] of pairs) if (!ue.has(i) && !ur.has(j)) { ue.add(i); ur.add(j); off.push(est[i] - ref[j]); }
  const p = est.length ? ue.size / est.length : 0, r = ref.length ? ur.size / ref.length : 0;
  return { f: +(p + r ? (2 * p * r) / (p + r) : 0).toFixed(3), est: est.length, ref: ref.length, meanOffsetMs: off.length ? +(1000 * off.reduce((a, b) => a + b, 0) / off.length).toFixed(1) : null };
}
it("bt", { timeout: 900_000 }, async () => {
  const ref = JSON.parse(fs.readFileSync(D + "songs_20261014_154722.json", "utf8"));
  const t0 = Date.now();
  const y = await decode(D + "songs_20261014_154722.mp3", 22050, 600, "mean");
  const r = await beatThis(y);
  const out = { seconds: (Date.now() - t0) / 1000, beats: r.beats, downbeats: r.downbeats, beatsVsRef: score(r.beats, ref.beats), downbeatsVsRef: score(r.downbeats, ref.downbeats), minProb: Math.min(...r.beatProbabilities) };
  fs.writeFileSync(D + "bt.json", JSON.stringify(out, null, 1));
});
