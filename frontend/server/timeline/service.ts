import "server-only";
import type { Document, ObjectId } from "mongodb";
import { db, parseId } from "@/server/core/db";
import { NotFoundError, ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import { ensureIds, parseTimeline, Segment, type Timeline } from "@/server/models/timeline";
import { getProjectDoc, plain } from "@/server/projects/service";
import { record, recordOps } from "@/server/services/feedback";
import { applyOperations, describe, markManual, type Operation, type OpContext } from "./ops";

/** The editable EDL with its undo/redo history (was backend/app/services/timeline_service.py). The history lives on
 * the project (the last HISTORY_LIMIT snapshots); every edit batch is one snapshot, undo/redo move the cursor. */

export const HISTORY_LIMIT = 50;
type Doc = Document & { _id: ObjectId };
type Entry = { timeline: Record<string, unknown>; label: string; at: Date | string };

export async function contextFor(doc: Doc): Promise<OpContext> {
  const clipDurations: Record<string, number> = {};
  const clipNames: Record<string, string> = {};
  let audioDuration: number | null = null;
  for (const m of await (await db()).collection("media").find({ projectId: doc._id }).toArray()) {
    if (m.kind === "video") {
      const d = Number(m.duration || 0) || 0;
      if (d > 0) clipDurations[String(m._id)] = d;
      clipNames[String(m._id)] = m.originalName;
    } else if (doc.audioId && String(m._id) === String(doc.audioId)) {
      audioDuration = Number(m.duration || 0) || null;
    }
  }
  return { clipDurations, clipNames, audioDuration };
}

export function history(doc: Doc): [Entry[], number] {
  const hist = doc.timelineHistory as Entry[] | undefined;
  if (hist?.length) return [[...hist], Math.min(Math.max(Number(doc.historyIndex ?? hist.length - 1), 0), hist.length - 1)];
  if (doc.timeline) return [[{ timeline: ensureIds(doc.timeline), label: "AI generated", at: doc.updatedAt }], 0];
  return [[], 0];
}

/** What the editor gets: the current edit (defaults filled), its version and the history labels. */
export function stateOf(doc: Doc) {
  const [hist, idx] = history(doc);
  const tl = hist.length ? (plain(parseTimeline(ensureIds(hist[idx].timeline as never))) as Record<string, unknown>) : null;
  return {
    timeline: tl,
    version: doc.timelineVersion ?? (tl ? 1 : 0),
    canUndo: idx > 0,
    canRedo: hist.length > 0 && idx < hist.length - 1,
    index: idx,
    history: hist.map((h) => ({ label: h.label ?? "", at: h.at instanceof Date ? h.at.toISOString() : h.at ?? null })),
  };
}
export type TimelineState = ReturnType<typeof stateOf>;

/** The current edit as a model (null without one). */
export function currentTimeline(doc: Doc): Timeline | null {
  const [hist, idx] = history(doc);
  return hist.length ? parseTimeline(ensureIds(hist[idx].timeline as never)) : null;
}

const needsIds = (tl: { segments?: { id?: string }[] } | null | undefined) => Boolean(tl) && (tl!.segments ?? []).some((s) => !s.id);

/** The project, with segment ids persisted for timelines saved before segments had ids. */
export async function load(projectId: string): Promise<Doc> {
  const doc = await getProjectDoc(projectId);
  const hist = (doc.timelineHistory as Entry[] | undefined) ?? [];
  if (needsIds(doc.timeline) || hist.some((h) => needsIds(h.timeline as never))) {
    const update: Record<string, unknown> = {};
    if (doc.timeline) update.timeline = ensureIds(doc.timeline);
    if (hist.length) update.timelineHistory = hist.map((h) => ({ ...h, timeline: ensureIds(h.timeline as never) }));
    await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: update });
    return { ...doc, ...update } as Doc;
  }
  return doc;
}

export const getState = async (projectId: string) => stateOf(await load(projectId));

async function save(doc: Doc, hist: Entry[], idx: number) {
  const update = { timeline: hist[idx].timeline, timelineHistory: hist, historyIndex: idx, updatedAt: new Date(), timelineVersion: (doc.timelineVersion ?? 1) + 1 };
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: update });
  return stateOf({ ...doc, ...update } as Doc);
}

function requireTimeline(doc: Doc) {
  if (!doc.timeline) throw new NotFoundError("This project has no timeline yet. Generate a Reel first.", { code: "NO_TIMELINE" });
}

const entry = (tl: Timeline | Record<string, unknown>, label: string): Entry => ({ timeline: tl as Record<string, unknown>, label, at: new Date() });
const push = (hist: Entry[], idx: number, e: Entry) => [...hist.slice(0, idx + 1), e].slice(-HISTORY_LIMIT);

/** `manual`: a hand edit in the editor - the shots it changes are locked against automatic changes. */
export async function apply(projectId: string, ops: Operation[], label: string | null = null, manual = true) {
  const doc = await load(projectId);
  requireTimeline(doc);
  const [hist, idx] = history(doc);
  const current = parseTimeline(ensureIds(hist[idx].timeline as never));
  const result = applyOperations(current, ops, await contextFor(doc)); // throws EditError: nothing is saved then
  if (manual) markManual(result, ops);
  await recordOps(doc._id, current, ops);
  const h = push(hist, idx, entry(result, label || describe(ops)));
  return save(doc, h, h.length - 1);
}

export async function undo(projectId: string) {
  const doc = await load(projectId);
  requireTimeline(doc);
  const [hist, idx] = history(doc);
  if (idx === 0) throw new ValidationFailed("Nothing to undo.", { code: "NOTHING_TO_UNDO" });
  return save(doc, hist, idx - 1);
}

export async function redo(projectId: string) {
  const doc = await load(projectId);
  requireTimeline(doc);
  const [hist, idx] = history(doc);
  if (idx >= hist.length - 1) throw new ValidationFailed("Nothing to redo.", { code: "NOTHING_TO_REDO" });
  return save(doc, hist, idx + 1);
}

/** Make the timeline a previous render was made from the current one (a new, undoable edit). */
export async function restoreVersion(projectId: string, renderingId: string) {
  const doc = await load(projectId);
  const d = await db();
  const r = await d.collection("renderings").findOne({ _id: parseId(renderingId, "Rendering"), projectId: doc._id });
  if (!r?.timeline) throw new NotFoundError("That version is not available.", { code: "RENDERING_NOT_FOUND" });
  const [hist, idx] = history(doc);
  const h = push(hist, idx, entry(ensureIds(r.timeline), `Restored ${r.label || "version"}`));
  await d.collection("projects").updateOne({ _id: doc._id }, { $set: { latestRenderingId: r._id } });
  const concept = r.timeline?.creativePlan?.direction;
  if (["viral", "cinematic", "premium"].includes(concept)) await record(doc._id, "chose_concept", { concept });
  return save(doc, h, h.length - 1);
}

/** The manual editor's start: every clip once, in order (a few seconds from its best moment), the song from its start.
 * A project that already has an edit opens it as it is (`fresh` starts over, as one undoable step). */
export async function startManual(projectId: string, fresh = false, secondsPerClip = 3) {
  const doc = await load(projectId);
  if (doc.timeline && !fresh) return stateOf(doc);
  const ctx = await contextFor(doc);
  const order = ((doc.videoOrder ?? []) as unknown[]).map(String).filter((i) => i in ctx.clipDurations);
  if (!order.length) throw new NotFoundError("Add your clips first.", { code: "NO_VIDEOS" });
  const d = await db();
  const best: Record<string, number> = {};
  for (const m of await d.collection("media").find({ projectId: doc._id, kind: "video" }).toArray()) {
    const segs = m.analysis?.bestSegments ?? [];
    if (segs.length) best[String(m._id)] = Number(segs[0].start ?? 0);
  }
  const segments: Segment[] = [];
  let t = 0;
  for (const cid of order) {
    const dur = ctx.clipDurations[cid];
    const length = Math.min(secondsPerClip, dur);
    const start = Math.min(best[cid] ?? 0, Math.max(dur - length, 0));
    segments.push(Segment.parse({ clipId: cid, video: ctx.clipNames[cid] ?? "clip", sourceStart: round(start, 3), sourceEnd: round(start + length, 3), timelineStart: round(t, 3), timelineEnd: round(t + length, 3) }));
    t += length;
  }
  let bpm = 0;
  if (doc.audioId) bpm = Number((await d.collection("media").findOne({ _id: doc.audioId }))?.analysis?.bpm ?? 0);
  const tl = parseTimeline({ duration: round(t, 3), bpm, audioStart: 0, style: "custom", segments, notes: ["Built by hand in the editor."] });
  const [hist, idx] = history(doc);
  const h = push(hist, idx, entry(tl, "Start editing"));
  return save(doc, h, h.length - 1);
}

/** Make `timeline` the current edit (a whole-edit change such as a new style or pace), as one undoable step. */
export async function replace(projectId: string, timeline: Timeline, label: string) {
  const doc = await load(projectId);
  requireTimeline(doc);
  const [hist, idx] = history(doc);
  const h = push(hist, idx, entry(timeline, label));
  return save(doc, h, h.length - 1);
}
