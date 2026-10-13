// @vitest-environment node
// Manual check (not in the normal run): RUN_SONGS=1 npx vitest run tests/server/manual
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";
import { analyzeAudio } from "@/server/audio/analyzer";
import { python } from "../parity";

const SONGS = path.resolve(__dirname, "../../../../songs");

describe.runIf(process.env.RUN_SONGS)("real songs: Essentia analysis vs the Python one", () => {
  it("compares", { timeout: 3_600_000 }, async () => {
    const files = fs.readdirSync(SONGS).map((f) => path.join(SONGS, f));
    const py = python<Record<string, unknown>>(files.map((f) => ({ kind: "analyze", path: f }))) ?? [];
    const out: string[] = [];
    for (const [i, f] of files.entries()) {
      const t0 = Date.now();
      const a = await analyzeAudio(f);
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      const p = py[i] as Record<string, number[] & number> | undefined;
      const near = (xs: number[], ys: number[], tol: number) => xs.filter((x) => ys.some((y) => Math.abs(x - y) <= tol)).length;
      const row: Record<string, unknown> = {
        song: path.basename(f).slice(0, 26), seconds: secs, bpm: [a.bpm, p?.bpm], beats: [a.beats.length, p?.beats.length],
        pyBeatsMatched50ms: p ? `${Math.round((100 * near(p.beats, a.beats, 0.05)) / p.beats.length)}%` : "-",
        strong: [a.strongBeats.length, p?.strongBeats.length], medium: [a.mediumBeats.length, p?.mediumBeats.length],
        drops: [a.drops, p?.drops], parts: [a.songSections.map((s) => s.label).join(","), (p?.songSections as unknown as { label: string }[] | undefined)?.map((s) => s.label).join(",")],
        barConfidence: [a.downbeatConfidence, p?.downbeatConfidence], onsets: [a.onsets.length, p?.onsets.length],
      };
      out.push(JSON.stringify(row));
      fs.writeFileSync(path.join(__dirname, `ts_${i}.json`), JSON.stringify(a));
    }
    fs.writeFileSync(path.join(__dirname, "compare.txt"), out.join("\n"));
  });
});
