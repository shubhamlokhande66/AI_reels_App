// Does the phone's frame reading (ClipStats.kt) give the numbers of the JavaScript one (brain/edit.ts frameStats)? On the same frames.
//   node scripts/clip-parity.mjs <small.rgba: 48x27 frames> <big.rgba: 128x72 frames> <the Kotlin answer, JSON> <a folder for the bundle>
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url)), [smallF, bigF, answer, work] = process.argv.slice(2);
const bundle = join(work, "brain.mjs");
await build({ entryPoints: [join(here, "..", "engine", "brain", "index.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error" });
const { createBrain } = await import("file:///" + bundle.replace(/\\/g, "/"));
const brain = createBrain({}, { SW: 48, SH: 27, FEAT: 120 }), ss = 48 * 27 * 4, bs = 128 * 72 * 4;
const small = readFileSync(smallF), big = readFileSync(bigF), kt = JSON.parse(readFileSync(answer, "utf8")), n = Math.min(small.length / ss, big.length / bs);
const names = ["m", "b", "cx", "sh", "sx", "sy", "sw", "gx", "gy", "ax", "ay", "aw"], worst = Object.fromEntries(names.map((k) => [k, 0]));
let prev = null, histWorst = 0;
const t0 = performance.now();
for (let f = 0; f < n; f++) {
  const r = brain.frameStats(small.subarray(f * ss, (f + 1) * ss), big.subarray(f * bs, (f + 1) * bs), prev); prev = r.lum;
  names.forEach((k, i) => { worst[k] = Math.max(worst[k], Math.abs(r.row[k] - kt.rows[f][i])); });
  r.hist.forEach((v, i) => { histWorst = Math.max(histWorst, Math.abs(v - kt.hists[f][i])); });
}
const ok = histWorst < 1e-5 && names.every((k) => worst[k] < (k === "sh" ? 1e-2 : 1e-5));
console.log(`${ok ? "PASS" : "FAIL"}  ${n} frames  js ${Math.round(performance.now() - t0)} ms  kotlin ${kt.ms} ms  worst histogram ${histWorst.toExponential(1)}`);
console.log("  " + names.map((k) => `${k} ${worst[k].toExponential(1)}`).join("  "));
process.exit(ok ? 0 : 1);
