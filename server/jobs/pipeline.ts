import "server-only";
import fs from "node:fs";
import path from "node:path";
import "@/server/ai/pipelineImpl";
import { pipelineAi, type DirectedReel } from "@/server/ai/pipelineAi";
import { analyzeMusic } from "@/server/audio/analyzer";
import { cutPlan, planHits } from "@/server/audio/beatmap";
import { settings as env } from "@/server/core/config";
import { AppError, ValidationFailed } from "@/server/core/errors";
import { fixed, g, round } from "@/server/core/py";
import { DIRECTIONS, distinctOpening, draftPlan, generateHooks, getStrategy, hooksFor, chronologicalHint, inferBrief, mergeAi, resolveStyle, STYLE_TONE, storyOrder, versionLabel, type ProjectBrief } from "@/server/director/creative";
import { autoRevise, correct, MAX_ITERATIONS, reviewDoc, reviewEdit, roundDoc, scorecard, type CreativeReview, type FileIssue, type Round } from "@/server/director/creativeReview";
import { findHero, heroDoc, hookDoc, rankHooks } from "@/server/director/intelligence";
import { applyLearnedTrend, applyProfile, bestMatch, type DirectorProfile } from "@/server/director/learned";
import { buildMusicMap, songHits, type MusicMap } from "@/server/director/musicMap";
import { buildReelPlan, checkRender, detectCategory, orderForFood, planSfx, reviewTimeline, type Check } from "@/server/director/review";
import { meanEnergy, withDefaults, type AudioAnalysis } from "@/server/models/analysis";
import { semanticDefaults, type ClipAnalysis, type ClipInput, type ClipSemantic } from "@/server/models/clip";
import { Timeline as TimelineSchema, type Timeline } from "@/server/models/timeline";
import { projectKey } from "@/server/media/service";
import type { ProjectSettings } from "@/server/projects/settings";
import { checkRenderFile, finalCheck } from "@/server/quality/checker";
import * as shared from "@/server/services/analysisCache";
import { localPath, moveFile } from "@/server/storage/local";
import { AUTO_STYLE, applyPace, getStyle, listStyles, withOverrides, type EditingStyle } from "@/server/styles";
import { analyzeVideos, findDuplicateVideos, type VideoRef } from "@/server/video/clips";
import { goodSeconds } from "@/server/video/analyzer";
import { productVisibility } from "@/server/video/moments";
import * as ig from "@/server/platforms/instagram";
import { renderConfig, type RenderConfig, type SourceClip } from "@/server/video/render/cutter";
import { pickEncoder } from "@/server/video/render/parts";
import { renderTimeline, type RenderResult } from "@/server/video/render/renderer";
import { ensureTransitions } from "@/server/video/transitions";
import { assFilter, captionsToCues, cuesToCaptions, groupWords, writeAss, writeOverlaysAss, type Word } from "@/server/video/render/text";
import { buildStepsTimeline, buildTalkingTimeline, orderClips } from "@/server/video/steps";
import { buildTimeline, rankMusicWindows, referenceWindow } from "@/server/video/timeline";
import REGISTRY from "@/server/video/registry.json";

/** The Reel pipeline (was jobs/pipeline.py): analyse the clips and the song, plan the edit (rules, or the AI director),
 * review and repair it, render it, check the file, score it and correct it. Runs inside a job; knows nothing about the
 * job store. */

export const FOOTAGE_HEADROOM = 1.15, RENDER_SECONDS_PER_SECOND = 12;
export const STAGES: [string, string, number][] = [
  ["analyzing_videos", "Analyzing videos", 0.3], ["analyzing_music", "Analyzing music", 0.08], ["detecting_beats", "Detecting beats", 0.07],
  ["understanding_clips", "Understanding clips", 0.25], ["understanding_images", "Understanding the photos", 0.1], ["planning_shots", "Planning the shots", 0.05],
  ["selecting_clips", "Selecting clips", 0.05], ["creating_timeline", "Creating timeline", 0.05], ["generating_captions", "Generating captions", 0.08],
  ["writing_copy", "Writing title & description", 0.04], ["reviewing", "Reviewing & improving the edit", 0.02], ["voicing", "Recording the narration", 0.25],
  ["rendering", "Rendering video", 0.45],
];
const ANALYZE_STAGES = ["analyzing_videos", "analyzing_music", "detecting_beats"];
const PRODUCT_STAGES = ["analyzing_music", "detecting_beats", "understanding_images", "planning_shots", "rendering"];
export type StageProgress = (stage: string, fraction: number) => void;

export interface PipelineInput {
  projectId: string; jobType: string; videos: VideoRef[]; audio: VideoRef | null; settings: ProjectSettings; renderingId: string; seed: number; projectName: string;
  kind: "final" | "preview"; timeline: Timeline | null; strategies: string[]; variantIds: string[]; images: VideoRef[]; story: Record<string, unknown> | null;
  template: Record<string, unknown> | null; voiceId: string | null; revision: Record<string, unknown>[]; references: Record<string, unknown>[];
  profile: DirectorProfile | null; brand: Record<string, unknown> | null; signal?: AbortSignal;
}
export const pipelineInput = (o: Partial<PipelineInput> & Pick<PipelineInput, "projectId" | "jobType" | "videos" | "settings">): PipelineInput => ({
  audio: null, renderingId: "", seed: 0, projectName: "", kind: "final", timeline: null, strategies: [], variantIds: [], images: [], story: null, template: null,
  voiceId: null, revision: [], references: [], profile: null, brand: null, ...o,
});

export interface VariantResult { strategyId: string; label: string; renderingId: string; timeline: Timeline; render: RenderResult; outputKey: string }
export interface PipelineResult {
  clips: Map<string, ClipAnalysis>; audio: AudioAnalysis | null; timeline: Timeline | null; render: RenderResult | null; outputKey: string | null; warnings: string[];
  renderCheck: Record<string, unknown> | null; postCopy: Record<string, unknown> | null; semantics: Map<string, ClipSemantic>; variants: VariantResult[];
  productPlan: Record<string, unknown> | null; reelPlan: Record<string, unknown> | null;
}
export const newResult = (): PipelineResult => ({ clips: new Map(), audio: null, timeline: null, render: null, outputKey: null, warnings: [], renderCheck: null, postCopy: null,
  semantics: new Map(), variants: [], productPlan: null, reelPlan: null });

// ------------------------------------------------------------------ stages and progress
function activeStages(jobType: string, captions: boolean, ai = false): [string, string, number][] {
  if (jobType === "product" || jobType === "story") return STAGES.filter((s) => PRODUCT_STAGES.includes(s[0]) || (jobType === "story" && s[0] === "voicing"));
  if (jobType === "render") return STAGES.filter((s) => s[0] === "rendering");
  if (jobType === "variations" || jobType === "split") return STAGES.filter((s) => ANALYZE_STAGES.includes(s[0]) || s[0] === "rendering" || (ai && s[0] === "understanding_clips"));
  if (jobType !== "generate") return STAGES.filter((s) => ANALYZE_STAGES.includes(s[0]) || (ai && s[0] === "understanding_clips"));
  const optional: Record<string, boolean> = { generating_captions: captions, writing_copy: ai, understanding_clips: ai, voicing: false, understanding_images: false, planning_shots: false };
  return STAGES.filter((s) => optional[s[0]] ?? true);
}
export const stageNames = (jobType: string, captions = false, ai = false) => activeStages(jobType, captions, ai).map((s) => s[0]);
export const stageLabels = () => Object.fromEntries(STAGES.map(([n, l]) => [n, l]));
export function overallProgress(jobType: string, stage: string, fraction: number, captions = false, ai = false): number {
  const active = activeStages(jobType, captions, ai), total = active.reduce((s, x) => s + x[2], 0);
  let done = 0;
  for (const [name, , w] of active) { if (name === stage) { done += w * Math.min(Math.max(fraction, 0), 1); break; } done += w; }
  return Math.min(round((100 * done) / total), 100);
}

// ------------------------------------------------------------------ analysis
const readJson = <T,>(key: string): T | null => { try { return JSON.parse(fs.readFileSync(localPath(key), "utf8")) as T; } catch { return null; } };
const writeJson = (key: string, doc: unknown) => { const f = localPath(key); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(doc)); };
const semanticKey = (pid: string, mid: string) => projectKey(pid, "analysis", `semantic_${mid}.json`);
const SEMANTIC_VERSION = 2;

/** What is in each clip (vision model), cached per clip; one failure never stops the others. */
async function understandClips(inp: PipelineInput, clips: Map<string, ClipAnalysis>, progress: StageProgress, warnings: string[]): Promise<Map<string, ClipSemantic>> {
  const out = new Map<string, ClipSemantic>(), n = Math.max(inp.videos.length, 1), failed: string[] = [];
  for (const [i, v] of inp.videos.entries()) {
    progress("understanding_clips", i / n);
    const cached = readJson<ClipSemantic>(semanticKey(inp.projectId, v.id));
    if (cached && (cached.version ?? 0) >= SEMANTIC_VERSION) { out.set(v.id, semanticDefaults({ ...cached, clipId: v.id })); continue; }
    try {
      const a = clips.get(v.id)!;
      const sem = await pipelineAi().understandClip(localPath(v.key), { clipId: v.id, name: v.name, analysis: a, semantic: null }, inp.settings.language);
      writeJson(semanticKey(inp.projectId, v.id), sem);
      out.set(v.id, sem);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      failed.push(e.message);
      break; // the same error would repeat for every clip
    }
  }
  if (failed.length) warnings.push(`Some clips could not be analysed by the vision model: ${failed[0]}`);
  progress("understanding_clips", 1);
  for (const [cid, sem] of out) { const a = clips.get(cid); if (a) a.productVisibility = productVisibility(a.windows, sem.category); }
  return out;
}

async function analyzeMusicStage(inp: PipelineInput, progress: StageProgress): Promise<AudioAnalysis> {
  progress("analyzing_music", 0);
  const a = await analyzeMusic(inp.projectId, { id: inp.audio!.id, key: inp.audio!.key }, (stage, f) => progress(stage === "detecting_beats" ? "detecting_beats" : "analyzing_music", f));
  progress("analyzing_music", 1);
  progress("detecting_beats", 1);
  return a;
}

function skippedWarnings(inp: PipelineInput, clips: Map<string, ClipAnalysis>): string[] {
  const names = new Map(inp.videos.map((v) => [v.id, v.name]));
  return [...clips].filter(([, a]) => !a.usable).map(([cid, a]) => {
    const reasons = a.flags.filter((f) => ["too_dark", "too_blurry", "too_short", "low_resolution"].includes(f));
    return `Skipped '${names.get(cid)}' (${(reasons.length ? reasons : ["low quality"]).map((r) => r.replace(/_/g, " ")).join(", ")}).`;
  });
}

/** The same video uploaded twice is used only once. */
async function dropDuplicateVideos(inp: PipelineInput, warnings: string[]): Promise<PipelineInput> {
  const found = await findDuplicateVideos(inp.projectId, inp.videos);
  if (!found?.length) return inp;
  const names = new Map(inp.videos.map((v) => [v.id, v.name])), gone = new Set(found.map((d) => d.clipId));
  for (const d of found) if (names.has(d.clipId) && names.has(d.sameAs)) warnings.push(`'${names.get(d.clipId)}' is the same video as '${names.get(d.sameAs)}', so it was used only once.`);
  return { ...inp, videos: inp.videos.filter((v) => !gone.has(v.id)) };
}

/** A steady 110 BPM grid for Reels without music: cuts still land on a rhythm. */
export function neutralAudio(duration: number): AudioAnalysis {
  const period = 60 / 110, total = Math.max(duration + 5, 10);
  const beats = Array.from({ length: Math.trunc(total / period) }, (_, i) => round(i * period, 3));
  return withDefaults({ bpm: 110, duration: total, beats, beatConfidence: 0, strongBeats: beats.filter((_, i) => i % 4 === 0), onsets: beats, highEnergySections: [],
    sections: [{ start: 0, end: total }], drops: [], energyHop: 0.1, energy: new Array(Math.trunc(total / 0.1)).fill(0.5) });
}

// ------------------------------------------------------------------ helpers
const SONG_PART_VERSION = 1;
const mmss = (t: number) => `${Math.trunc(t / 60)}:${String(Math.trunc(t % 60)).padStart(2, "0")}`;

/** Which part of the song: the AI weighs the instructions against the best-ranked parts; a new version rotates. */
async function chooseSongPart(inp: PipelineInput, audio: AudioAnalysis, footage: string): Promise<[number | null, string]> {
  const digest = await shared.contentHash(inp.audio!.key), s = inp.settings;
  const crypto = await import("node:crypto");
  const wanted = `${s.duration}|${s.brief.trim().toLowerCase()}|${s.concept}|${inp.seed}|${s.ai ? "True" : "False"}`;
  const kind = "song_part_" + crypto.createHash("sha1").update(wanted).digest("hex").slice(0, 16);
  const hit = shared.load<{ start: number | null; note: string }>(digest, kind, SONG_PART_VERSION);
  if (hit) return [hit.start ?? null, hit.note ?? ""];
  const cands = rankMusicWindows(audio, s.duration, 5);
  let res: [number | null, string] = [null, ""];
  if (cands.length >= 2) {
    const fb = inp.seed ? inp.seed % Math.min(3, cands.length) : 0;
    let done = false;
    if (s.ai) {
      try {
        const described = cands.map((c, i) => ({ index: i, from: mmss(c.start), to: mmss(c.end), song_parts: [...new Set(audio.songSections.filter((x) => x.end > c.start && x.start < c.end).map((x) => x.label))],
          energy: round(meanEnergy(audio, c.start, c.end), 2), why_good: c.reasons.slice(0, 4) }));
        const ans = await pipelineAi().chooseSongPart({ duration: s.duration, brief: s.brief || "(none)", concept: s.concept, footage, newVersion: Boolean(inp.seed), candidates: described });
        if (ans.pick >= 0 && ans.pick < cands.length) {
          const c = cands[ans.pick], reason = ans.reason.trim().slice(0, 160);
          res = [c.start, `AI chose the song part ${mmss(c.start)}–${mmss(c.end)}` + (reason ? `: ${reason}` : ".")];
          done = true;
        }
      } catch (e) { if (!(e instanceof AppError)) throw e; }
    }
    if (!done) { const c = cands[fb]; res = fb ? [c.start, `A different part of the song for this version: ${mmss(c.start)}–${mmss(c.end)}.`] : [null, ""]; }
  }
  shared.save(digest, kind, SONG_PART_VERSION, { start: res[0], note: res[1] });
  return res;
}

/** Deterministic "auto" style when no AI is available: tempo, motion and framing. */
function fallbackStyle(clips: ClipInput[], audio: AudioAnalysis): string {
  const usable = clips.some((c) => c.analysis.usable) ? clips.filter((c) => c.analysis.usable) : clips;
  const motion = usable.reduce((s, c) => s + c.analysis.motionScore, 0) / usable.length;
  const landscape = usable.filter((c) => c.analysis.metadata.orientation === "landscape").length / usable.length;
  if (audio.bpm >= 110 && motion >= 0.35) return "fast_trending";
  if (landscape >= 0.6 && motion < 0.35) return "travel";
  return "cinematic";
}

async function chooseStyleAndOrder(inp: PipelineInput, clips: ClipInput[], audio: AudioAnalysis, notes: string[], warnings: string[], useAi: boolean, aiTasks: string[]): Promise<[string | null, Record<string, number> | null]> {
  const s = inp.settings;
  let styleId: string | null = s.style !== AUTO_STYLE ? null : fallbackStyle(clips, audio), orderHint: Record<string, number> | null = null;
  if (s.ai && useAi) {
    try {
      if (s.style === AUTO_STYLE) {
        const sug = await pipelineAi().suggestStyle({ clips, audio, projectName: inp.projectName });
        styleId = sug.styleId;
        aiTasks.push("style");
        notes.push(`AI chose the ${sug.styleId} style` + (sug.reason ? `: ${sug.reason}` : "."));
      }
      const order = await pipelineAi().suggestOrder({ clips, audio, duration: s.duration, brief: s.brief, language: s.language });
      orderHint = order.hint;
      aiTasks.push(order.structure ? "story" : "order");
      notes.push(order.structure ? "Story: " + order.structure.join(" -> ") + (order.reason ? `. ${order.reason}` : "") : "AI suggested the clip order" + (order.reason ? `: ${order.reason}` : "."));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      warnings.push(`AI assist was skipped: ${e.message}`);
    }
  }
  if (s.ai && !useAi) return [styleId, orderHint];
  const semanticReady = clips.some((c) => c.semantic !== null);
  const run = ["audio_analyst", "video_analyst", ...(s.ai && s.brief && semanticReady ? ["story_planner"] : []), "clip_selector", ...(s.ai && s.style === AUTO_STYLE ? ["style_director"] : []),
    ...(s.captions ? ["caption_generator"] : []), "quality_checker"];
  const pending = ["voice", "voice_music"].includes(s.audioMode) ? ["script_writer", "voice_planner"] : [];
  notes.push("Agents used: " + run.map((a) => a.replace(/_/g, " ")).join(", ") + (pending.length ? `. Waiting for your approval: ${pending.map((a) => a.replace(/_/g, " ")).join(", ")}.` : ""));
  if (s.style === AUTO_STYLE && styleId && !notes.some((n) => n.includes("AI chose"))) notes.push(`Auto style picked ${styleId} from the music tempo and footage.`);
  return [styleId, orderHint];
}

function finalBrief(brief: ProjectBrief, tl: Timeline): ProjectBrief {
  if (brief.inferred.includes("style") && tl.style && brief.style !== tl.style) {
    brief.style = tl.style;
    if (brief.inferred.includes("tone")) brief.tone = STYLE_TONE[tl.style] ?? brief.tone;
  }
  return brief;
}
const hasFace = (inputs: ClipInput[]) => inputs.some((c) => c.analysis.windows.some((w) => w.face));
export function firstShot(tl: Timeline) {
  if (!tl.segments.length) return null;
  const s = tl.segments[0];
  return { clipId: s.clipId, asset: s.video, start: round(s.sourceStart, 2), duration: round(s.timelineEnd - s.timelineStart, 2) };
}
const transitionBudget = (styleId: string) => { try { return getStyle(styleId).maxTransitionRatio; } catch { return 0.5; } };

/** The audio mode that can really be rendered, plus a note when it differs from what was asked. */
export function resolveAudioMode(wanted: string, hasVoice: boolean, hasMusic: boolean): [string, string | null] {
  if (wanted === "voice_music") {
    if (hasVoice && hasMusic) return ["voice_music", null];
    if (hasVoice) return ["voice", "No music was uploaded, so the Reel has the voice-over only."];
    if (hasMusic) return ["music", "There is no voice-over yet (write a script and generate the voice), so only the music is used."];
    return ["none", "There is no music or voice-over, so the Reel is silent."];
  }
  if (wanted === "voice") return hasVoice ? ["voice", null] : hasMusic ? ["music", "There is no voice-over yet, so the music is used."] : ["none", "There is no voice-over, so the Reel is silent."];
  if (wanted === "music") return hasMusic ? ["music", null] : ["none", "No music was uploaded, so the Reel is silent."];
  return [wanted, null];
}

// ------------------------------------------------------------------ export presets (video/presets.py)
export interface ExportPreset { id: string; name: string; width: number; height: number; fps: number; crf: number; maxBitrate: string; audioBitrate: string; maxSeconds: number | null }
const PRESETS = new Map((REGISTRY.exportPresets as { id: string; name: string; width: number; height: number; fps: number; maxSeconds?: number | null }[]).map((p) =>
  [p.id, { crf: 18, maxBitrate: p.id === "youtube" ? "16M" : "12M", audioBitrate: "192k", maxSeconds: p.maxSeconds ?? null, ...p } as ExportPreset]));
export function getPreset(id: string | null | undefined): ExportPreset {
  if (!id || id === "custom") return { id: "custom", name: "Custom", width: env.outputWidth, height: env.outputHeight, fps: env.outputFps, crf: 18, maxBitrate: "12M", audioBitrate: "192k", maxSeconds: null };
  const p = PRESETS.get(id);
  if (!p) throw new ValidationFailed(`Unknown export preset '${id}'.`, { code: "UNKNOWN_PRESET", details: { available: [...PRESETS.keys(), "custom"] } });
  return p;
}
/** Render settings for a preset; "preview" is small and fast. */
export function configFor(presetId: string | null, quality: "final" | "preview" = "final", encoder = "libx264"): RenderConfig {
  const p = getPreset(presetId);
  if (quality === "preview") {
    const w = 360, h = Math.max(round((w * p.height) / p.width / 2) * 2, 2);
    return renderConfig({ width: w, height: h, fps: 24, segmentCrf: 30, segmentPreset: "ultrafast", finalCrf: 30, finalPreset: "ultrafast", maxBitrate: "2M", audioBitrate: "96k", encoder: "libx264", smoothSlowmo: false, stabilize: false });
  }
  return renderConfig({ width: p.width, height: p.height, fps: p.fps, finalCrf: p.crf, maxBitrate: p.maxBitrate, audioBitrate: p.audioBitrate, encoder });
}

// ------------------------------------------------------------------ rendering
/** Timeline (EDL) -> MP4: the single place renders happen, for previews and finals. */
export async function renderEdl(inp: PipelineInput, tl: Timeline, clips: Map<string, ClipAnalysis>, progress: StageProgress): Promise<[RenderResult, string]> {
  const preview = inp.kind === "preview";
  let style: EditingStyle;
  try { style = getStyle(tl.style); } catch { style = getStyle("custom"); }
  if (tl.pictureFade !== null && tl.pictureFade !== undefined) style = withOverrides(style, { fadeInOut: tl.pictureFade });
  if (ig.forInstagram(inp.settings)) { // no fade to black (skip / loop seam); a brand logo only on the closing seconds; hook text from frame one
    style = ig.renderStyle(style);
    tl = { ...tl, watermark: ig.endOnlyWatermark(tl.watermark, tl.duration), overlays: ig.hookFromFirstFrame(tl.overlays) };
  }
  const encoder = preview ? "libx264" : await pickEncoder();
  let cfg = configFor(inp.settings.exportPreset, preview ? "preview" : "final", encoder);
  const [mode, note] = resolveAudioMode(inp.settings.audioMode, tl.voice !== null, inp.audio !== null);
  if (note && !tl.warnings.includes(note)) tl.warnings.push(note);
  cfg = { ...cfg, audioMode: mode };
  const dims = getPreset(inp.settings.exportPreset);
  const sources = new Map<string, SourceClip>();
  for (const v of inp.videos) {
    const a = clips.get(v.id);
    if (!a) continue;
    const wl = a.windows.reduce((s, w) => s + (w.end - w.start), 0);
    sources.set(v.id, { path: localPath(v.key), width: a.metadata.width, height: a.metadata.height, name: v.name, content: a.contentRect as [number, number, number, number] | null,
      hasAudio: a.metadata.hasAudio, shaky: a.shakeScore > 0.35, brightness: a.windows.length ? a.windows.reduce((s, w) => s + w.brightness * (w.end - w.start), 0) / Math.max(wl, 1e-6) : 0.5 });
  }
  const outKey = projectKey(inp.projectId, "output", `${preview ? "preview_" : ""}${inp.renderingId}.mp4`);
  const work = localPath(projectKey(inp.projectId, "temp", `render_${inp.renderingId}`)), capDir = localPath(projectKey(inp.projectId, "temp", `captions_${inp.renderingId}`));
  try {
    const post: string[] = [];
    if (tl.captions.length) post.push(assFilter(writeAss(captionsToCues(tl.captions), tl.captionStyle, path.join(capDir, "captions.ass"), dims.width, dims.height, tl.captionFont, tl.captionColor)));
    if (tl.overlays.length) { const txt = writeOverlaysAss(tl, path.join(capDir, "overlays.ass"), dims.width, dims.height); if (txt) post.push(assFilter(txt)); }
    progress("rendering", 0);
    const result = await renderTimeline({
      timeline: tl, sources, audioPath: inp.audio ? localPath(inp.audio.key) : null, outPath: localPath(outKey), workDir: work, style, cfg, progress: (f) => progress("rendering", f),
      timeout: Math.max(env.renderTimeoutSeconds, tl.duration * RENDER_SECONDS_PER_SECOND), videoPost: post.length ? post : undefined,
      voicePath: tl.voice ? localPath(tl.voice.fileKey) : null, watermarkPath: tl.watermark ? localPath(tl.watermark.logoKey) : null, signal: inp.signal,
    });
    return [result, outKey];
  } finally {
    fs.rmSync(capDir, { recursive: true, force: true });
  }
}

/** Transcribe the music window into editable captions; never fails the Reel. */
async function buildCaptions(inp: PipelineInput, tl: Timeline, audioFile: string, progress: StageProgress) {
  progress("generating_captions", 0);
  try {
    const words = await pipelineAi().transcribe(audioFile, tl.audioStart, tl.duration, (f) => progress("generating_captions", f));
    const cues = groupWords(words, tl.duration);
    if (!cues.length) { tl.warnings.push("Captions: no speech or lyrics were detected in the music, so none were added."); return; }
    tl.captions = cuesToCaptions(cues);
    tl.captionStyle = inp.settings.captionStyle;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    tl.warnings.push(`Captions were skipped: ${e.message}`);
  } finally {
    progress("generating_captions", 1);
  }
}

// ------------------------------------------------------------------ the generate pipeline
export async function runPipeline(inpIn: PipelineInput, progress: StageProgress): Promise<PipelineResult> {
  let inp = inpIn;
  const res = newResult();
  res.clips = await analyzeVideos(inp.projectId, inp.videos, (f) => progress("analyzing_videos", f));
  res.warnings = skippedWarnings(inp, res.clips);
  inp = await dropDuplicateVideos(inp, res.warnings);
  if (!inp.audio && inp.jobType !== "generate") return res;
  res.audio = inp.audio ? await analyzeMusicStage(inp, progress) : neutralAudio(inp.settings.duration);
  if (inp.settings.ai) res.semantics = await understandClips(inp, res.clips, progress, res.warnings);
  if (inp.jobType === "analyze") return res;
  const audio = res.audio;
  const inputs: ClipInput[] = inp.videos.map((v) => ({ clipId: v.id, name: v.name, analysis: res.clips.get(v.id)!, semantic: res.semantics.get(v.id) ?? null }));
  if (inp.settings.sequence === "talk") return runTalking(inp, res, inputs, progress);
  const notes: string[] = [], aiTasks: string[] = res.semantics.size ? ["clip_understanding"] : [];
  const tpl = inp.template as { cuts?: number[]; seconds?: number; use_audio?: boolean; on_beat_share?: number; profile?: Record<string, unknown>; name?: string } | null;
  const followPlan = inp.settings.beatPlan && inp.audio !== null && inp.settings.sequence !== "steps" && !tpl?.cuts?.length;
  const useDirector = inp.settings.ai && inp.settings.aiDirector && inp.settings.sequence !== "steps" && !tpl?.cuts?.length && !followPlan;
  let settings = inp.settings;
  if (tpl?.use_audio && tpl.cuts?.length && inp.audio) {
    const [offset] = referenceWindow(tpl.cuts, tpl.seconds || settings.duration, settings.duration);
    settings = { ...settings, audioStart: offset };
    notes.push(`The reference Reel's own music, from ${Math.trunc(offset / 60)}:${String(Math.trunc(offset % 60)).padStart(2, "0")}: the cuts land where the original's do. To post, use Download without music, then tap Use audio on the original Reel in Instagram.`);
  }
  if (inp.audio && settings.audioStart === null && ["music", "voice_music"].includes(settings.audioMode)) {
    const cats = new Map<string, number>();
    for (const c of inputs) if (c.semantic?.category) cats.set(c.semantic.category, (cats.get(c.semantic.category) ?? 0) + 1);
    const top = [...cats].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const footage = `${inputs.length} clips` + (top.length ? ": " + top.map(([k, v]) => `${k} (${v})`).join(", ") : "");
    const [start, songNote] = await chooseSongPart({ ...inp, settings }, audio, footage);
    if (start !== null) { settings = { ...settings, audioStart: start }; if (settings.ai && songNote.startsWith("AI")) aiTasks.push("music"); }
    if (songNote) notes.push(songNote);
  }
  inp = { ...inp, settings };
  progress("selecting_clips", 0);
  const chosenStyle = await chooseStyleAndOrder(inp, inputs, audio, notes, res.warnings, !useDirector, aiTasks);
  let styleId = chosenStyle[0];
  const orderHint = chosenStyle[1];
  const brandLook = inp.brand?.visualStyle as string | undefined;
  if (settings.style === AUTO_STYLE && brandLook) { styleId = brandLook; notes.push(`Style ${brandLook.replace(/_/g, " ")} from the brand kit (${(inp.brand?.name as string) ?? "brand"}).`); }
  let style = await resolveStyle(settings, styleId);
  let refs = inp.references;
  if (tpl) refs = [{ ...(tpl.profile ?? {}), name: tpl.name || "your reference Reel", chosen: true }, ...refs.map((r) => ({ ...r, chosen: false }))];
  let chosen = refs.find((r) => r.chosen) ?? null;
  if (!chosen && refs.length && settings.sequence === "mixed") {
    const steady = refs.filter((r) => ((r.videos as number) || 0) >= 3);
    const pick = bestMatch(steady, `${settings.brief} ${inp.projectName}`, inp.audio ? audio.bpm : null, settings.duration);
    if (pick) { refs = refs.map((r) => ({ ...r, chosen: r === pick })); chosen = refs.find((r) => r.chosen) ?? null; }
  }
  inp = { ...inp, references: refs };
  if (chosen && ["auto", "balanced"].includes(settings.pace)) {
    let trendNote: string;
    [style, trendNote] = applyLearnedTrend(style, chosen, inp.audio ? audio.bpm : null);
    if (tpl?.cuts?.length) {
      const bounds = [0, ...tpl.cuts, tpl.seconds || settings.duration], shots = bounds.slice(1).map((b, i) => b - bounds[i]).filter((x) => x > 0);
      style = withOverrides(style, { accentHits: false, maxSegment: Math.max(style.maxSegment, Math.max(...shots) + 0.6), minSegment: Math.min(style.minSegment, Math.max(Math.min(...shots) * 0.8, 0.2)) });
    }
    if (trendNote) notes.push(trendNote);
    else if (["calm", "balanced", "fast"].includes(chosen.pace as string)) style = applyPace(style, chosen.pace as string);
  } else if (inp.profile) {
    let profileNotes: string[];
    [style, profileNotes] = applyProfile(style, settings.pace, inp.profile);
    notes.push(...profileNotes);
  }
  if (ig.forInstagram(settings)) style = ig.tuneStyle(style); // hook-first opening, a cut by 1.8 s, short shots, a looping ending
  progress("selecting_clips", 1);
  progress("creating_timeline", 0);
  let direction: string | null = settings.concept !== "auto" ? settings.concept : null;
  const prof = inp.profile;
  if (direction === null && prof?.ready && prof.enabled && prof.preferences.concept) { direction = prof.preferences.concept as string; notes.push(`Concept ${direction} (your director profile: you usually choose it).`); }
  const brief = inferBrief(settings, inp.brand as Record<string, string> | null, inputs.map((c) => c.semantic?.category ?? null), style.id);
  const hooks = hooksFor(direction, generateHooks(inputs, settings.brief, settings.hookText));
  let directed: DirectedReel | null = null, directorError: string | null = null;
  if (useDirector) {
    try { directed = await pipelineAi().directReel({ clips: inputs, audio, style, duration: settings.duration, brief, hooks, direction, seed: inp.seed, settings: { ...settings, projectId: inp.projectId, template: inp.template, references: inp.references, brand: inp.brand } }); }
    catch (e) { if (!(e instanceof AppError)) throw e; directorError = e.message; res.warnings.push(`The AI director was skipped: ${e.message}`); }
  }
  let timeline: Timeline;
  if (directed) {
    timeline = directed.timeline;
    notes.push(...timeline.notes);
    timeline.notes = [];
    if (direction === "cinematic") { const n = storyOrder(timeline, inp.videos.map((v) => v.id), inputs); if (n) notes.push(n); }
    res.postCopy = directed.postCopy;
  } else if (settings.sequence === "steps") {
    const labels = settings.stepLabels && !settings.captions;
    timeline = buildStepsTimeline(audio, inputs, settings.duration, style, { seed: inp.seed, audioStart: settings.audioStart, teaser: settings.teaser, stepLabels: labels, language: settings.language, orderMode: settings.orderMode });
    if (settings.stepLabels && settings.captions) timeline.notes.push("Step numbers were not added because song captions are on (they share the same text track).");
  } else {
    timeline = await buildTimeline(audio, inputs, settings.duration, style, { seed: inp.seed, orderHint, brief: settings.brief, audioStart: settings.audioStart, template: tpl, beatPlan: followPlan,
      everyBeat: settings.cutEveryBeat, minClip: settings.minClip });
    if (followPlan) {
      timeline.pictureFade = 0.4;
      const flashes = timeline.segments.filter((s) => s.effect === "beat_flash").length;
      notes.push(`Cut by the song's beat map: ${timeline.segments.length - flashes} shots on its beats, the drop and strong hits as impacts, ${flashes} flash${flashes !== 1 ? "es" : ""} on hard hits between beats, a fade-in and a hero shot that fades out.`);
    }
    if (tpl) {
      for (const s of timeline.segments) s.locked = true;
      const refShot = (tpl.profile?.median_shot as number) || (tpl.profile?.avg_shot as number) || 0;
      if (refShot >= 2.5 && inp.audio && audio.bpm >= 95) res.warnings.push(`Your reference Reel cuts slowly (about ${fixed(refShot, 1)} s per shot), so this Reel does too, although the song is energetic. For beat-to-beat cutting, remove the reference or use a faster-cut one.`);
      notes.push(`Cut like your reference Reel: ${timeline.segments.length} shots following its timing` + ((tpl.on_beat_share || 0) >= 0.5 ? ", moved onto this song's beats." : "."));
    }
  }
  timeline.warnings = [...res.warnings, ...timeline.warnings];
  const good = inputs.reduce((s, c) => s + goodSeconds(c.analysis), 0);
  if (good < FOOTAGE_HEADROOM * timeline.duration)
    timeline.warnings.unshift(`Not enough good footage: about ${fixed(good, 0)}s of usable video for a ${g(timeline.duration)}s Reel (about ${fixed(FOOTAGE_HEADROOM * timeline.duration, 0)}s is needed to pick the best moments without slowing shots down or showing moments twice). Add clips, or make the Reel shorter.`);
  timeline.notes = [...timeline.notes, ...notes];
  if (ig.forInstagram(settings)) timeline.notes.push(...ig.polishTimeline(timeline, settings.hookText, settings.ctaText));
  ensureTransitions(timeline, audio); // every cut is entered with a transition (none left as a plain cut)
  res.timeline = timeline;
  progress("creating_timeline", 1);
  if (settings.ai && !res.postCopy && directorError === null) {
    progress("writing_copy", 0);
    try { res.postCopy = await pipelineAi().writeCopy({ projectName: inp.projectName, style: timeline.style, bpm: audio.bpm, duration: timeline.duration, clipNames: inp.videos.map((v) => v.name),
      ...(ig.forInstagram(settings) ? { brief: settings.brief, platformRules: ig.COPY_RULES } : {}) }); aiTasks.push("copy"); }
    catch (e) { if (!(e instanceof AppError)) throw e; timeline.warnings.push(`Title/description were skipped: ${e.message}`); }
    progress("writing_copy", 1);
  } else if (settings.ai) progress("writing_copy", 1);
  if (settings.captions && inp.audio) await buildCaptions(inp, timeline, localPath(inp.audio.key), progress);
  if (settings.ai && aiTasks.length) timeline.ai = pipelineAi().info(aiTasks, directed !== null);
  const steps = settings.sequence === "steps";
  const order = steps ? (settings.orderMode === "manual" ? inputs.map((c) => c.clipId) : orderForFood(orderClips([...inputs], [])).clips.map((c) => c.clipId)) : null;
  const teaserFirst = steps && timeline.segments.length > 1 && timeline.segments.slice(1).some((s) => s.clipId === timeline.segments[0].clipId);
  const mm = buildMusicMap(audio, timeline.audioStart, timeline.duration);
  const cplan = directed?.creative ?? draftPlan(brief, hooks, mm, { direction, pace: settings.pace, hasFace: hasFace(inputs) });
  if (inp.audio) {
    timeline.musicHits = songHits(audio);
    if (settings.beatPlan && timeline.pictureFade !== null && timeline.pictureFade !== undefined) {
      const rows = cutPlan(audio, null, null, timeline.audioStart, timeline.audioStart + timeline.duration, null, settings.cutEveryBeat, settings.minClip);
      timeline.musicHits = [...new Set([...timeline.musicHits, ...planHits(rows)])].sort((a, b) => a - b);
    }
  }
  const pace = settings.pace !== "auto" ? settings.pace : directed?.pace || "balanced";
  const checks: Check[] = reviewTimeline(timeline, inputs, mm, { stepsOrder: order, teaserFirst, pace });
  const maxTr = transitionBudget(timeline.style);
  let creative: CreativeReview | null = null;
  progress("reviewing", 0);
  if (settings.autoReview && !inp.revision.length) {
    [timeline, creative] = autoRevise(timeline, inputs, mm, { brief: settings.brief, maxTransitionRatio: maxTr, pace, steps: steps || teaserFirst,
      repair: (t) => reviewTimeline(t, inputs, mm, { stepsOrder: order, teaserFirst, pace }) });
    res.timeline = timeline;
  }
  progress("reviewing", 1);
  const fb = finalBrief(brief, timeline);
  timeline.brief = { ...fb } as Record<string, unknown>;
  timeline.creativePlan = mergeAi(cplan, null, firstShot(timeline)) as unknown as Record<string, unknown>;
  if (settings.soundEffects && settings.audioMode !== "none") {
    timeline.sfx = planSfx(timeline, mm);
    if (timeline.sfx.length) timeline.notes.push(`Sound effects: ${timeline.sfx.length} (${[...new Set(timeline.sfx.map((e) => e.type))].sort().join(", ")}), placed on transitions, the drop and text.`);
  }
  const category = detectCategory(inputs.map((c) => c.semantic), timeline.style);
  const storyNotes = timeline.notes.filter((n) => steps && ["what they show", "file names", "clip list", "finished dish"].some((w) => n.includes(w)));
  [res.render, res.outputKey] = await renderEdl(inp, timeline, res.clips, progress);
  let rendered = await checkRender(localPath(res.outputKey), res.render.duration, inp.audio !== null && settings.audioMode !== "none", inp.kind === "preview");
  const reviewKw = { brief: settings.brief, maxTransitionRatio: maxTr, pace, steps: steps || teaserFirst };
  const sc = await scoreAndCorrect(inp, timeline, inputs, mm, res, progress, rendered, reviewKw);
  timeline = sc.timeline; rendered = sc.rendered;
  res.timeline = timeline;
  checks.push(...rendered);
  const plan = buildReelPlan(timeline, inputs, mm, category, checks, { steps, teaser: teaserFirst, storyNotes });
  sc.review.iterations = creative?.iterations ?? [];
  const hero = findHero(inputs);
  Object.assign(plan, {
    review: reviewDoc(sc.review), scorecard: sc.card, selfCorrection: sc.rounds.map(roundDoc), hookCandidates: rankHooks(inputs, settings.brief).map(hookDoc),
    hooks: hooks.map((h) => ({ clipId: h.clipId, asset: h.name, start: round(h.start, 2), end: round(h.end, 2), type: h.type, hookScore: round(h.hookScore, 3), clarity: round(h.clarity, 3),
      curiosity: round(h.curiosity, 3), visualStrength: round(h.visualStrength, 3), reason: h.reason, text: h.text })),
    brief: timeline.brief, creativePlan: timeline.creativePlan, heroMoment: hero ? heroDoc(hero) : null,
  });
  if (directed?.aiLog) plan.aiDirector = directed.aiLog;
  else if (useDirector && !directed) plan.directorFallback = { reason: directorError ?? "no clip the AI could use" };
  if (ig.forInstagram(settings)) { // Instagram-ready caption and the ranking check
    const usedClips = new Set(timeline.segments.map((s) => s.clipId));
    res.postCopy = ig.finalizeCopy(res.postCopy, { name: inp.projectName, brief: settings.brief, language: settings.language, subjects: inputs.filter((c) => c.semantic && usedClips.has(c.clipId)).map((c) => String(c.semantic!.summary || c.semantic!.scene || "")) });
    const r = res.render;
    plan.instagram = ig.buildReport(timeline, res.clips, { audioMode: resolveAudioMode(settings.audioMode, timeline.voice !== null, inp.audio !== null)[0], brief: settings.brief, ctaText: settings.ctaText,
      postCopy: res.postCopy, render: r ? [r.width, r.height, r.size, r.duration] : null, preview: inp.kind === "preview" });
  }
  res.reelPlan = plan;
  for (const w of checks.filter((c) => !c.ok).map((c) => `Quality check: ${c.name}. ${c.detail}`.trim())) if (!timeline.warnings.includes(w)) timeline.warnings.push(w);
  return res;
}

/** Score the rendered Reel and, below the threshold, correct -> re-render -> re-score (kept only when it improves). */
async function scoreAndCorrect(inp: PipelineInput, tlIn: Timeline, inputs: ClipInput[], mm: MusicMap, res: PipelineResult, progress: StageProgress, renderedIn: Check[],
  kw: { brief: string; maxTransitionRatio: number; pace: string; steps: boolean }) {
  const expectAudio = inp.audio !== null && inp.settings.audioMode !== "none", finalRender = inp.kind !== "preview";
  let timeline = tlIn, rendered = renderedIn;
  const measure = async (tl: Timeline, key: string, rchecks: Check[]) => {
    let fi: FileIssue[] | null = null;
    if (finalRender) try { fi = (await checkRenderFile(localPath(key), null, tl.duration, true)) as FileIssue[]; } catch (e) { if (!(e instanceof AppError)) throw e; }
    const rv = reviewEdit(tl, inputs, mm, { ...kw, renderChecks: rchecks });
    return { rv, fi, card: scorecard(rv, { timeline: tl, fileIssues: fi, brief: tl.brief, brand: inp.brand, expectAudio, threshold: env.reviewThreshold }) };
  };
  let { rv: review, fi: fileIssues, card } = await measure(timeline, res.outputKey!, rendered);
  const rounds: Round[] = [];
  if (!(inp.settings.autoReview && finalRender && !inp.revision.length)) return { timeline, rendered, review, card, rounds };
  const first = card.overallScore;
  for (let it = 1; it < Math.min(env.reviewMaxIterations, MAX_ITERATIONS); it++) {
    if (card.overallScore >= env.reviewThreshold) break;
    const rnd: Round = { iteration: it, scoreBefore: card.overallScore, scoreAfter: null, changes: [], kept: false, aiSummary: "" };
    rounds.push(rnd);
    progress("reviewing", 0.5);
    let aiFixes: { fix: string; at: number | null; problem: string }[] = [];
    if (inp.settings.ai) {
      try { const ans = await pipelineAi().review({ card, timeline, plan: timeline.creativePlan }); aiFixes = ans.fixes; rnd.aiSummary = ans.summary; }
      catch (e) { if (!(e instanceof AppError)) throw e; }
    }
    const [cand, changes] = correct(timeline, review, fileIssues ?? [], aiFixes, inputs, mm, { brief: kw.brief, maxTransitionRatio: kw.maxTransitionRatio });
    rnd.changes = changes;
    if (!changes.length) break;
    let render2: RenderResult, key2: string;
    try { [render2, key2] = await renderEdl({ ...inp, renderingId: `${inp.renderingId}_fix${it}` }, cand, res.clips, () => {}); }
    catch (e) { if (!(e instanceof AppError)) throw e; rnd.changes.push(`(not applied: the corrected render failed: ${e.message})`); break; }
    const rendered2 = await checkRender(localPath(key2), render2.duration, expectAudio, false);
    const m2 = await measure(cand, key2, rendered2);
    rnd.scoreAfter = m2.card.overallScore;
    if (m2.card.overallScore <= card.overallScore) { fs.rmSync(localPath(key2), { force: true }); break; }
    rnd.kept = true;
    moveFile(localPath(key2), localPath(res.outputKey!));
    res.render = { ...render2, path: localPath(res.outputKey!) };
    timeline = cand; review = m2.rv; fileIssues = m2.fi; card = m2.card; rendered = rendered2;
  }
  const kept = rounds.filter((r) => r.kept);
  if (kept.length) timeline.notes.push(`Reviewer: ${first} -> ${card.overallScore}/100 after ${kept.length} correction(s) and re-render(s): ` + kept.flatMap((r) => r.changes).join("; ").slice(0, 300));
  else if (rounds.length) timeline.notes.push(`Reviewer: ${first}/100 (below ${env.reviewThreshold}); no correction improved it, so this render was kept.`);
  return { timeline, rendered, review, card, rounds };
}

// ------------------------------------------------------------------ talking head
const transcriptKey = (pid: string, mid: string) => projectKey(pid, "analysis", `transcript_${mid}.json`);

export async function transcribeClips(inp: PipelineInput, inputs: ClipInput[], progress: StageProgress, warnings: string[]): Promise<Map<string, Word[]>> {
  const out = new Map<string, Word[]>(), n = Math.max(inputs.length, 1), ver = `${env.whisperModel}_${env.whisperLanguage || "auto"}_1`;
  for (const [i, c] of inputs.entries()) {
    progress("selecting_clips", i / n);
    if (!c.analysis.metadata.hasAudio) { warnings.push(`${c.name} has no sound, so it has no speech to use.`); continue; }
    const ref = inp.videos.find((v) => v.id === c.clipId)!;
    const digest = await shared.contentHash(ref.key);
    let doc = readJson<{ words: [string, number, number][] }>(transcriptKey(inp.projectId, c.clipId)) ?? shared.load<{ words: [string, number, number][] }>(digest, "transcript", ver);
    if (!doc) {
      const words = await pipelineAi().transcribe(localPath(ref.key), 0, c.analysis.metadata.duration, (f) => progress("selecting_clips", (i + f) / n));
      doc = { words: words.map((w) => [w.text, w.start, w.end]) };
      shared.save(digest, "transcript", ver, doc);
    }
    writeJson(transcriptKey(inp.projectId, c.clipId), doc);
    out.set(c.clipId, (doc.words ?? []).map(([text, a, b]) => ({ text, start: Number(a), end: Number(b) })));
  }
  progress("selecting_clips", 1);
  return out;
}

async function runTalking(inp: PipelineInput, res: PipelineResult, inputs: ClipInput[], progress: StageProgress): Promise<PipelineResult> {
  const transcripts = await transcribeClips(inp, inputs, progress, res.warnings);
  progress("creating_timeline", 0);
  const [tl, st] = buildTalkingTimeline(inputs, transcripts, inp.settings.duration);
  if (!tl.segments.length) throw new ValidationFailed("No speech was found in these clips. Talking-head mode needs clips of someone speaking with their sound on; for other footage choose Best moments.", { code: "NO_SPEECH" });
  tl.warnings = [...res.warnings];
  tl.notes = [`Talking head: ${fixed(st.spoken, 0)}s of speech in ${st.shots} cuts; ${fixed(st.cut, 0)}s of pauses and filler words were cut out. Captions follow the words.` +
    (st.left_out ? ` ${st.left_out} later sentence(s) were left out to stay within ${inp.settings.duration}s.` : "")];
  progress("creating_timeline", 1);
  res.timeline = tl;
  [res.render, res.outputKey] = await renderEdl({ ...inp, settings: { ...inp.settings, audioMode: "original" } }, tl, res.clips, progress);
  const rendered = await checkRender(localPath(res.outputKey), res.render.duration, true, inp.kind === "preview");
  tl.warnings.push(...rendered.filter((c) => !c.ok).map((c) => `Quality check: ${c.name}. ${c.detail}`.trim()));
  return res;
}

// ------------------------------------------------------------------ render a stored timeline, and versions
export async function runRender(inp: PipelineInput, progress: StageProgress): Promise<PipelineResult> {
  const res = newResult();
  res.timeline = inp.timeline;
  res.clips = await analyzeVideos(inp.projectId, inp.videos);
  [res.render, res.outputKey] = await renderEdl(inp, inp.timeline!, res.clips, progress);
  if (inp.kind !== "preview") {
    const check = await finalCheck(localPath(res.outputKey), inp.timeline!, Object.fromEntries([...res.clips].map(([k, c]) => [k, c.metadata.duration])), [res.render.width, res.render.height]);
    res.renderCheck = check as unknown as Record<string, unknown>;
    if (!check.passed) res.warnings.push(...check.issues.filter((i) => i.severity === "error" || i.severity === "warning").map((i) => i.message));
  }
  return res;
}

/** Several versions of the same Reel, each with a different editing strategy; media analysed once. */
export async function runVariations(inpIn: PipelineInput, progress: StageProgress): Promise<PipelineResult> {
  let inp = inpIn;
  const res = newResult();
  res.clips = await analyzeVideos(inp.projectId, inp.videos, (f) => progress("analyzing_videos", f));
  res.warnings = skippedWarnings(inp, res.clips);
  inp = await dropDuplicateVideos(inp, res.warnings);
  res.audio = inp.audio ? await analyzeMusicStage(inp, progress) : neutralAudio(inp.settings.duration);
  if (inp.settings.ai) res.semantics = await understandClips(inp, res.clips, progress, res.warnings);
  const audio = res.audio;
  const inputs: ClipInput[] = inp.videos.map((v) => ({ clipId: v.id, name: v.name, analysis: res.clips.get(v.id)!, semantic: res.semantics.get(v.id) ?? null }));
  const brief = inferBrief(inp.settings, inp.brand as Record<string, string> | null, inputs.map((c) => c.semantic?.category ?? null));
  const hooks = generateHooks(inputs, inp.settings.brief, inp.settings.hookText);
  const base = inp.timeline, n = Math.max(inp.strategies.length, 1), opened = new Set<string>();
  for (const [i, sid] of inp.strategies.entries()) {
    const st = getStrategy(sid), direction = sid in DIRECTIONS ? sid : null, vHooks = hooksFor(direction, hooks, opened);
    const settings: ProjectSettings = { ...inp.settings, style: st.style, pace: st.pace as ProjectSettings["pace"], captionStyle: st.captionStyle as ProjectSettings["captionStyle"], ...(direction ? { concept: direction as ProjectSettings["concept"] } : {}) };
    const duration = base?.voice ? base.duration : inp.settings.duration;
    let tl: Timeline | null = null, cplan = null as ReturnType<typeof draftPlan> | null;
    const warns: string[] = [], aiTasks: string[] = [];
    if (direction && settings.ai && settings.aiDirector && settings.sequence !== "steps" && !base?.voice) {
      try {
        const d = await pipelineAi().directReel({ clips: inputs, audio, style: await resolveStyle(settings), duration, brief, hooks: vHooks, direction, seed: inp.seed + i * 101, settings: { ...settings, projectId: inp.projectId, template: null, references: inp.references, brand: inp.brand } });
        if (d) { tl = d.timeline; cplan = d.creative; tl.ai = pipelineAi().info(aiTasks, true); }
      } catch (e) { if (!(e instanceof AppError)) throw e; warns.push(`The AI director was skipped: ${e.message}`); }
    }
    if (!tl) {
      const order = direction ? DIRECTIONS[direction].order : st.order;
      tl = await buildTimeline(audio, inputs, duration, ig.forInstagram(settings) ? ig.tuneStyle(await resolveStyle(settings)) : await resolveStyle(settings), { seed: inp.seed + i * 101, orderHint: order === "chronological" ? chronologicalHint(inp.videos.map((v) => v.id)) : null,
        brief: inp.settings.brief, audioStart: inp.settings.audioStart });
    }
    tl.warnings = [...res.warnings, ...warns, ...tl.warnings];
    if (inp.audio) tl.musicHits = songHits(audio);
    const mm = buildMusicMap(audio, tl.audioStart, tl.duration);
    cplan = cplan ?? draftPlan(brief, vHooks, mm, { direction, pace: st.pace, hasFace: hasFace(inputs) });
    const notesV: string[] = [];
    if (direction === "cinematic" && tl.ai) { const x = storyOrder(tl, inp.videos.map((v) => v.id), inputs); if (x) notesV.push(x); }
    const note = direction ? await distinctOpening(tl, vHooks, opened, inputs) : null;
    if (tl.segments.length) opened.add(tl.segments[0].clipId);
    tl.brief = { ...finalBrief(structuredClone(brief), tl) } as Record<string, unknown>;
    tl.creativePlan = mergeAi(cplan, null, firstShot(tl)) as unknown as Record<string, unknown>;
    tl.notes = [`${versionLabel(i, st)}: ${st.description}`, ...(cplan.logline ? [`Concept: ${cplan.concept}. ${cplan.logline}`] : []), ...notesV, ...(note ? [note] : [])];
    tl.captionStyle = st.captionStyle;
    if (base) {
      Object.assign(tl, { watermark: base.watermark, captionFont: base.captionFont, captionColor: base.captionColor, musicVolume: base.musicVolume });
      if (base.voice || Math.abs(base.duration - tl.duration) < 0.3) { tl.voice = base.voice; tl.captions = structuredClone(base.captions); }
    }
    const rid = inp.variantIds[i];
    const [render, key] = await renderEdl({ ...inp, settings, renderingId: rid }, tl, res.clips, (_s, f) => progress("rendering", (i + f) / n));
    res.variants.push({ strategyId: sid, label: versionLabel(i, st), renderingId: rid, timeline: TimelineSchema.parse(tl), render, outputKey: key });
  }
  progress("rendering", 1);
  return res;
}

export { listStyles };
