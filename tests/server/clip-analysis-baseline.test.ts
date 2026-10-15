// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findBinary } from "@/server/core/ffmpeg";
import { analyzeClip } from "@/server/video/analyzer";

/** The clip analysis gives the same result as when this baseline was saved, for a generated clip (a moving box over a
 * test pattern, with grain). It guards the shared analysis code: the server (FFmpeg frames) and the browser (the phone's
 * decoder) run the same measurements. UPDATE_BASELINE=1 saves a new baseline after an intended change. */

const BASELINE = path.join(__dirname, "..", "fixtures", "analysis-baseline.json");

function makeClip(): string {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "clip_")), "clip.mp4");
  execFileSync(findBinary("ffmpeg"), ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-vf", "drawbox=x='mod(t*120,400)':y=300:w=140:h=140:color=white@0.9:t=fill,noise=alls=8:allf=t:all_seed=7",
    "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "64k", "-shortest", file]);
  return file;
}

describe("clip analysis baseline", () => {
  it("measures a known clip exactly as before", { timeout: 300_000 }, async () => {
    const a = JSON.parse(JSON.stringify(await analyzeClip(makeClip(), "clip")));
    if (process.env.UPDATE_BASELINE === "1" || !fs.existsSync(BASELINE)) {
      fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
      fs.writeFileSync(BASELINE, JSON.stringify(a, null, 1));
    }
    expect(a).toEqual(JSON.parse(fs.readFileSync(BASELINE, "utf8")));
  });
});
