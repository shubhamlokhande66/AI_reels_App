// @vitest-environment node
// Manual: RUN_SONGS=1 npx vitest run tests/server/manual/profile.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { analyze as accents } from "@/server/audio/accents";
import { computeEnergy, findSections, SR } from "@/server/audio/analyzer";
import { detectBeats } from "@/server/audio/beats";
import { decode } from "@/server/audio/decode";
import { detectEvents, measurements } from "@/server/audio/drops";
import * as sp from "@/server/audio/dsp/spectral";
import { essentiaBeats, essentiaOnsets } from "@/server/audio/essentia";
import { computeCurves, structuralParts } from "@/server/audio/structure";

describe.runIf(process.env.RUN_SONGS)("profile", () => {
  it("one song", { timeout: 1_800_000 }, async () => {
    const f = path.resolve(__dirname, "../../../../songs", fs.readdirSync(path.resolve(__dirname, "../../../../songs"))[0]);
    const log: string[] = [];
    const time = async <T,>(name: string, fn: () => T | Promise<T>): Promise<T> => { const t0 = Date.now(); const r = await fn(); log.push(`${name}: ${((Date.now() - t0) / 1000).toFixed(1)}s`); return r; };
    const y = await time("decode 22k", () => decode(f, SR));
    const y44 = await time("decode 44k", () => decode(f, 44100));
    const eb = await time("essentia beats", () => essentiaBeats(y44));
    const eo = await time("essentia onsets", () => essentiaOnsets(y44));
    await time("stft 2048/512", () => sp.stftMag(y));
    const env = await time("onset strength", () => sp.onsetStrength(y));
    const energy = await time("energy", () => computeEnergy(y, SR));
    const beat = await time("detectBeats", () => detectBeats(eb, eo, env, y.length / SR));
    await time("drops", () => detectEvents(measurements(y, SR, env, beat.onsets), beat.beats));
    await time("sections", () => findSections(y, SR, beat.beats, y.length / SR));
    await time("curves", () => computeCurves(y, SR, beat.onsets));
    await time("parts", () => structuralParts(y, SR, beat.beats, y.length / SR, Array.from(energy), 0.1, []));
    await time("accents", () => accents(y, SR, beat.beats, []));
    fs.writeFileSync(path.join(__dirname, "profile.txt"), log.join("\n"));
  });
});
