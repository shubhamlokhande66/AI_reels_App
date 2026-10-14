// @vitest-environment node
// Manual check (not part of the normal run): renders overlay text onto a test clip so the frames can be looked at.
// npx vitest run tests/server/manual/text-render.test.ts   (output in tests/server/manual/out/)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { findBinary } from "@/server/core/ffmpeg";
import { parseTimeline } from "@/server/models/timeline";
import { assFilter, writeOverlaysAss } from "@/server/video/render/text";

const OUT = path.join(__dirname, "out");

it.skipIf(!process.env.RENDER_TEXT)("burns Marathi and English text in", () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tl = parseTimeline({
    duration: 4, segments: [{ clipId: "a", video: "a.mp4", sourceStart: 0, sourceEnd: 4, timelineStart: 0, timelineEnd: 4 }],
    overlays: [
      { text: "बाप्पा गेले… पण मन अजूनही त्यांच्यातच आहे", start: 0, end: 2, role: "hook", position: "top" },
      { text: "Save this for your next run with friends", start: 2.2, end: 4, role: "cta", position: "center" },
    ],
  });
  const ass = writeOverlaysAss(tl, path.join(OUT, "overlays.ass"), 1080, 1920)!;
  const ff = findBinary("ffmpeg");
  execFileSync(ff, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1080x1920:d=4:r=25", "-vf", assFilter(ass), "-pix_fmt", "yuv420p", path.join(OUT, "text.mp4")]);
  for (const [t, name] of [[1, "hook.jpg"], [3, "cta.jpg"]] as const)
    execFileSync(ff, ["-y", "-loglevel", "error", "-ss", String(t), "-i", path.join(OUT, "text.mp4"), "-frames:v", "1", "-vf", "scale=360:-2", path.join(OUT, name)]);
});
