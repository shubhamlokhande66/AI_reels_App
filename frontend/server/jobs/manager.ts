import "server-only";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { settings as env } from "@/server/core/config";
import { db } from "@/server/core/db";
import { AppError, ConflictError, NotFoundError, ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import { DEFAULT_SET, getStrategy } from "@/server/director/creative";
import { loadProfile, loadReferences } from "@/server/director/learned";
import { ensureIds, Timeline as TimelineSchema } from "@/server/models/timeline";
import { getProjectDoc, validateTrendId } from "@/server/projects/service";
import { ProjectSettings } from "@/server/projects/settings";
import { record } from "@/server/services/feedback";
import * as shared from "@/server/services/analysisCache";
import { deletePrefix, localPath } from "@/server/storage/local";
import { validateStyleId } from "@/server/styles";
import { clipSummary } from "@/server/video/analyzer";
import type { VideoRef } from "@/server/video/clips";
import * as pl from "./pipeline";
import { runSplit } from "./split";
import { getProductStyle } from "@/server/product/director";
import { runProduct } from "@/server/product";
import { getStory, runStory } from "@/server/story";

/** Background jobs (was jobs/manager.py): a job document per request, the pipeline run in the background with at most
 * MAX_CONCURRENT_JOBS at once, progress written to the job as it goes, cancel, and the results stored on the project.
 * Heavy work happens in FFmpeg processes and worker threads, so the server keeps answering while a Reel renders. */

type Doc = Record<string, unknown> & { _id: ObjectId };
const now = () => new Date();

export const GenerateRequest = z.object({
  style: z.string().nullish(), pace: z.enum(["auto", "calm", "balanced", "fast"]).nullish(), sequence: z.string().nullish(), teaser: z.boolean().nullish(),
  stepLabels: z.boolean().nullish(), orderMode: z.string().nullish(), exportPreset: z.string().nullish(), brief: z.string().max(1000).nullish(), audioMode: z.string().nullish(),
  language: z.string().nullish(), duration: z.number().int().min(5).max(600).nullish(), audioStart: z.number().min(0).max(36000).nullish(), audioAuto: z.boolean().default(false),
  captions: z.boolean().nullish(), captionStyle: z.string().nullish(), ai: z.boolean().nullish(), aiDirector: z.boolean().nullish(), beatPlan: z.boolean().nullish(),
  cutEveryBeat: z.boolean().nullish(), minClip: z.union([z.literal(0.25), z.literal(0.35), z.literal(0.4), z.literal(0.6)]).nullish(), autoReview: z.boolean().nullish(),
  soundEffects: z.boolean().nullish(), trendId: z.string().nullish(), reference: z.string().max(40).nullish(), concept: z.enum(["auto", "viral", "cinematic", "premium"]).nullish(),
  objective: z.string().max(60).nullish(), audience: z.string().max(60).nullish(), seed: z.number().int().nullish(), label: z.string().max(60).nullish(),
});
export type GenerateRequest = z.infer<typeof GenerateRequest>;
const OVERRIDES = ["style", "pace", "sequence", "teaser", "stepLabels", "orderMode", "exportPreset", "brief", "audioMode", "language", "duration", "audioStart", "captions", "captionStyle", "ai",
  "aiDirector", "beatPlan", "cutEveryBeat", "minClip", "autoReview", "soundEffects", "trendId", "reference", "concept", "objective", "audience"] as const;

// ------------------------------------------------------------------ the queue
interface Running { controller: AbortController }
type JobState = { running: Map<string, Running>; active: number; waiting: (() => void)[]; recovered: boolean };
const g = globalThis as unknown as { __jobs?: JobState };
const state = (): JobState => (g.__jobs ??= { running: new Map(), active: 0, waiting: [], recovered: false });

async function slot(): Promise<() => void> {
  const s = state();
  if (s.active >= Math.max(env.maxConcurrentJobs, 1)) await new Promise<void>((r) => s.waiting.push(r));
  s.active++;
  return () => { s.active--; s.waiting.shift()?.(); };
}

/** Ask a queued / running job to stop at its next progress tick. False when this server is not running it. */
export function requestCancel(jobId: string): boolean {
  const r = state().running.get(jobId);
  if (!r) return false;
  r.controller.abort();
  return true;
}

/** Jobs left "processing" by an earlier server run can never finish: fail them cleanly (once per server start). */
export async function recoverStaleJobs() {
  const s = state();
  if (s.recovered) return;
  s.recovered = true;
  const d = await db(), err = { code: "JOB_INTERRUPTED", message: "The server restarted while this job was running.", details: null };
  for (const j of await d.collection("jobs").find({ status: { $in: ["queued", "processing"] }, runner: "next" }).toArray()) {
    if (s.running.has(String(j._id))) continue;
    await d.collection("jobs").updateOne({ _id: j._id }, { $set: { status: "failed", error: err, updatedAt: now() } });
    await d.collection("projects").updateOne({ _id: j.projectId, status: "processing" }, { $set: { status: "failed", error: err, updatedAt: now() } });
  }
}

const initialStages = (jobType: string, captions = false, ai = false) => {
  const labels = pl.stageLabels();
  return pl.stageNames(jobType, captions, ai).map((name) => ({ name, label: labels[name], status: "pending", progress: 0 }));
};
const errorDoc = (e: unknown) => {
  if (e instanceof AppError) return { code: e.code, message: e.message, details: e.details ?? null };
  console.error("job crashed", e);
  return { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", details: null };
};
const ref = (m: Doc): VideoRef => ({ id: String(m._id), name: m.originalName as string, key: m.storedKey as string, width: (m.width as number) || 0, height: (m.height as number) || 0 });

function ensureNotPurged(media: (Doc | null | undefined)[]) {
  if (media.some((m) => m?.purged)) throw new ValidationFailed("The uploaded clips and music of this project were deleted after rendering (privacy). Upload them again to make a new version; the finished Reels are still available.", { code: "MEDIA_PURGED" });
}

async function projectMedia(doc: Doc) {
  const media = new Map((await (await db()).collection("media").find({ projectId: doc._id }).toArray()).map((m) => [String(m._id), m as Doc]));
  const videos = ((doc.videoOrder as unknown[]) ?? []).map((i) => media.get(String(i))).filter((m): m is Doc => Boolean(m));
  const audio = doc.audioId ? media.get(String(doc.audioId)) ?? null : null;
  return { videos, audio };
}

async function updateJob(jobId: ObjectId, fields: Record<string, unknown>, onlyActive = false) {
  const q: Record<string, unknown> = { _id: jobId };
  if (onlyActive) q.status = { $in: ["queued", "processing"] }; // a late tick never resurrects a finished job
  await (await db()).collection("jobs").updateOne(q, { $set: { ...fields, updatedAt: now() } });
}

/** The project's brand kit for the director (null when none). */
export async function loadBrand(brandId: string | null | undefined): Promise<Record<string, unknown> | null> {
  if (!brandId || !ObjectId.isValid(brandId)) return null;
  const d = await (await db()).collection("brands").findOne({ _id: new ObjectId(brandId) });
  if (!d) return null;
  return Object.fromEntries(["name", "colors", "headingFont", "captionFont", "cta", "scriptTone", "style", "visualStyle", "pace", "language"].filter((k) => d[k] !== undefined && d[k] !== null).map((k) => [k, d[k]]));
}

async function newJob(doc: Doc, type: string, stage: string, stages: unknown[], setOnProject: Record<string, unknown> = {}) {
  if (doc.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  const t = now(), jobId = new ObjectId();
  const job = { _id: jobId, projectId: doc._id, type, status: "queued", progress: 0, stage, stages, error: null, renderingId: null, runner: "next", createdAt: t, updatedAt: t };
  const d = await db();
  await d.collection("jobs").insertOne(job);
  await d.collection("projects").updateOne({ _id: doc._id }, { $set: { status: "processing", latestJobId: jobId, error: null, updatedAt: t, ...setOnProject } });
  return job;
}

// ------------------------------------------------------------------ submit
export async function submit(projectId: string, jobType: "analyze" | "generate", req: GenerateRequest | null = null, revision: Record<string, unknown>[] = []) {
  await recoverStaleJobs();
  const doc = (await getProjectDoc(projectId)) as Doc;
  if (doc.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  const { videos, audio } = await projectMedia(doc);
  if (!videos.length) throw new ValidationFailed("Upload at least one video first.", { code: "NO_VIDEOS" });
  ensureNotPurged([...videos, audio]);
  const settings: Record<string, unknown> = { ...(doc.settings as Record<string, unknown>) };
  let seed = 0;
  if (req) {
    for (const k of OVERRIDES) if (req[k] !== null && req[k] !== undefined) settings[k] = req[k];
    if (req.style) validateStyleId(req.style);
    await validateTrendId(req.trendId);
    if (req.exportPreset) pl.getPreset(req.exportPreset);
    if (req.audioAuto) settings.audioStart = null;
    seed = req.seed ?? 0;
    const before = (doc.settings as Record<string, unknown>)?.style;
    if (req.style && req.style !== before) await record(doc._id, "changed_style", { frm: before as string, to: req.style });
  }
  const ps = ProjectSettings.parse(settings);
  if (jobType === "generate" && !audio && ["music", "voice_music"].includes(ps.audioMode)) throw new ValidationFailed("Upload a music file first (or choose an audio mode that does not need music).", { code: "NO_AUDIO" });
  const renderingId = new ObjectId();
  const job = await newJob(doc, jobType, pl.stageNames(jobType)[0], initialStages(jobType, ps.captions, ps.ai), { settings: ps });
  const inp = pl.pipelineInput({
    projectId: String(doc._id), jobType, videos: videos.map(ref), audio: audio ? ref(audio) : null, settings: ps, renderingId: String(renderingId), seed, projectName: doc.name as string,
    revision, references: await loadReferences(ps.reference), profile: jobType === "generate" ? await loadProfile() : null, brand: await loadBrand(ps.brandId),
    template: jobType === "generate" ? (doc.referenceReel as Record<string, unknown>) ?? null : null,
  });
  spawn(job._id, doc._id, inp, renderingId, doc.latestRenderingId ? "completed" : "draft", req?.label ?? "");
  return job;
}

/** Render the project's current timeline (as edited); "preview" is small and quick. */
export async function submitRender(projectId: string, quality: string = "final", label = "") {
  await recoverStaleJobs();
  if (!["preview", "final"].includes(quality)) throw new ValidationFailed("Quality must be 'preview' or 'final'.", { code: "INVALID_QUALITY" });
  const doc = (await getProjectDoc(projectId)) as Doc;
  if (doc.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  if (!doc.timeline) throw new ValidationFailed("Generate a Reel first; there is no timeline to render yet.", { code: "NO_TIMELINE" });
  const { videos, audio } = await projectMedia(doc);
  const timeline = TimelineSchema.parse(ensureIds(doc.timeline as Record<string, unknown>));
  const ps = ProjectSettings.parse(doc.settings ?? {});
  ensureNotPurged([...videos, audio]);
  if (!videos.length || (!audio && ["music", "voice_music"].includes(ps.audioMode) && !timeline.voice)) throw new ValidationFailed("The project needs its videos (and music, for this audio mode) to render.", { code: "NO_MEDIA" });
  const renderingId = new ObjectId();
  const job = await newJob(doc, "render", "rendering", initialStages("render"));
  const inp = pl.pipelineInput({ projectId: String(doc._id), jobType: "render", videos: videos.map(ref), audio: audio ? ref(audio) : null, settings: ps, renderingId: String(renderingId),
    projectName: doc.name as string, kind: quality as "final" | "preview", timeline });
  spawn(job._id, doc._id, inp, renderingId, doc.latestRenderingId ? "completed" : "draft", label);
  return job;
}

/** Several versions (each a different editing strategy) from the same footage and music. */
export async function submitVariations(projectId: string, strategyIds: string[] | null = null, seed = 0) {
  await recoverStaleJobs();
  const ids = [...new Set(strategyIds ?? DEFAULT_SET)];
  if (ids.length < 1 || ids.length > 6) throw new ValidationFailed("Choose between 1 and 6 strategies.", { code: "INVALID_STRATEGIES" });
  ids.forEach(getStrategy);
  const doc = (await getProjectDoc(projectId)) as Doc;
  if (doc.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  const { videos, audio } = await projectMedia(doc);
  const ps = ProjectSettings.parse(doc.settings ?? {});
  if (!videos.length) throw new ValidationFailed("Upload at least one video first.", { code: "NO_VIDEOS" });
  ensureNotPurged([...videos, audio]);
  if (!audio && ["music", "voice_music"].includes(ps.audioMode)) throw new ValidationFailed("Upload a music file first (or choose an audio mode that does not need music).", { code: "NO_AUDIO" });
  const base = doc.timeline ? TimelineSchema.parse(ensureIds(doc.timeline as Record<string, unknown>)) : null;
  const job = await newJob(doc, "variations", "analyzing_videos", initialStages("variations", false, ps.ai));
  const inp = pl.pipelineInput({ projectId: String(doc._id), jobType: "variations", videos: videos.map(ref), audio: audio ? ref(audio) : null, settings: ps, renderingId: String(new ObjectId()),
    seed, projectName: doc.name as string, kind: "final", timeline: base, strategies: ids, variantIds: ids.map(() => String(new ObjectId())), brand: await loadBrand(ps.brandId),
    references: await loadReferences(ps.reference) });
  spawn(job._id, doc._id, inp, new ObjectId(), doc.latestRenderingId ? "completed" : "draft", "");
  return job;
}

/** The settings, photos and music of a product project, checked and ready to plan or render. */
export async function productInput(projectId: string, overrides: Record<string, unknown> = {}, quality = "final", seed = 0, audioAuto = false) {
  if (!["preview", "final"].includes(quality)) throw new ValidationFailed("Quality must be 'preview' or 'final'.", { code: "INVALID_QUALITY" });
  const doc = (await getProjectDoc(projectId)) as Doc;
  const s: Record<string, unknown> = { ...(doc.settings as Record<string, unknown>), ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== null && v !== undefined)) };
  if (audioAuto) s.audioStart = null;
  if (s.reelType !== "product") throw new ValidationFailed("This project is not a product Reel project.", { code: "NOT_A_PRODUCT_PROJECT" });
  getProductStyle(String(s.productStyle ?? "luxury_jewelry"));
  const ps = ProjectSettings.parse(s), d = await db();
  const media = new Map((await d.collection("media").find({ projectId: doc._id }).toArray()).map((m) => [String(m._id), m]));
  const images = ((doc.imageOrder as unknown[]) ?? []).map((i) => media.get(String(i))).filter((m) => m !== undefined);
  const audio = doc.audioId ? media.get(String(doc.audioId)) : undefined;
  if (!images.length) throw new ValidationFailed("Add at least one product photo first.", { code: "NO_IMAGES" });
  const inp = pl.pipelineInput({ projectId: String(doc._id), jobType: "product", videos: [], audio: audio ? ref(audio) : null, settings: ps, renderingId: String(new ObjectId()), seed,
    projectName: doc.name as string, kind: quality as "final" | "preview", images: images.map(ref) });
  return { doc, inp };
}
/** Direct and render a Reel from the project's photos (and music, if any). */
export async function submitProduct(projectId: string, overrides: Record<string, unknown> = {}, quality = "final", label = "", seed = 0, audioAuto = false) {
  await recoverStaleJobs();
  const doc0 = (await getProjectDoc(projectId)) as Doc;
  if (doc0.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  const { doc, inp } = await productInput(projectId, overrides, quality, seed, audioAuto);
  const job = await newJob(doc, "product", pl.stageNames("product")[0], initialStages("product"), { settings: inp.settings });
  spawn(job._id, doc._id, inp, new ObjectId(inp.renderingId), doc.latestRenderingId ? "completed" : "draft", label);
  return job;
}

/** Narrate and render a story project (every scene needs its picture). */
export async function submitStory(projectId: string, voiceId: string | null, quality = "final", label = "") {
  await recoverStaleJobs();
  const doc = (await getProjectDoc(projectId)) as Doc;
  if (doc.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  const plan = getStory(doc), missing = plan.scenes.map((sc, i) => (sc.image_key ? "" : String(i + 1))).filter(Boolean);
  if (missing.length) throw new ValidationFailed(`Give every scene a picture first (missing: scene ${missing.join(", ")}).`, { code: "STORY_PICTURES_MISSING" });
  const audio = doc.audioId ? await (await db()).collection("media").findOne({ _id: doc.audioId as ObjectId }) : null;
  const ps = ProjectSettings.parse(doc.settings);
  const inp = pl.pipelineInput({ projectId: String(doc._id), jobType: "story", videos: [], audio: audio && !audio.purged ? ref(audio) : null, settings: ps, renderingId: String(new ObjectId()),
    projectName: doc.name as string, kind: quality === "preview" ? "preview" : "final", story: doc.story as Record<string, unknown>, voiceId, template: (doc.referenceReel as Record<string, unknown>) ?? null });
  const job = await newJob(doc, "story", "voicing", initialStages("story"));
  spawn(job._id, doc._id, inp, new ObjectId(inp.renderingId), doc.latestRenderingId ? "completed" : "draft", label);
  return job;
}

/** One long video -> `count` Reels of about `seconds` each, from its best parts (saved as versions). */
export async function submitSplit(projectId: string, count: number, seconds: number) {
  await recoverStaleJobs();
  if (count < 1 || count > 5) throw new ValidationFailed("Choose between 1 and 5 Reels.", { code: "INVALID_COUNT" });
  const doc = (await getProjectDoc(projectId)) as Doc;
  if (doc.status === "processing") throw new ConflictError("This project is already being processed.", { code: "PROJECT_BUSY" });
  const { videos, audio } = await projectMedia(doc);
  if (!videos.length) throw new ValidationFailed("Upload the long video first.", { code: "NO_VIDEOS" });
  ensureNotPurged([...videos, audio]);
  const ps = ProjectSettings.parse({ ...(doc.settings as Record<string, unknown>), duration: seconds });
  const job = await newJob(doc, "split", "analyzing_videos", initialStages("split", false, ps.ai));
  const inp = pl.pipelineInput({ projectId: String(doc._id), jobType: "split", videos: videos.map(ref), audio: audio ? ref(audio) : null, settings: ps, renderingId: String(new ObjectId()),
    projectName: doc.name as string, kind: "final", strategies: Array.from({ length: count }, (_, i) => `part${i + 1}`), variantIds: Array.from({ length: count }, () => String(new ObjectId())),
    brand: await loadBrand(ps.brandId) });
  spawn(job._id, doc._id, inp, new ObjectId(), doc.latestRenderingId ? "completed" : "draft", "");
  return job;
}

// ------------------------------------------------------------------ run
function spawn(jobId: ObjectId, projectOid: ObjectId, inp: pl.PipelineInput, renderingId: ObjectId, priorStatus: string, label: string) {
  const controller = new AbortController();
  state().running.set(String(jobId), { controller });
  void run(jobId, projectOid, { ...inp, signal: controller.signal }, renderingId, priorStatus, label, controller).finally(() => state().running.delete(String(jobId)));
}

async function run(jobId: ObjectId, projectOid: ObjectId, inp: pl.PipelineInput, renderingId: ObjectId, priorStatus: string, label: string, controller: AbortController) {
  const release = await slot();
  const caps = inp.settings.captions, ai = inp.settings.ai;
  const stages = initialStages(inp.jobType, caps, ai), names = stages.map((s) => s.name);
  let last = -1, pending: Promise<void> = Promise.resolve();
  const onProgress: pl.StageProgress = (stage, fraction) => {
    if (controller.signal.aborted) throw new AppError("Cancelled by you.", { code: "JOB_CANCELLED", status: 409 });
    const pct = pl.overallProgress(inp.jobType, stage, fraction, caps, ai), stagePct = round(Math.min(Math.max(fraction, 0), 1) * 100);
    let changed = false;
    for (const s of stages) {
      if (s.name === stage) { if (s.progress !== stagePct || s.status === "pending") { s.progress = stagePct; s.status = stagePct >= 100 ? "completed" : "running"; changed = true; } }
      else if (s.status !== "completed" && names.indexOf(s.name) < names.indexOf(stage)) { s.progress = 100; s.status = "completed"; changed = true; }
    }
    if (changed || pct !== last) {
      last = pct;
      const snapshot = stages.map((s) => ({ ...s }));
      pending = pending.then(() => updateJob(jobId, { status: "processing", progress: pct, stage, stages: snapshot }, true)).catch(() => {});
    }
  };
  try {
    let result: pl.PipelineResult;
    try {
      await updateJob(jobId, { status: "processing" }, true);
      const fn = inp.jobType === "render" ? pl.runRender : inp.jobType === "variations" ? pl.runVariations : inp.jobType === "split" ? runSplit : inp.jobType === "product" ? runProduct : inp.jobType === "story" ? runStory : pl.runPipeline;
      result = await fn(inp, onProgress);
      await pending;
    } catch (e) {
      await pending;
      const cancelled = controller.signal.aborted || (e instanceof AppError && e.code === "JOB_CANCELLED");
      const err = cancelled ? { code: "JOB_CANCELLED", message: "Cancelled by you.", details: null } : errorDoc(e);
      await updateJob(jobId, { status: cancelled ? "cancelled" : "failed", error: err, stages: stages.map((s) => (s.status === "running" ? { ...s, status: "failed" } : { ...s })) });
      const status = cancelled || ["render", "variations", "split"].includes(inp.jobType) || (inp.jobType === "product" && inp.kind === "preview") ? priorStatus : "failed";
      await (await db()).collection("projects").updateOne({ _id: projectOid }, { $set: { status, error: cancelled ? null : err, updatedAt: now() } });
      deletePrefix(`projects/${inp.projectId}/temp/render_${inp.renderingId}`);
      return;
    }
    await finish(jobId, projectOid, inp, result, renderingId, priorStatus, label);
  } catch (e) {
    console.error("job could not be finished", e);
    await updateJob(jobId, { status: "failed", error: errorDoc(e) }).catch(() => {});
    await (await db()).collection("projects").updateOne({ _id: projectOid }, { $set: { status: priorStatus, updatedAt: now() } }).catch(() => {});
  } finally {
    release();
  }
}

// ------------------------------------------------------------------ finish
const timelineDoc = (tl: unknown) => JSON.parse(JSON.stringify(tl));

async function maybePurge(projectOid: ObjectId, inp: pl.PipelineInput) {
  if (!(inp.settings.deleteMediaAfterRender && inp.kind === "final")) return;
  const d = await db();
  let n = 0;
  for (const m of await d.collection("media").find({ projectId: projectOid, purged: { $ne: true } }).toArray()) {
    if (m.storedKey) await shared.forget(m.storedKey as string);
    for (const key of [m.storedKey, m.thumbnailKey]) if (key) { try { (await import("node:fs")).rmSync(localPath(key as string), { force: true }); } catch { /* gone */ } }
    await d.collection("media").updateOne({ _id: m._id }, { $set: { purged: true, purgedAt: now() } });
    n++;
  }
  if (n) await d.collection("projects").updateOne({ _id: projectOid }, { $set: { mediaPurgedAt: now() } });
}

async function finish(jobId: ObjectId, projectOid: ObjectId, inp: pl.PipelineInput, result: pl.PipelineResult, renderingId: ObjectId, priorStatus: string, label: string) {
  const d = await db(), t = now();
  if (inp.jobType === "product" || inp.jobType === "story") {
    const r = result.render!;
    await d.collection("renderings").insertOne({ _id: renderingId, projectId: projectOid, jobId, style: inp.settings.productStyle, kind: inp.kind, duration: round(r.duration, 3), width: r.width, height: r.height,
      size: r.size, storedKey: result.outputKey, label, plan: result.productPlan, settings: inp.settings, postCopy: result.postCopy, createdAt: t });
    const update: Record<string, unknown> = { updatedAt: t, error: null, status: priorStatus, productPlan: result.productPlan };
    if (inp.kind === "preview") update.previewRenderingId = renderingId;
    else Object.assign(update, { latestRenderingId: renderingId, status: "completed" });
    await d.collection("projects").updateOne({ _id: projectOid }, { $set: update });
    await maybePurge(projectOid, inp);
    await updateJob(jobId, { status: "completed", progress: 100, stage: "rendering", renderingId, stages: initialStages(inp.jobType).map((s) => ({ ...s, status: "completed", progress: 100 })) });
  } else if (inp.jobType === "render") {
    const proj = (await d.collection("projects").findOne({ _id: projectOid })) ?? ({} as Record<string, unknown>);
    const r = result.render!;
    await d.collection("renderings").insertOne({ _id: renderingId, projectId: projectOid, jobId, style: result.timeline!.style, kind: inp.kind, timelineVersion: proj.timelineVersion ?? 1,
      duration: round(r.duration, 3), width: r.width, height: r.height, size: r.size, storedKey: result.outputKey, label, timeline: timelineDoc(result.timeline), settings: inp.settings,
      postCopy: null, createdAt: t, check: result.renderCheck });
    const update: Record<string, unknown> = { updatedAt: t, error: null, status: priorStatus };
    if (inp.kind === "preview") update.previewRenderingId = renderingId;
    else Object.assign(update, { latestRenderingId: renderingId, status: "completed" });
    await d.collection("projects").updateOne({ _id: projectOid }, { $set: update });
    await maybePurge(projectOid, inp);
    await updateJob(jobId, { status: "completed", progress: 100, stage: "rendering", renderingId, stages: initialStages("render").map((s) => ({ ...s, status: "completed", progress: 100 })) });
  } else if (inp.jobType === "variations" || inp.jobType === "split") {
    const proj = (await d.collection("projects").findOne({ _id: projectOid })) ?? ({} as Record<string, unknown>);
    const ids: ObjectId[] = [];
    for (const v of result.variants) {
      const rid = new ObjectId(v.renderingId);
      ids.push(rid);
      await d.collection("renderings").insertOne({ _id: rid, projectId: projectOid, jobId, style: v.timeline.style, kind: "final", strategy: v.strategyId, timelineVersion: proj.timelineVersion ?? 1,
        duration: round(v.render.duration, 3), width: v.render.width, height: v.render.height, size: v.render.size, storedKey: v.outputKey, label: v.label, timeline: timelineDoc(v.timeline),
        settings: inp.settings, postCopy: null, createdAt: t });
    }
    const update: Record<string, unknown> = { updatedAt: t, error: null, status: priorStatus };
    if (!proj.latestRenderingId && ids.length) Object.assign(update, { latestRenderingId: ids[0], status: "completed" });
    await d.collection("projects").updateOne({ _id: projectOid }, { $set: update });
    await updateJob(jobId, { status: "completed", progress: 100, stage: "rendering", renderingId: ids[0] ?? null, stages: initialStages(inp.jobType, false, inp.settings.ai).map((s) => ({ ...s, status: "completed", progress: 100 })) });
  } else {
    for (const [mid, a] of result.clips) await d.collection("media").updateOne({ _id: new ObjectId(mid) }, { $set: { analysisSummary: clipSummary(a) } });
    for (const [mid, sem] of result.semantics) await d.collection("media").updateOne({ _id: new ObjectId(mid) }, { $set: { semantic: sem, tags: sem.tags, category: sem.scene } });
    const summary: Record<string, unknown> = { clips: [...result.clips.values()].map(clipSummary), usableClips: [...result.clips.values()].filter((a) => a.usable).length, warnings: result.warnings, analyzedAt: t };
    if (result.audio) summary.audio = { bpm: result.audio.bpm, duration: result.audio.duration, beatCount: result.audio.beats.length, beatConfidence: result.audio.beatConfidence,
      highEnergySections: result.audio.highEnergySections, drops: result.audio.drops };
    const update: Record<string, unknown> = { analysis: summary, updatedAt: t, status: priorStatus, error: null };
    const jobFields: Record<string, unknown> = {};
    if (result.timeline && result.render) {
      const r = result.render;
      const proj = (await d.collection("projects").findOne({ _id: projectOid })) ?? ({} as Record<string, unknown>);
      const version = ((proj.timelineVersion as number) ?? 0) + 1, tl = timelineDoc(result.timeline);
      await d.collection("renderings").insertOne({ _id: renderingId, projectId: projectOid, jobId, style: result.timeline.style, kind: "final", duration: round(r.duration, 3), width: r.width,
        height: r.height, size: r.size, storedKey: result.outputKey, label, timeline: tl, settings: inp.settings, postCopy: result.postCopy, createdAt: t, timelineVersion: version });
      if (result.reelPlan) update.reelPlan = { ...result.reelPlan, timelineVersion: version };
      Object.assign(update, { status: "completed", timeline: tl, latestRenderingId: renderingId, timelineVersion: version, timelineHistory: [{ timeline: tl, label: "AI generated", at: t }], historyIndex: 0 });
      jobFields.renderingId = renderingId;
    }
    await d.collection("projects").updateOne({ _id: projectOid }, { $set: update });
    if (result.timeline && result.render) await maybePurge(projectOid, inp);
    const done = initialStages(inp.jobType, inp.settings.captions, inp.settings.ai).map((s) => ({ ...s, status: "completed", progress: 100 }));
    await updateJob(jobId, { status: "completed", progress: 100, stage: done[done.length - 1].name, stages: done, ...jobFields });
  }
  if (["generate", "variations", "split", "render"].includes(inp.jobType) && (result.timeline || result.variants.length)) await recordGeneration(projectOid, jobId, inp, renderingId, result, label);
}

/** One record per generation, for debugging and tuning (never breaks a job). */
async function recordGeneration(projectOid: ObjectId, jobId: ObjectId, inp: pl.PipelineInput, renderingId: ObjectId, result: pl.PipelineResult, label: string) {
  try {
    const tl = result.timeline, plan = (result.reelPlan ?? {}) as Record<string, unknown>, card = (plan.scorecard ?? {}) as Record<string, unknown>;
    const rounds = (plan.selfCorrection as { kept?: boolean }[]) ?? [];
    await (await db()).collection("generations").insertOne({
      _id: new ObjectId(), projectId: projectOid, jobId, type: inp.jobType, kind: inp.kind, label, renderingId, createdAt: now(),
      analysisVersion: { audio: 9, video: 3, semantic: 2 }, ai: tl?.ai ?? null, promptVersion: null, brief: tl?.brief ?? null, creativePlan: tl?.creativePlan ?? null,
      edlVersion: tl?.edlVersion ?? null, shots: tl?.segments.length ?? 0, style: tl?.style ?? null, duration: tl ? round(tl.duration, 2) : null,
      reviewerScore: card.overallScore ?? null, scorecard: Object.keys(card).length ? card : null, correctionIterations: rounds.length, correctionsKept: rounds.filter((r) => r.kept).length,
      output: result.outputKey, variants: result.variants.length ? result.variants.map((v) => ({ strategy: v.strategyId, renderingId: v.renderingId, concept: (v.timeline.creativePlan as { concept?: string } | null)?.concept })) : null,
    });
  } catch (e) {
    console.info("generation not recorded:", e);
  }
}

export async function jobDoc(jobId: string, projectId: string | null = null): Promise<Doc> {
  if (!ObjectId.isValid(jobId)) throw new NotFoundError("Job not found.", { code: "JOB_NOT_FOUND" });
  const q: Record<string, unknown> = { _id: new ObjectId(jobId) };
  if (projectId !== null) q.projectId = (await getProjectDoc(projectId))._id;
  const doc = await (await db()).collection("jobs").findOne(q);
  if (!doc) throw new NotFoundError("Job not found.", { code: "JOB_NOT_FOUND" });
  return doc as Doc;
}
