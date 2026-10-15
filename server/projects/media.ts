import "server-only";
import type { Document, ObjectId } from "mongodb";
import { db, parseId } from "@/server/core/db";
import { AppError, ConflictError, NotFoundError, ValidationFailed } from "@/server/core/errors";
import { round } from "@/server/core/py";
import { env, settings } from "@/server/core/config";
import { deleteMediaFiles, failure, saveImage, saveUpload } from "@/server/media/service";
import { readUpload } from "@/server/media/upload";
import { addFromProjectUpload } from "@/server/songs/service";
import { localPath } from "@/server/storage/local";
import fs from "node:fs";
import { currentTimeline, load, replace } from "@/server/timeline/service";
import { getProjectDoc, mediaOut } from "./service";

/** A project's clips, song and photos (was backend/app/api/projects.py + product.py): uploads, order, delete. When
 * media changes the project analysis is stale; the edit is kept (new clips go to its end, a new song plays under it,
 * a deleted clip's shots leave it). */

type Doc = Document & { _id: ObjectId };

export function ensureEditable(doc: Doc) {
  if (doc.status === "processing") throw new ConflictError("The project is being processed; try again when it finishes.", { code: "PROJECT_BUSY" });
}

export async function touchAfterMediaChange(doc: Doc, extra: Record<string, unknown> = {}) {
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { analysis: null, updatedAt: new Date(), ...extra } });
}

/** A new song: the edit plays it from its start, the old song's hand-made beat markers go - one undoable step. */
async function newSongUnderEdit(projectId: string) {
  const doc = await load(projectId);
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $unset: { beatMarkers: "" } });
  const tl = currentTimeline(doc);
  if (tl && doc.timeline) await replace(projectId, { ...tl, audioStart: 0, bpm: 0 }, "New song");
}

/** A deleted clip's shots leave the edit (the others close up), one undoable step; no shots left = no edit. */
async function dropClipFromEdit(projectId: string, clipId: string) {
  const doc = await load(projectId);
  const tl = currentTimeline(doc);
  if (!tl) return;
  const keep = tl.segments.filter((s) => s.clipId !== clipId);
  if (keep.length === tl.segments.length) return;
  if (!keep.length) {
    await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { timeline: null, timelineHistory: [], historyIndex: 0 } });
    return;
  }
  let t = 0;
  const segments = keep.map((s) => {
    const length = s.timelineEnd - s.timelineStart;
    const out = { ...s, timelineStart: round(t, 3), timelineEnd: round(t + length, 3) };
    t += length;
    return out;
  });
  if (doc.timeline) await replace(projectId, { ...tl, segments, duration: round(t, 3) }, "Clip deleted");
}

/** When nothing was saved: the first file's error, with the list of every failure. */
function allFailed(failed: NonNullable<ReturnType<typeof failure>>[], statusFor: (code: string) => number) {
  const first = failed[0].error;
  return new AppError(first.message, { code: first.code, details: failed, status: statusFor(first.code) });
}

export async function uploadVideos(projectId: string, req: Request) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const up = await readUpload(req, settings.maxVideoSizeMb * 1024 * 1024);
  try {
    const files = up.files.filter((f) => f.field === "files");
    if (!files.length) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "files"], msg: "Field required" }] });
    const limit = Number(env("MAX_VIDEOS_PER_PROJECT", "0")); // 0 = unlimited
    if (limit && (doc.videoOrder ?? []).length + files.length > limit) throw new ValidationFailed(`A project can hold at most ${limit} videos.`, { code: "TOO_MANY_VIDEOS" });
    const uploaded = [], failed = [], ids: ObjectId[] = [];
    for (const f of files) {
      try {
        const m = await saveUpload(doc._id, f, "video");
        ids.push(m._id);
        uploaded.push(mediaOut(m as Doc));
      } catch (e) {
        const fail = failure(f, e);
        if (!fail) throw e;
        failed.push(fail);
      }
    }
    if (ids.length) {
      await (await db()).collection("projects").updateOne({ _id: doc._id }, { $push: { videoOrder: { $each: ids } } } as never);
      await touchAfterMediaChange(doc);
    }
    if (!uploaded.length && failed.length) throw allFailed(failed, (c) => (c !== "FILE_TOO_LARGE" ? 415 : 413));
    return { uploaded, failed };
  } finally {
    up.cleanup();
  }
}

/** The project's song, replaced (the previous one is deleted); every song used once joins the library. */
export async function uploadAudio(projectId: string, req: Request) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const up = await readUpload(req, settings.maxAudioSizeMb * 1024 * 1024, 1);
  try {
    const f = up.files.find((x) => x.field === "file");
    if (!f) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "file"], msg: "Field required" }] });
    const media = await replaceProjectAudio(doc, f);
    if (doc.referenceReel?.use_audio) await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { "referenceReel.use_audio": false } });
    return mediaOut(media as Doc);
  } finally {
    up.cleanup();
  }
}

export async function replaceProjectAudio(doc: Doc, f: Parameters<typeof saveUpload>[1], toLibrary = true) {
  const media = await saveUpload(doc._id, f, "audio");
  if (toLibrary) await addFromProjectUpload(media);
  const d = await db();
  if (doc.audioId) {
    const old = await d.collection("media").findOne({ _id: doc.audioId });
    if (old) {
      deleteMediaFiles(old as never);
      await d.collection("media").deleteOne({ _id: old._id });
    }
  }
  await touchAfterMediaChange(doc, { audioId: media._id });
  await newSongUnderEdit(String(doc._id));
  return media;
}

export async function deleteVideo(projectId: string, mediaId: string) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const mid = parseId(mediaId, "Media");
  const d = await db();
  const media = await d.collection("media").findOne({ _id: mid, projectId: doc._id, kind: "video" });
  if (!media) throw new NotFoundError("Video not found.", { code: "MEDIA_NOT_FOUND" });
  deleteMediaFiles(media as never);
  await d.collection("media").deleteOne({ _id: mid });
  await d.collection("projects").updateOne({ _id: doc._id }, { $pull: { videoOrder: mid } } as never);
  await touchAfterMediaChange(doc);
  await dropClipFromEdit(projectId, String(mid));
}

const sameSet = (a: ObjectId[], b: unknown[] = []) => {
  const x = a.map(String).sort(), y = b.map(String).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

export async function reorderVideos(projectId: string, ids: string[]) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const oids = ids.map((i) => parseId(i, "Media"));
  if (!sameSet(oids, doc.videoOrder) || new Set(ids).size !== ids.length) throw new ValidationFailed("The order must list every video of the project exactly once.", { code: "INVALID_ORDER" });
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { videoOrder: oids, updatedAt: new Date() } });
  return getProjectDoc(projectId);
}

export async function uploadImages(projectId: string, req: Request) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const up = await readUpload(req, Number(env("MAX_IMAGE_SIZE_MB", "40")) * 1024 * 1024);
  try {
    const files = up.files.filter((f) => f.field === "files");
    if (!files.length) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "files"], msg: "Field required" }] });
    const limit = Number(env("MAX_IMAGES_PER_PROJECT", "12"));
    if ((doc.imageOrder ?? []).length + files.length > limit) throw new ValidationFailed(`A project can hold at most ${limit} photos.`, { code: "TOO_MANY_IMAGES" });
    const uploaded = [], failed = [], ids: ObjectId[] = [];
    for (const f of files) {
      try {
        const m = await saveImage(doc._id, f);
        ids.push(m._id);
        uploaded.push(mediaOut(m as Doc));
      } catch (e) {
        const fail = failure(f, e);
        if (!fail) throw e;
        failed.push(fail);
      }
    }
    if (ids.length) {
      await (await db()).collection("projects").updateOne({ _id: doc._id }, { $push: { imageOrder: { $each: ids } } } as never);
      await touchAfterMediaChange(doc, { productPlan: null });
    }
    if (!uploaded.length && failed.length) throw allFailed(failed, (c) => (c === "FILE_TOO_LARGE" ? 413 : c === "UNSUPPORTED_MEDIA" ? 415 : 422));
    return { uploaded, failed };
  } finally {
    up.cleanup();
  }
}

export async function deleteImage(projectId: string, mediaId: string) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const mid = parseId(mediaId, "Media");
  const d = await db();
  const media = await d.collection("media").findOne({ _id: mid, projectId: doc._id, kind: "image" });
  if (!media) throw new NotFoundError("Photo not found.", { code: "MEDIA_NOT_FOUND" });
  deleteMediaFiles(media as never);
  fs.rmSync(localPath(`projects/${projectId}/analysis/product_${mediaId}.json`), { force: true });
  await d.collection("media").deleteOne({ _id: mid });
  await d.collection("projects").updateOne({ _id: doc._id }, { $pull: { imageOrder: mid } } as never);
  await touchAfterMediaChange(doc, { productPlan: null });
}

export async function reorderImages(projectId: string, ids: string[]) {
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const oids = ids.map((i) => parseId(i, "Media"));
  if (!sameSet(oids, doc.imageOrder) || new Set(ids).size !== ids.length) throw new ValidationFailed("The order must list every photo of the project exactly once.", { code: "INVALID_ORDER" });
  await (await db()).collection("projects").updateOne({ _id: doc._id }, { $set: { imageOrder: oids, updatedAt: new Date() } });
  return { ids };
}
