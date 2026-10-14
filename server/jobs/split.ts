import "server-only";
import { AppError, ValidationFailed } from "@/server/core/errors";
import { renderFfmpeg } from "@/server/core/ffmpeg";
import { fixed, round } from "@/server/core/py";
import { projectKey } from "@/server/media/service";
import type { ClipAnalysis } from "@/server/models/clip";
import type { ProjectSettings } from "@/server/projects/settings";
import { localPath } from "@/server/storage/local";
import { analyzeVideos, type VideoRef } from "@/server/video/clips";
import type { Word } from "@/server/video/render/text";
import { speechSpans } from "@/server/video/steps";
import { newResult, runPipeline, transcribeClips, type PipelineInput, type PipelineResult, type StageProgress } from "./pipeline";

/** One long video -> several Reels, each made from its best part (was jobs/pipeline.run_split / pick_ranges). */

const SPLIT_MIN_SOURCE = 45, MIN_USEFUL_WINDOW = 0.4;

/** The best non-overlapping parts, in video order: whole sentences with the most words per second (a talk), else the
 * stretches with the most best moments and the cleanest picture. */
export function pickRanges(clip: ClipAnalysis, words: Word[] | null, seconds: number, count: number): [number, number, string][] {
  const dur = clip.metadata.duration, cands: [number, number, number, string][] = [];
  if (words && words.length >= 20) {
    const spans = speechSpans(clip.clipId, words, dur);
    for (let i = 0; i < spans.length; i++) {
      let spoken = 0, j = i;
      while (j < spans.length && spoken + (spans[j].end - spans[j].start) <= seconds * 1.05) { spoken += spans[j].end - spans[j].start; j++; }
      if (spoken < seconds * 0.6 || j === i) continue;
      const a = spans[i].start, b = spans[j - 1].end, nWords = spans.slice(i, j).reduce((s, x) => s + x.words.length, 0);
      cands.push([nWords / Math.max(b - a, 1e-6), a, b, `${nWords} words of speech`]);
    }
  } else {
    const span = Math.min(seconds * 1.5, dur);
    for (let t = 0; t + span <= dur + 1e-6; t += 1) {
      const good = clip.windows.filter((w) => w.end - w.start >= MIN_USEFUL_WINDOW).reduce((s, w) => s + Math.max(Math.min(w.end, t + span) - Math.max(w.start, t), 0), 0);
      if (good < seconds * 1.15) continue;
      const moments = clip.moments.filter((m) => t <= m.t && m.t <= t + span).reduce((s, m) => s + m.score, 0);
      const q = clip.windows.filter((w) => w.end > t && w.start < t + span).map((w) => w.quality);
      cands.push([moments + ((q.length ? q.reduce((x, y) => x + y, 0) / q.length : 0) * span) / 5, t, t + span, "the strongest moments"]);
    }
  }
  const chosen: [number, number, string][] = [];
  for (const [, a, b, why] of cands.map((c, i) => [c, i] as const).sort((x, y) => y[0][0] - x[0][0] || x[1] - y[1]).map(([c]) => c)) {
    if (chosen.every(([x, y]) => b <= x || a >= y)) chosen.push([round(a, 2), round(b, 2), why]);
    if (chosen.length >= count) break;
  }
  return chosen.sort((x, y) => x[0] - y[0]);
}

export async function runSplit(inp: PipelineInput, progress: StageProgress): Promise<PipelineResult> {
  const res = newResult();
  res.clips = await analyzeVideos(inp.projectId, inp.videos, (f) => progress("analyzing_videos", f));
  const usable = inp.videos.filter((v) => res.clips.get(v.id)?.usable);
  const src = usable.length ? usable.reduce((a, v) => (res.clips.get(v.id)!.metadata.duration > res.clips.get(a.id)!.metadata.duration ? v : a)) : null;
  if (!src || res.clips.get(src.id)!.metadata.duration < SPLIT_MIN_SOURCE) throw new ValidationFailed(`Splitting needs one video of at least ${SPLIT_MIN_SOURCE} seconds; this project's videos are already Reel length.`, { code: "VIDEO_TOO_SHORT" });
  const a = res.clips.get(src.id)!;
  let words: Word[] | null = null;
  if (a.metadata.hasAudio) {
    try { words = (await transcribeClips(inp, [{ clipId: src.id, name: src.name, analysis: a, semantic: null }], progress, res.warnings)).get(src.id) ?? null; }
    catch (e) { if (!(e instanceof AppError)) throw e; } // no speech recognition: split on the picture instead
  }
  const ranges = pickRanges(a, words, inp.settings.duration, inp.variantIds.length);
  if (!ranges.length) throw new ValidationFailed("No part of this video has enough good footage or speech for a Reel of that length. Try a shorter length.", { code: "NO_GOOD_PARTS" });
  const speech = Boolean(words && words.length >= 20), n = ranges.length;
  for (const [i, [start, end, why]] of ranges.entries()) {
    const rid = inp.variantIds[i], key = projectKey(inp.projectId, "input", `part_${rid}.mp4`);
    await renderFfmpeg(["-ss", start.toFixed(3), "-i", localPath(src.key), "-t", (end - start).toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", localPath(key)], { timeout: 600, signal: inp.signal });
    const part: VideoRef = { id: `${src.id}_part${i + 1}_${rid.slice(-6)}`, name: `${src.name} part ${i + 1}`, key, width: src.width, height: src.height };
    const mode = speech ? "talk" : inp.settings.sequence !== "talk" ? inp.settings.sequence : "mixed";
    const audioMode = mode !== "talk" && inp.audio ? inp.settings.audioMode : "original";
    const settings = { ...inp.settings, sequence: mode, audioMode } as ProjectSettings;
    const r = await runPipeline({ ...inp, jobType: "generate", videos: [part], renderingId: rid, seed: inp.seed + i, settings }, (_s, f) => progress("rendering", (i + Math.min(Math.max(f, 0), 1)) / n));
    r.timeline!.notes.unshift(`Part ${i + 1} of the video: ${fixed(start, 0)}s to ${fixed(end, 0)}s (${why}).`);
    const mm = (t: number) => `${Math.trunc(t / 60)}:${String(Math.trunc(t % 60)).padStart(2, "0")}`;
    res.variants.push({ strategyId: `part${i + 1}`, label: `Part ${i + 1}: ${mm(start)}-${mm(end)}`, renderingId: rid, timeline: r.timeline!, render: r.render!, outputKey: r.outputKey! });
  }
  progress("rendering", 1);
  return res;
}
