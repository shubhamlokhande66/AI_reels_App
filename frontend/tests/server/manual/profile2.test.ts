// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { SR } from "@/server/audio/analyzer";
import { decode } from "@/server/audio/decode";
import * as sp from "@/server/audio/dsp/spectral";
import * as tempo from "@/server/audio/tempo";

describe.runIf(process.env.RUN_SONGS)("profile tempo", () => {
  it("parts of detectBeats", { timeout: 600_000 }, async () => {
    const songs = path.resolve(__dirname, "../../../../songs");
    const y = await decode(path.join(songs, fs.readdirSync(songs)[0]), SR);
    const env = sp.onsetStrength(y);
    const a = JSON.parse(fs.readFileSync(path.join(__dirname, "ts_0.json"), "utf8"));
    const log: string[] = [];
    let t0 = Date.now();
    const secs = tempo.localTempo(env, a.beats, y.length / SR, a.bpm);
    log.push(`localTempo ${(Date.now() - t0) / 1000}s (${secs.length} sections)`);
    t0 = Date.now();
    for (let i = 0; i < 46; i++) sp.tempo(env.subarray(i * 258, i * 258 + 516));
    log.push(`46 x tempo() ${(Date.now() - t0) / 1000}s`);
    t0 = Date.now();
    tempo.beatConfidence(a.beats, env, secs);
    log.push(`beatConfidence ${(Date.now() - t0) / 1000}s`);
    t0 = Date.now();
    tempo.refine(secs, a.beats, env);
    log.push(`refine ${(Date.now() - t0) / 1000}s`);
    fs.writeFileSync(path.join(__dirname, "profile.txt"), log.join("\n"));
  });
});
