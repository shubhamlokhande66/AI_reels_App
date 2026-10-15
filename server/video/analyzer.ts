import "server-only";
import { AppError } from "@/server/core/errors";
import { probe } from "@/server/core/ffmpeg";
import { parseVideoProbe, type VideoMetadata } from "@/server/media/probe";
import type { ClipAnalysis } from "@/server/models/clip";
import { analyzeFrames, NoFrames } from "./clipAnalysisCore";
import { opencv } from "./cv";
import { findFace } from "./faces";
import { readFrames } from "./frames";

/** Video analysis on the server: the shared measurements (clipAnalysisCore.ts) over frames FFmpeg decodes, faces found
 * in a pool of worker threads. The browser runs the same core over the phone's own decoder (lib/clipAnalysis). */

export { VIDEO_ANALYSIS_VERSION, findContentRect, goodSeconds, clipSummary } from "./clipAnalysisCore";

export async function analyzeClip(file: string, clipId: string, progress: ((f: number) => void) | null = null, metaIn: VideoMetadata | null = null): Promise<ClipAnalysis> {
  const meta = metaIn ?? parseVideoProbe(await probe(file));
  const deps = {
    cv: await opencv(),
    readFrames: (spec: Parameters<typeof readFrames>[1]) => readFrames(file, spec),
    findFace,
    breathe: () => new Promise<void>((res) => setImmediate(res)), // let other requests in between frames
  };
  try {
    return await analyzeFrames(deps, meta, clipId, progress);
  } catch (e) {
    if (e instanceof NoFrames) throw new AppError(e.message, { code: e.code });
    throw e;
  }
}
