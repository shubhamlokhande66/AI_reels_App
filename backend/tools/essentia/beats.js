// Beat tracking with Essentia (essentia.js = Essentia compiled to WebAssembly, runs in Node on Windows too).
// In:  argv[2] = a file of raw 32-bit float mono samples at 44100 Hz (the backend decodes the song with FFmpeg).
// Out: one JSON line on stdout: {bpm, beats: [s], confidence, estimates, sampleRate, seconds}
// RhythmExtractor2013 "multifeature": five onset functions, the beats agreed between them; its confidence is
// 0..5.32 (above ~3.5: very sure; below ~1.5: unsure).
"use strict";

const fs = require("fs");
const { EssentiaWASM, Essentia } = require("essentia.js");

const SR = 44100;

function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node beats.js <samples.f32>");
  const buf = fs.readFileSync(file);
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const essentia = new Essentia(EssentiaWASM);
  const signal = essentia.arrayToVector(samples);
  const r = essentia.RhythmExtractor2013(signal, 208, "multifeature", 40);
  const out = {
    bpm: r.bpm,
    beats: Array.from(essentia.vectorToArray(r.ticks)),
    confidence: r.confidence,
    estimates: Array.from(essentia.vectorToArray(r.estimates)),
    sampleRate: SR,
    seconds: samples.length / SR,
    version: essentia.version,
  };
  process.stdout.write(JSON.stringify(out) + "\n");
}

try {
  main();
} catch (e) {
  process.stderr.write(String((e && e.stack) || e) + "\n");
  process.exit(1);
}
