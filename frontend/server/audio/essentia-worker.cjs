// Essentia (essentia.js, WebAssembly) in a worker thread: the beat tracker takes tens of seconds on a long song and
// must never block the server. Input: { task, samples (Float32Array, mono 44.1 kHz) }. Output: plain numbers.
//   task "beats":  RhythmExtractor2013 "multifeature" - five onset functions, the beats they agree on (+ confidence 0..5.32)
//   task "onsets": SuperFluxExtractor - note / hit onsets (seconds)
/* eslint-disable @typescript-eslint/no-require-imports -- a plain Node worker, loaded outside the Next.js bundle */
"use strict";

const { parentPort } = require("node:worker_threads");
const { EssentiaWASM, Essentia } = require("essentia.js");

let essentia = null;
const get = () => (essentia ??= new Essentia(EssentiaWASM));

parentPort.on("message", ({ id, task, samples }) => {
  try {
    const e = get();
    const signal = e.arrayToVector(samples);
    let out;
    if (task === "beats") {
      const r = e.RhythmExtractor2013(signal, 208, "multifeature", 40);
      out = { bpm: r.bpm, beats: Array.from(e.vectorToArray(r.ticks)), confidence: r.confidence, estimates: Array.from(e.vectorToArray(r.estimates)) };
    } else if (task === "onsets") {
      const r = e.SuperFluxExtractor(signal);
      out = { onsets: Array.from(e.vectorToArray(r.onsets)) };
    } else {
      throw new Error(`unknown task ${task}`);
    }
    signal.delete?.();
    parentPort.postMessage({ id, ok: true, out, version: e.version });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
});
