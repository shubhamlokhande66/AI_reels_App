/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";

/** Text to speech on the phone: Piper voices (MIT; rhasspy/piper-voices, about 60 MB each, downloaded once and kept in
 * the browser's Cache Storage) run with ONNX Runtime's WebAssembly backend in this worker. The text becomes phoneme ids
 * with piper-phonemize (WebAssembly build of @diffusionstudio/piper-wasm, served from /vendor/piper/), as Piper does.
 * In: the text and the voice's model and config URLs. Out: mono PCM at the voice's sample rate. */

type In = { id: number; text: string; model: string; config: string; wasm: string; piper: string };
const CACHE = "brs-models-v1";
const sessions = new Map<string, Promise<{ s: ort.InferenceSession; cfg: PiperConfig }>>();
type PiperConfig = { audio: { sample_rate: number }; espeak: { voice: string }; inference?: { noise_scale?: number; length_scale?: number; noise_w?: number }; speaker_id_map?: Record<string, number> };
type Phonemizer = (o: object) => Promise<{ callMain: (args: string[]) => void }>;
let phonemizer: Promise<Phonemizer> | null = null;
const post = (o: object, t?: Transferable[]) => (self as unknown as Worker).postMessage(o, t ?? []);

async function bytes(url: string, onProgress?: (p: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); const hit = await cache.match(url); if (hit) return new Uint8Array(await hit.arrayBuffer()); } catch { cache = null; }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`voice download failed (${res.status})`);
  const total = +(res.headers.get("content-length") || 0), parts: Uint8Array[] = []; let got = 0;
  const rd = res.body.getReader();
  for (;;) { const { done, value } = await rd.read(); if (done) break; parts.push(value); got += value.length; if (total && onProgress) onProgress(got / total); }
  const b = new Uint8Array(got); let o = 0; for (const p of parts) { b.set(p, o); o += p.length; }
  try { await cache?.put(url, new Response(b.slice().buffer, { headers: { "content-type": "application/octet-stream" } })); } catch { /* storage full: works this time */ }
  return b;
}

// piper_phonemize.js is an Emscripten script (not a module): read once, then each text gets a fresh instance (as Piper's
// own web build does; its main() runs once per instance)
function loadPhonemizer(base: string): Promise<Phonemizer> {
  return phonemizer ??= fetch(base + "piper_phonemize.js").then((r) => r.text())
    .then((code) => new Function("module", "exports", "define", code + "\nreturn createPiperPhonemize;")(undefined, undefined, undefined) as Phonemizer)
    .catch((err) => { phonemizer = null; throw err; });
}
async function phonemeIds(text: string, voice: string, base: string): Promise<number[]> {
  const create = await loadPhonemizer(base);
  return new Promise((resolve, reject) => {
    let out = "";
    create({
      print: (d: string) => { out += d; },
      printErr: (m: string) => { if (!/warning/i.test(m)) reject(new Error(m)); },
      locateFile: (u: string) => base + u.split("/").pop(),
    }).then((m) => {
      try { m.callMain(["-l", voice, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"]); resolve(JSON.parse(out).phoneme_ids); }
      catch (err) { reject(err); }
    }, reject);
  });
}

// long text: by sentences (a few hundred letters at most each), joined with a short pause
function chunks(text: string, max = 300): string[] {
  const out: string[] = []; let cur = "";
  for (const s of text.match(/[^.!?।\n]+[.!?।]*\s*/g) ?? [text]) {
    if ((cur + s).length > max && cur.trim()) { out.push(cur.trim()); cur = ""; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  try {
    ort.env.wasm.wasmPaths = m.wasm; ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
    if (!sessions.has(m.model)) sessions.set(m.model, (async () => {
      const cfg = JSON.parse(new TextDecoder().decode(await bytes(m.config))) as PiperConfig;
      const model = await bytes(m.model, (p) => post({ id: m.id, type: "progress", stage: "download", p }));
      return { s: await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), cfg };
    })().catch((err) => { sessions.delete(m.model); throw err; }));
    const { s, cfg } = await sessions.get(m.model)!, sr = cfg.audio.sample_rate, inf = cfg.inference ?? {};
    const parts = chunks(m.text), pcms: Float32Array[] = [], gap = new Float32Array(Math.round(0.18 * sr));
    for (let k = 0; k < parts.length; k++) {
      post({ id: m.id, type: "progress", stage: "speak", p: k / parts.length });
      const ids = await phonemeIds(parts[k], cfg.espeak.voice, m.piper);
      const feeds: Record<string, ort.Tensor> = {
        input: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale ?? 0.667, inf.length_scale ?? 1, inf.noise_w ?? 0.8]), [3]),
      };
      if (cfg.speaker_id_map && Object.keys(cfg.speaker_id_map).length) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([BigInt(0)]), [1]);
      const o = await s.run(feeds);
      pcms.push(new Float32Array(o.output.data as Float32Array)); if (k < parts.length - 1) pcms.push(gap);
    }
    const n = pcms.reduce((a, p) => a + p.length, 0), pcm = new Float32Array(n); let off = 0;
    for (const p of pcms) { pcm.set(p, off); off += p.length; }
    post({ id: m.id, type: "done", pcm, sr }, [pcm.buffer]);
  } catch (err) {
    post({ id: m.id, type: "error", message: String((err as Error)?.message ?? err) });
  }
};
