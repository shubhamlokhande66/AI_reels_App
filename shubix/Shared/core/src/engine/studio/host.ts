/* eslint-disable */
// @ts-nocheck
/* The phone's hidden engine page (FE/mobile-app lib/engine.tsx shows it in an invisible WebView, never on screen): the
 * website's engine modules run here in the phone's browser engine (V8, as fast as the website), the screens stay native.
 * The phone asks with window.engine.call(id, op, args) (big files arrive first in pieces: window.engine.part(id, text));
 * the answers go back with postMessage({ id, ok, result | error }); on the way, the step in words: postMessage({ id, step }). What the engine knows (the song's analysis) stays
 * here: only what the screens need crosses back. Ops:
 *   song { audio: base64 } -> the song as the website hears it: decoded by the browser (as the website decodes it),
 *        one channel, songAnalysis (the website's, in a Worker) -> { duration, sampleRate, bpm, beats, cuts, cutType, drops, breaks }
 *   checkBeats { token } -> the second opinion on that song's beats, as the website asks it (engine.ts checkBeatsWithAi): Beat This!
 *        (the 23 MB model, downloaded once from the API, the page's origin) on this phone, then the analysis again with its
 *        beats, which keeps whichever beats fit better -> the same answer as song (source "ai" when Beat This!'s won).
 *        Steps: { stage: "download" | "run", p }.
 * TODO (later): the same engine in Kotlin (fast native code instead of the hidden page; tested against these results). */
import * as ort from "onnxruntime-web/wasm";
import { FILTERBANK_PATH, MODEL_PATH, resample, runBeatThis, simdOk } from "../../lib/beatThis/device";
import { songAnalysis } from "./song";

// ONNX Runtime's WebAssembly files: the same version as the website's (/vendor/ort there)
const ORT_WASM = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.29.0/dist/";

const post = (m) => window.ReactNativeWebView.postMessage(JSON.stringify(m));
const parts = new Map();
const state = { song: null };
let ctx = null;
const audioCtx = () => ctx || (ctx = new (window.AudioContext || window.webkitAudioContext)());

const bytes = (b64) => { const s = atob(b64), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out.buffer; };
/** songAnalysis in a Worker, as the website runs it (engine.ts analyseInWorker); on the page when Workers are missing */
function analyse(m, sr, opts) {
  return new Promise((resolve) => {
    try {
      const code = "const songAnalysis = " + songAnalysis.toString() + ";\nonmessage = e => { try{ postMessage({ ok: true, r: songAnalysis(e.data.mono, e.data.sr, e.data.opts) }); } catch(err){ postMessage({ ok: false, err: String(err && err.message || err) }); } };";
      const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" })), w = new Worker(url);
      const done = () => { w.terminate(); URL.revokeObjectURL(url); };
      w.onmessage = (ev) => { done(); resolve(ev.data.ok ? ev.data.r : songAnalysis(m, sr, opts)); };
      w.onerror = () => { done(); resolve(songAnalysis(m, sr, opts)); };
      const copy = m.slice(); w.postMessage({ mono: copy, sr, opts: opts || {} }, [copy.buffer]);
    } catch (e) { resolve(songAnalysis(m, sr, opts)); }
  });
}

const OPS = {
  async song({ audio }, step) {
    const whole = await audioCtx().decodeAudioData(bytes(audio));
    step("Finding the beats, drops and breaks");
    const m = new Float32Array(whole.length), ch = whole.numberOfChannels;
    for (let c = 0; c < ch; c++) { const d = whole.getChannelData(c); for (let i = 0; i < m.length; i++) m[i] += d[i] / ch; }
    state.song = { buf: whole, mono: m, r: await analyse(m, whole.sampleRate) };
    return summary();
  },
  async checkBeats({ token }, step) {
    const song = state.song;
    if (!song) throw new Error("No song yet");
    if (!simdOk()) throw new Error("this phone cannot run the AI beat tracker");
    const samples = await resample(song.mono, song.buf.sampleRate);
    const bt = await runBeatThis(ort, samples, { model: location.origin + MODEL_PATH, filterbank: location.origin + FILTERBANK_PATH, wasm: ORT_WASM, headers: token ? { Authorization: "Bearer " + token } : undefined }, 1, (stage, p) => step({ stage, p }));
    if (state.song !== song) throw new Error("Another song was chosen");
    song.r = await analyse(song.mono, song.buf.sampleRate, { beats: bt.beats });
    return summary();
  },
};
/** what the screens need of the song's analysis */
function summary() {
  const whole = state.song.buf, r = state.song.r;
  const round = (a) => Array.from(a, (t) => Math.round(t * 1000) / 1000);
  return { duration: whole.duration, sampleRate: whole.sampleRate, bpm: Math.round(60 / r.period), beats: round(r.beats), cuts: round(r.cuts), cutType: r.cutType,
    drops: r.cutType.filter((t) => t === "drop").length, breaks: r.cutType.filter((t) => t === "break").length, source: r.beatSource || "own" };
}

window.engine = {
  part(id, text) { parts.set(id, (parts.get(id) || "") + text); },
  async call(id, op, args) {
    try {
      const a = args || {};
      if (a.audio === "@parts") { a.audio = parts.get(id) || ""; parts.delete(id); }
      if (!OPS[op]) throw new Error("Unknown engine op: " + op);
      post({ id, ok: true, result: await OPS[op](a, (text) => post({ id, step: text })) });
    } catch (e) { post({ id, ok: false, error: String((e && e.message) || e) }); }
  },
};
post({ id: 0, ok: true, result: "ready" });
