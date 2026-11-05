import { beatThisWith, MELS } from "@mobile/core/lib/beatThis/core";
import { songAnalysis } from "@mobile/core/engine/studio/song";
import { beatThisOnDevice } from "./beatThis/client";
import { holdModel, phoneModels, runModel, songOnPhone, speechOnPhone, type Feed } from "./nativeModels";
import { speak } from "./tts/client";
import { speechProbs } from "./vad/client";
import { findFaces, personMask } from "./vision/client";

/** Do the phone's models answer as the WebAssembly copies do? The same made-up input goes to both (scripts/models-check.mjs
 * calls this; nothing in the app does). Then the real way in, through the workers, must do its work on the
 * phone's models. `voice`: a language such as hi-IN, spoken by the phone's own voice. */
const API = "/api/studio/model/";

export async function modelCheck(voice?: string) {
  const n = phoneModels();
  if (!n) throw new Error("This is not the phone's engine page");
  const ort = await import("onnxruntime-web/wasm");
  ort.env.wasm.wasmPaths = new URL("/vendor/ort/", location.href).href; ort.env.wasm.numThreads = 1;
  let seed = 12345;
  const noise = (length: number, lo = -1, hi = 1) => Float32Array.from({ length }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return lo + (hi - lo) * (seed / 2 ** 32); });
  const float = (data: Float32Array, dims: number[]): Feed => ({ type: "float32", data, dims });
  const wasmOf = async (name: string) => ort.InferenceSession.create(new Uint8Array(await (await fetch(API + name)).arrayBuffer()), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const timed = async <T>(job: () => Promise<T>): Promise<[T, number]> => { const t = performance.now(); const r = await job(); return [r, Math.round(performance.now() - t)]; };
  const rows: { model: string; diff: number; nativeMs: number; wasmMs: number; note?: string }[] = [];

  for (const [name, feeds] of [
    ["selfie_segmentation.onnx", { input_1: float(noise(256 * 256 * 3, 0, 1), [1, 256, 256, 3]) }],
    ["face_detection_short_range.onnx", { input: float(noise(128 * 128 * 3), [1, 128, 128, 3]) }],
  ] as [string, Record<string, Feed>][]) {
    await holdModel(n, API + name);
    const s = await wasmOf(name), [a, nativeMs] = await timed(() => runModel(n, API + name, feeds));
    const [b, wasmMs] = await timed(() => s.run(Object.fromEntries(Object.entries(feeds).map(([k, f]) => [k, new ort.Tensor("float32", f.data as Float32Array, f.dims)]))));
    let diff = 0;
    for (const k of Object.keys(b)) { const y = b[k].data as Float32Array, x = a[k].data; if (x.length !== y.length) throw new Error(`${name}: ${k} has ${x.length} values, not ${y.length}`); for (let i = 0; i < y.length; i++) diff = Math.max(diff, Math.abs(x[i] - y[i])); }
    rows.push({ model: name, diff, nativeMs, wasmMs });
  }

  // speech: 8 seconds, the way lib/vad/vad.worker.ts runs it
  const VAD = "silero_vad_16k_op15.onnx", sound = noise(512 * 250, -0.3, 0.3), vad = await wasmOf(VAD);
  const [phone, speechMs] = await timed(() => speechOnPhone(n, API + VAD, sound));
  const [own, ownMs] = await timed(async () => {
    const probs = new Float32Array(250), inp = new Float32Array(576), sr = new ort.Tensor("int64", BigInt64Array.from([BigInt(16000)]), []);
    let state = new ort.Tensor("float32", new Float32Array(256), [2, 1, 128]);
    for (let k = 0; k < 250; k++) {
      inp.fill(0, 0, 64); if (k) inp.set(sound.subarray(k * 512 - 64, k * 512), 0);
      inp.set(sound.subarray(k * 512, (k + 1) * 512), 64);
      const o = await vad.run({ input: new ort.Tensor("float32", inp.slice(), [1, 576]), state, sr });
      probs[k] = (o.output.data as Float32Array)[0]; state = o.stateN as typeof state;
    }
    return probs;
  });
  if (phone.length !== own.length) throw new Error(`speech: ${phone.length} values, not ${own.length}`);
  rows.push({ model: VAD, diff: phone.reduce((m, p, i) => Math.max(m, Math.abs(p - own[i])), 0), nativeMs: speechMs, wasmMs: ownMs });

  // beats: 20 seconds of clicks at 120 a minute, through all of Beat This!'s steps
  const BEAT = "beat_this_final0.int8.onnx", song = noise(22050 * 20, -0.01, 0.01);
  for (let b = 0; b < 40; b++) for (let i = 0; i < 800; i++) song[b * 11025 + i] += Math.exp(-i / 150) * Math.sin(i * 0.2);
  const fb = new Float32Array(await (await fetch(API + "mel-filterbank.bin")).arrayBuffer()), beatWasm = await wasmOf(BEAT);
  await holdModel(n, API + BEAT);
  const windowDiff = { max: 0 }, seen: Float32Array[][] = [];
  const [x, beatMs] = await timed(() => beatThisWith(song, fb, async (input, len) => { const o = await runModel(n, API + BEAT, { spect: float(input, [1, len, MELS]) }); seen.push([o.beat.data, o.downbeat.data]); return [o.beat.data, o.downbeat.data]; }));
  let w = 0;
  const [y, beatWasmMs] = await timed(() => beatThisWith(song, fb, async (input, len) => {
    const o = await beatWasm.run({ spect: new ort.Tensor("float32", input, [1, len, MELS]) }), a = o.beat.data as Float32Array, d = o.downbeat.data as Float32Array, was = seen[w++];
    for (let i = 0; i < a.length; i++) windowDiff.max = Math.max(windowDiff.max, Math.abs(a[i] - was[0][i]), Math.abs(d[i] - was[1][i]));
    return [Float32Array.from(a), Float32Array.from(d)];
  }));
  // 8-bit networks round differently from one CPU to another: the same beats, each within one of the network's frames (20 ms)
  const far = (p: number[], q: number[]) => p.length === q.length ? p.reduce((m, v, i) => Math.max(m, Math.abs(v - q[i])), 0) : Infinity;
  rows.push({ model: BEAT, diff: 0, nativeMs: beatMs, wasmMs: beatWasmMs, note: `logits up to ${windowDiff.max.toFixed(3)} apart, ${x.beats.length}/${y.beats.length} beats up to ${far(x.beats, y.beats).toFixed(3)} s, ${x.downbeats.length}/${y.downbeats.length} downbeats up to ${far(x.downbeats, y.downbeats).toFixed(3)} s` });
  const close = Math.max(far(x.beats, y.beats), far(x.downbeats, y.downbeats)) <= 0.021;

  // the song's beats and cuts: the phone's code against the page's, on the same 20 seconds
  { const [p, nativeMs] = await timed(() => songOnPhone(n, song, 22050)), [j, wasmMs] = await timed(async () => songAnalysis(song, 22050));
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
    const ok = same(p.beats, j.beats) && same(p.cuts, j.cuts) && JSON.stringify(p.cutType) === JSON.stringify(j.cutType) && Math.abs(p.period - j.period) < 1e-6;
    rows.push({ model: "song analysis", diff: ok ? 0 : 1, nativeMs, wasmMs, note: `${p.beats.length} beats, ${p.cuts.length} cuts` }); }
  // the workers: each must add to the phone's count of runs, or it fell back to its WebAssembly copy
  const runs = async () => Number(await (await fetch(`${n.base}/model?k=${n.key}`)).text());
  const worker = async (model: string, job: () => Promise<string>) => {
    const was = await runs(), [note, nativeMs] = await timed(job), went = (await runs()) - was;
    rows.push({ model: `worker: ${model}`, diff: went > 0 ? 0 : 1, nativeMs, wasmMs: 0, note: `${note}, ${went} runs on the phone` });
  };
  await worker("beats", async () => { const { ms: _, ...r } = await beatThisOnDevice(song.slice(), 22050); if (JSON.stringify(r) !== JSON.stringify(x)) throw new Error("the worker's beats differ"); return "same beats"; });
  await worker("speech", async () => { const p = await speechProbs(sound.slice(), 16000); if (p.some((v, i) => Math.abs(v - phone[i]) > 0.01)) throw new Error("the worker's speech differs"); return `${p.length} values`; });
  await worker("mask", async () => `${(await personMask(new Uint8ClampedArray(256 * 256 * 4).fill(128))).length} values`);
  await worker("faces", async () => `${(await findFaces([new Uint8ClampedArray(128 * 128 * 4).fill(128)])).length} squares`);
  if (voice) { const [r, nativeMs] = await timed(() => speak("Hello from the phone.", voice)); rows.push({ model: `voice: ${voice}`, diff: r.pcm.length ? 0 : 1, nativeMs, wasmMs: 0, note: `${r.pcm.length} samples at ${r.sr}` }); }
  return { rows, ok: close && rows.every((r) => r.diff < 0.01) };
}
