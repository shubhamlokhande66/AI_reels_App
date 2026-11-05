// Does the phone's song analysis (SongAnalysis.kt) give the numbers of the JavaScript one (song.ts)? Both run on the same sound.
//   node scripts/song-parity.mjs <folder with case-N.f32 and case-N.json> <folder with the Kotlin answers, case-N.out.json>
// Each case-N.json: { sr, beats?, forceBeats?, forceSource? }. A list must have the same length and each value within 1e-3 (times in seconds).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url)), [dir, outDir] = process.argv.slice(2);
const bundle = join(outDir, "song.mjs");
await build({ entryPoints: [join(here, "..", "shared", "core", "src", "engine", "studio", "song.ts")], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error" });
const { songAnalysis } = await import("file:///" + bundle.replace(/\\/g, "/"));
const near = (a, b, tol) => (a === b) || Math.abs(a - b) <= tol;
let bad = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort()) {
  const raw = readFileSync(join(dir, `${name}.f32`)), mono = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  const o = JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8")), t0 = performance.now();
  const js = songAnalysis(mono, o.sr, o), jsMs = Math.round(performance.now() - t0), kt = JSON.parse(readFileSync(join(outDir, `${name}.out.json`), "utf8")), fails = [];
  for (const k of ["period", "phase", "hopSec", "onFps", "onOff", "barOff"]) if (!near(js[k], kt[k], 1e-6)) fails.push(`${k}: ${js[k]} / ${kt[k]}`);
  if (js.beatSource !== kt.beatSource) fails.push(`beatSource: ${js.beatSource} / ${kt.beatSource}`);
  for (const [k, tol] of [["beats", 1e-3], ["cuts", 1e-3], ["peaks", 1e-3], ["peakS", 1e-3], ["hitsRaw", 1e-3], ["hitsStr", 1e-3], ["rmsF", 1e-4], ["pfArr", 1e-4], ["onEnv", 1e-3]]) {
    const a = Array.from(js[k]), b = kt[k];
    if (a.length !== b.length) { fails.push(`${k}: ${a.length} values / ${b.length}`); continue; }
    let worst = 0, at = -1; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > worst) { worst = d; at = i; } }
    if (worst > tol) fails.push(`${k}[${at}]: ${a[at]} / ${b[at]}`);
  }
  for (const k of ["cutType", "cutFx"]) if (JSON.stringify(js[k]) !== JSON.stringify(kt[k])) fails.push(`${k} differ`);
  if (o.beats && JSON.stringify(!!js.beatJudge) !== JSON.stringify(!!kt.beatJudge)) fails.push("beatJudge");
  console.log(`${fails.length ? "FAIL" : "PASS"}  ${name}  ${(mono.length / o.sr).toFixed(0)} s  ${js.beats.length} beats  ${js.cuts.length} cuts  ${js.beatSource}  js ${jsMs} ms  kotlin ${kt.ms} ms`);
  for (const f of fails.slice(0, 8)) console.log("      " + f.slice(0, 150));
  if (fails.length) bad++;
}
process.exit(bad ? 1 : 0);
