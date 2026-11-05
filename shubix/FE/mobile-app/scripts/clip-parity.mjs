// Does the phone's clip reading (ClipStats.kt, ClipScan.kt) give the numbers of the JavaScript one (brain/edit.ts, brain/pure.ts)? On the same frames.
//   node scripts/clip-parity.mjs <small.rgba: 48x27 frames> <big.rgba: 128x72 frames> <the Kotlin answer, JSON> <a folder for the bundle> <frames a second>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url)), [smallF, bigF, answer, work, fpsArg] = process.argv.slice(2), fps = Number(fpsArg);
const made = async (file, name) => { const out = join(work, name); await build({ entryPoints: [join(here, "..", "engine", "brain", file)], bundle: true, format: "esm", platform: "node", outfile: out, logLevel: "error" }); return import("file:///" + out.replace(/\\/g, "/")); };
const { createBrain } = await made("index.ts", "brain.mjs"), { findScenes, scanFinish } = await made("pure.ts", "pure.mjs");
const brain = createBrain({}, { SW: 48, SH: 27, FEAT: 120 }), ss = 48 * 27 * 4, bs = 128 * 72 * 4;
const small = readFileSync(smallF), big = readFileSync(bigF), kt = JSON.parse(readFileSync(answer, "utf8")), n = Math.min(small.length / ss, big.length / bs);
const names = ["m", "b", "cx", "sh", "sx", "sy", "sw", "gx", "gy", "ax", "ay", "aw"], worst = Object.fromEntries(names.map((k) => [k, 0]));
const smallAt = (f) => small.subarray(f * ss, (f + 1) * ss);
let prev = null, histWorst = 0; const S = [], H = [], LM = [];
const t0 = performance.now();
for (let f = 0; f < n; f++) {
  const r = brain.frameStats(smallAt(f), big.subarray(f * bs, (f + 1) * bs), prev); prev = r.lum;
  names.forEach((k, i) => { worst[k] = Math.max(worst[k], Math.abs(r.row[k] - kt.rows[f][i])); });
  r.hist.forEach((v, i) => { histWorst = Math.max(histWorst, Math.abs(v - kt.hists[f][i])); });
  S.push({ t: f / fps, ...r.row }); H.push(r.hist); LM.push(r.lum);
}
if (S.length > 1) S[0].m = S[1].m;
const scenes = await findScenes(async (t) => brain.colorHist(smallAt(Math.max(0, Math.min(n - 1, Math.round(t * fps))))), S, H, LM), samples = scanFinish(S, scenes);
const ms = Math.round(performance.now() - t0), fails = [];
if (histWorst >= 1e-5) fails.push(`histogram ${histWorst}`);
for (const k of names) if (worst[k] >= (k === "sh" ? 1e-2 : 1e-5)) fails.push(`${k} ${worst[k]}`);
const a = kt.scan;
if (scenes.length !== a.scenes.length) fails.push(`scenes: ${JSON.stringify(scenes).slice(0, 200)} / ${JSON.stringify(a.scenes).slice(0, 200)}`);
else scenes.forEach((c, i) => { const q = a.scenes[i]; if (c.kind !== q.kind || Math.abs(c.t0 - q.t0) > 1e-3 || Math.abs(c.t1 - q.t1) > 1e-3 || Math.abs((c.tc ?? 0) - (q.tc ?? 0)) > 1e-3 || !!c.white !== !!q.white) fails.push(`scene ${i}: ${JSON.stringify(c)} / ${JSON.stringify(q)}`); });
if (samples.length !== a.samples.length) fails.push("samples length");
else samples.forEach((s, i) => { const q = a.samples[i]; if (Math.abs(s.m - q.m) > 1e-5 || Math.abs(s.sw - q.sw) > 1e-5 || !!s.cut !== !!q.cut) if (fails.length < 6) fails.push(`sample ${i}: m ${s.m}/${q.m} sw ${s.sw}/${q.sw} cut ${s.cut}/${q.cut}`); });
console.log(`${fails.length ? "FAIL" : "PASS"}  ${n} frames  js ${ms} ms  kotlin ${kt.ms} ms  scenes: ${scenes.map((c) => `${c.kind}@${c.t0.toFixed(2)}`).join(" ") || "none"}`);
for (const f of fails.slice(0, 8)) console.log("  " + f.slice(0, 260));
process.exit(fails.length ? 1 : 0);
