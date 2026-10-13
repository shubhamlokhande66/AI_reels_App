import os from "node:os";
import path from "node:path";
import { it } from "vitest";
import { parseTimeline } from "@/server/models/timeline";
import { getStyle, listStyles } from "@/server/styles";
import { renderConfig } from "@/server/video/render/cutter";
import { renderTimeline } from "@/server/video/render/renderer";

const P = "../storage/projects/6acd06852255322076e1e5fe/input/";
it.runIf(process.env.RUN_RENDER)("renders", async () => {
  const seg = (i: number, clip: string, t0: number, t1: number, effect: string, tr = { type: "cut", duration: 0 }) =>
    ({ clipId: clip, video: clip, sourceStart: 1, sourceEnd: 1 + t1 - t0, timelineStart: t0, timelineEnd: t1, effect, transitionIn: tr, looks: i === 2 ? ["vignette"] : [] });
  const tl = parseTimeline({ duration: 6, segments: [seg(0, "a", 0, 2, "zoom_in"), seg(1, "b", 2, 4, "pan_left", { type: "dissolve", duration: 0.4 }), seg(2, "a", 4, 6, "punch", { type: "slide", duration: 0.3 })],
    musicHits: [1, 3, 5], sfx: [{ type: "whoosh", at: 2 }], colorGrade: "warm" });
  const t = Date.now();
  const res = await renderTimeline({
    timeline: tl, sources: new Map([["a", { path: P + "6acd13cd494058342465ee48.mp4", width: 720, height: 1280 }], ["b", { path: P + "6acd06872255322076e1e600.mp4", width: 720, height: 1280, shaky: true }]]),
    audioPath: P + "6acd0996494058342465ee46.mp3", outPath: path.join(os.tmpdir(), "render-smoke.mp4"), workDir: path.join(os.tmpdir(), "render-smoke-work"),
    style: getStyle(listStyles()[0].id), cfg: renderConfig({ width: 540, height: 960, finalPreset: "veryfast" }), progress: () => {},
  });
  console.log(((Date.now() - t) / 1000).toFixed(1) + "s", JSON.stringify(res));
}, 600000);
