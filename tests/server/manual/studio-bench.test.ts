// @vitest-environment node
// Benchmark: Fast Studio's in-browser beat analysis vs the server's (Essentia, Beat This!). Not part of the suite: temporary.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { it } from "vitest";
import { analyzeAudio } from "@/server/audio/analyzer";
import { decode } from "@/server/audio/decode";
import { essentiaBeats } from "@/server/audio/essentia";
import { findBinary } from "@/server/core/ffmpeg";
import { rng } from "../rng";
import { writeWav } from "../audio/fixtures";

const SRW = 44100;

function score(est: number[], ref: number[], window = 0.07) {
  const pairs: [number, number, number][] = [];
  est.forEach((e, i) => ref.forEach((r, j) => { if (Math.abs(e - r) <= window) pairs.push([Math.abs(e - r), i, j]); }));
  pairs.sort((a, b) => a[0] - b[0]);
  const ue = new Set<number>(), ur = new Set<number>(), off: number[] = [];
  for (const [, i, j] of pairs) if (!ue.has(i) && !ur.has(j)) { ue.add(i); ur.add(j); off.push(est[i] - ref[j]); }
  const p = est.length ? ue.size / est.length : 0, r = ref.length ? ur.size / ref.length : 0;
  return { f: p + r ? (2 * p * r) / (p + r) : 0, p, r, off: off.length ? (1000 * off.reduce((a, b) => a + b, 0)) / off.length : NaN };
}
/** share of estimates within `w` of any reference time (cuts landing on a real hit) */
const hitRate = (est: number[], ref: number[], w = 0.05) => est.length ? est.filter((e) => ref.some((r) => Math.abs(e - r) <= w)).length / est.length : 0;

// ---------- Fast Studio's analysis, taken verbatim from components/studio/engine.ts ----------
const ENGINE = fs.readFileSync(path.resolve("components/studio/engine.ts"), "utf8");
const MUSIC = ENGINE.slice(ENGINE.indexOf("function songAnalysis("), ENGINE.indexOf("function analyseInWorker("));
function studio(channels: Float32Array[], sr: number, opts?: { beats?: number[] }) {
  // what the page does: average the channels, then run songAnalysis (in a worker there; the same function)
  const mono = new Float32Array(channels[0].length);
  for (const d of channels) for (let i = 0; i < mono.length; i++) mono[i] += d[i] / channels.length;
  const run = new Function("mono", "sr", "opts", `${MUSIC}
 return songAnalysis(mono, sr, opts);`);
  return run(mono, sr, opts) as { period: number; beats: number[]; cuts: number[]; cutType: string[]; beatSource: string };
}
/** what the browser hands the page: stereo at the AudioContext rate (48 kHz on most Windows / phones) */
function decodeStereo(file: string, sr = 48000): Float32Array[] {
  const raw = execFileSync(findBinary("ffmpeg"), ["-loglevel", "error", "-i", file, "-vn", "-ac", "2", "-ar", String(sr), "-f", "f32le", "pipe:1"], { maxBuffer: 1 << 30 });
  const all = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4), n = all.length / 2;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }
  return [L, R];
}

// ---------- songs with known beats ----------
type Truth = { beats: number[]; hits: number[]; bpm: number | string };
function drumTrack(beatTimes: number[], opts: { melody?: boolean; synco?: boolean; seed?: number } = {}): { y: Float32Array; truth: Truth } {
  const end = beatTimes[beatTimes.length - 1] + 1.5, n = Math.round(end * SRW), y = new Float32Array(n), r = rng(opts.seed ?? 7), noise = () => r.next() * 2 - 1;
  const add = (t: number, len: number, f: (i: number) => number) => { const s = Math.round(t * SRW); for (let i = 0; i < len && s + i < n; i++) y[s + i] += f(i); };
  const kick = (t: number, g: number) => add(t, Math.round(0.25 * SRW), (i) => g * Math.sin(2 * Math.PI * (55 + 60 * Math.exp(-i / (0.03 * SRW))) * (i / SRW)) * Math.exp(-i / (0.09 * SRW)));
  const snare = (t: number) => add(t, Math.round(0.18 * SRW), (i) => 0.45 * (0.7 * noise() + 0.3 * Math.sin(2 * Math.PI * 190 * (i / SRW))) * Math.exp(-i / (0.045 * SRW)));
  let hp = 0, prev = 0;
  const hat = (t: number) => add(t, Math.round(0.04 * SRW), (i) => { const x = noise(); hp = 0.85 * (hp + x - prev); prev = x; return 0.16 * hp * Math.exp(-i / (0.008 * SRW)); });
  const hits: number[] = [];
  beatTimes.forEach((t, k) => {
    const next = beatTimes[k + 1] ?? t + (t - beatTimes[k - 1]), half = (next - t) / 2, inBar = k % 4;
    if (inBar === 0 || inBar === 2) { kick(t, inBar === 0 ? 0.9 : 0.55); hits.push(t); } else { snare(t); hits.push(t); }
    if (opts.synco && inBar === 1) { kick(t + half, 0.6); hits.push(t + half); } // kick on the "and" of 2
    hat(t); hat(t + half);
    if (opts.melody) { // a sung-like line: a new note every half beat, with vibrato, louder than the drums' body
      for (const [st, f0] of [[t + half * 0.5, 220 * Math.pow(2, ((k * 5) % 12) / 12)], [t + half * 1.5, 220 * Math.pow(2, ((k * 7 + 3) % 12) / 12)]] as const) {
        add(st, Math.round(half * SRW), (i) => { const tt = i / SRW, env = Math.min(1, tt / 0.03) * Math.exp(-tt / 0.6); return 0.22 * env * Math.sin(2 * Math.PI * f0 * tt + 3 * Math.sin(2 * Math.PI * 5.5 * tt)); });
      }
    }
  });
  for (let i = 0; i < n; i++) y[i] += 0.002 * noise();
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v)); for (let i = 0; i < n; i++) y[i] *= 0.9 / m;
  return { y, truth: { beats: beatTimes, hits, bpm: "" } };
}
const grid = (bpm: number, from: number, to: number) => { const out: number[] = []; for (let t = from; t < to; t += 60 / bpm) out.push(t); return out; };

function synthetic(): { name: string; y: Float32Array; truth: Truth }[] {
  const list: { name: string; y: Float32Array; truth: Truth }[] = [];
  const add = (name: string, bpm: number | string, beats: number[], o?: Parameters<typeof drumTrack>[1]) => { const d = drumTrack(beats, o); d.truth.bpm = bpm; list.push({ name, ...d }); };
  add("drums 100 BPM", 100, grid(100, 0.5, 40));
  add("drums 128 + melody", 128, grid(128, 0.5, 40), { melody: true });
  add("140 syncopated + melody", 140, grid(140, 0.5, 40), { synco: true, melody: true });
  add("tempo change 95->128", "95->128", [...grid(95, 0.5, 20), ...grid(128, 20 + 60 / 95, 40)]);
  { const r = rng(3), b: number[] = []; let t = 0.5; while (t < 40) { const bpm = 108 + 6 * (t / 40); b.push(t + (r.next() - 0.5) * 0.03); t += 60 / bpm; } add("live feel 108->114, +-15ms", "108->114", b, { seed: 4 }); }
  add("slow 72 BPM", 72, grid(72, 0.5, 40), { melody: true });
  add("fast 174 (DnB)", 174, grid(174, 0.5, 40));
  { const all = grid(120, 0.5, 40), d = drumTrack(all, { melody: true, seed: 9 }), a = Math.round(16 * SRW), b = Math.round(24 * SRW);
    // breakdown 16-24 s: the whole mix drops to 15% (beats there are not scored)
    for (let i = a; i < b; i++) d.y[i] *= 0.15;
    list.push({ name: "breakdown 120 (quiet 16-24 s)", y: d.y, truth: { beats: all.filter((t) => t < 16 || t > 24), hits: d.truth.hits, bpm: 120 } }); }
  return list;
}

const CACHE = path.join(os.tmpdir(), "studio-bench-server.json");
const cache: Record<string, { ess: { beats: number[]; bpm: number }; a: { beats: number[]; bpm: number; beatSource: string; onsets: number[]; duration: number }; tEss: number; tSrv: number }> = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};
async function server(file: string, key: string) {
  if (!cache[key]) {
    let t0 = performance.now(); const e = await essentiaBeats(await decode(file, 44100)); const tEss = performance.now() - t0;
    t0 = performance.now(); const x = await analyzeAudio(file); const tSrv = performance.now() - t0;
    cache[key] = { ess: { beats: e.beats, bpm: e.bpm }, a: { beats: x.beats, bpm: x.bpm, beatSource: x.beatSource, onsets: x.onsets, duration: x.duration }, tEss, tSrv };
    fs.writeFileSync(CACHE, JSON.stringify(cache));
  }
  return cache[key];
}
const fmtS = (s: ReturnType<typeof score>) => `F ${s.f.toFixed(2)} (P ${s.p.toFixed(2)} R ${s.r.toFixed(2)}, ${Number.isNaN(s.off) ? "-" : s.off.toFixed(0) + "ms"})`;
const bpmOf = (beats: number[]) => { const d = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b); return d.length ? 60 / d[d.length >> 1] : 0; };

// a manual benchmark (up to an hour, needs real songs): run it with STUDIO_BENCH=1 npx vitest run tests/server/manual
it.skipIf(!process.env.STUDIO_BENCH)("Fast Studio vs server beat accuracy", { timeout: 3_600_000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench_")), lines: string[] = [];
  const log = (s: string) => { lines.push(s); console.log(s); };
  log("## Synthetic songs (true beats known), F-measure at +-70 ms");
  for (const s of synthetic()) {
    const wav = path.join(dir, s.name.replace(/\W+/g, "_") + ".wav");
    writeWav(wav, s.y, SRW);
    const mp3 = wav.replace(/\.wav$/, ".mp3"); // what people upload
    execFileSync(findBinary("ffmpeg"), ["-y", "-loglevel", "error", "-i", wav, "-b:a", "192k", mp3]);
    const t0 = performance.now(); const st = studio(decodeStereo(mp3), 48000); const tStudio = performance.now() - t0;
    const { ess, a, tEss, tSrv } = await server(mp3, "syn:" + s.name);
    log(`\n### ${s.name} (true ${s.truth.bpm} BPM)`);
    log(`Fast Studio : ${fmtS(score(st.beats, s.truth.beats))}  bpm ${(60 / st.period).toFixed(1)}  ${tStudio.toFixed(0)} ms  | cuts on a real hit: ${(100 * hitRate(st.cuts.filter((c) => c > 0.1), s.truth.hits)).toFixed(0)}% of ${st.cuts.length}`);
    { const ai = studio(decodeStereo(mp3), 48000, { beats: a.beats }); log(`Studio + AI : ${fmtS(score(ai.beats, s.truth.beats))}  bpm ${(60 / ai.period).toFixed(1)}  picked ${ai.beatSource}`); }
    log(`Essentia    : ${fmtS(score(ess.beats, s.truth.beats))}  bpm ${ess.bpm.toFixed(1)}  ${tEss.toFixed(0)} ms`);
    log(`Server final: ${fmtS(score(a.beats, s.truth.beats))}  bpm ${a.bpm.toFixed(1)}  ${tSrv.toFixed(0)} ms  (${a.beatSource})`);
  }
  log("\n## Real songs (no ground truth: measured against Beat This!, the server's neural tracker)");
  const songs = fs.readdirSync("storage/songs").filter((f) => /\.(mp3|mpeg)$/.test(f)).map((f) => path.join("storage/songs", f));
  const extra = "TestFile/songs_20261014_154722/songs_20261014_154722.mp3";
  if (fs.existsSync(extra)) songs.push(extra);
  const seen = new Set<number>();
  for (const f of songs) {
    const size = fs.statSync(f).size; if (seen.has(size)) continue; seen.add(size);
    let a, ess; try { ({ a, ess } = await server(f, "real:" + path.basename(f) + ":" + size)); } catch (e) { log(`${path.basename(f)}: skipped (${(e as Error).message})`); continue; }
    if (a.duration < 8) { log(`${path.basename(f)}: skipped (${a.duration}s)`); continue; }
    const t0 = performance.now(), st = studio(decodeStereo(f), 48000), tS = performance.now() - t0;
    log(`\n### ${path.basename(f)} (${a.duration.toFixed(0)} s, Beat This! ${a.bpm.toFixed(1)} BPM, source ${a.beatSource})`);
    log(`Fast Studio vs Beat This!: ${fmtS(score(st.beats, a.beats))}  bpm ${(60 / st.period).toFixed(1)} | cuts on a server onset: ${(100 * hitRate(st.cuts.filter((c) => c > 0.1), a.onsets)).toFixed(0)}%  ${tS.toFixed(0)} ms`);
    { const ai = studio(decodeStereo(f), 48000, { beats: a.beats }); log(`Studio + AI vs Beat This!: ${fmtS(score(ai.beats, a.beats))}  bpm ${(60 / ai.period).toFixed(1)}  picked ${ai.beatSource}`); }
    log(`Essentia    vs Beat This!: ${fmtS(score(ess.beats, a.beats))}  bpm ${ess.bpm.toFixed(1)} (intervals ${bpmOf(ess.beats).toFixed(1)})`);
  }
  fs.writeFileSync(path.join(os.tmpdir(), "studio-bench.txt"), lines.join("\n"));
});
