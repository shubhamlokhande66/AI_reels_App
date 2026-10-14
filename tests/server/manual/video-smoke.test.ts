import { it } from "vitest";
import { analyzeClip, clipSummary } from "@/server/video/analyzer";

it.runIf(process.env.RUN_VIDEO)("analyzes a real clip", async () => {
  const t0 = Date.now();
  const a = await analyzeClip(process.env.RUN_VIDEO!, "smoke");
  console.log(((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(clipSummary(a), null, 1), "moments", a.moments.length, a.windows[0]);
}, 600000);
