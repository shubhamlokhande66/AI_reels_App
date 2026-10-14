// @vitest-environment node
/** Manual: BEATCHECK_DIR=<folder> - analyses every song there and writes <song>.beats.mp3 (clicks on the detected beats,
 * a higher click on bar starts) and <song>.json (the analysis summary) into <folder>/beat-check. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { analyzeAudio } from "@/server/audio/analyzer";
import { findBinary } from "@/server/core/ffmpeg";
import { writeWav } from "../audio/fixtures";

const dir = process.env.BEATCHECK_DIR;
it.skipIf(!dir)("beat check on real songs", { timeout: 3_600_000 }, async () => {
  const out = path.join(dir!, "beat-check");
  fs.mkdirSync(out, { recursive: true });
  for (const name of fs.readdirSync(dir!).filter((f) => /\.(mp3|wav|m4a|flac|ogg)$/i.test(f))) {
    const t0 = Date.now(), a = await analyzeAudio(path.join(dir!, name));
    const sr = 44100, y = new Float32Array(Math.ceil((a.duration + 1) * sr)), downs = new Set(a.downbeats);
    for (const b of a.beats) {
      const f = downs.has(b) ? 2000 : 1000, s = Math.round(b * sr);
      for (let i = 0; i < 0.03 * sr && s + i < y.length; i++) y[s + i] += 0.6 * Math.sin((2 * Math.PI * f * i) / sr) * Math.exp(-i / (0.006 * sr));
    }
    const base = name.replace(/\.[^.]+$/, ""), clicks = path.join(out, `${base}.clicks.wav`);
    writeWav(clicks, y, sr);
    execFileSync(findBinary("ffmpeg"), ["-y", "-loglevel", "error", "-i", path.join(dir!, name), "-i", clicks, "-filter_complex",
      "[0:a]volume=0.6[m];[m][1:a]amix=inputs=2:duration=first:normalize=0", "-ac", "2", "-b:a", "192k", path.join(out, `${base}.beats.mp3`)]);
    fs.rmSync(clicks);
    const gaps = a.beats.slice(1).map((t, i) => t - a.beats[i]).sort((p, q) => p - q);
    const summary = { song: name, seconds: a.duration, bpm: a.bpm, bpmEstimates: a.bpmEstimates, bpmAgreement: a.bpmAgreement,
      trackerConfidence: a.beatConfidence, essentiaConfidence: a.essentiaConfidence, beats: a.beats.length, beatSource: a.beatSource,
      gapMedian: gaps[gaps.length >> 1], gapMin: gaps[0], gapMax: gaps[gaps.length - 1], meter: a.meter, downbeatConfidence: a.downbeatConfidence,
      tempoSections: a.tempoSections.length, transients: a.transients.length, drops: a.dropTimes, analysisSeconds: (Date.now() - t0) / 1000 };
    fs.writeFileSync(path.join(out, `${base}.json`), JSON.stringify({ ...summary, beatTimes: a.beats, downbeats: a.downbeats }, null, 1));
    console.log("RESULT " + JSON.stringify(summary));
  }
});
