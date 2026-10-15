import "server-only";
import fs from "node:fs";
import { z } from "zod";
import { db, ObjectId, parseId } from "@/server/core/db";
import { env, settings } from "@/server/core/config";
import { AppError, NotFoundError, ValidationFailed } from "@/server/core/errors";
import { checkNewMedia, describeMedia, insertMedia, projectKey } from "@/server/media/service";
import { directUploadPath, ensureProject } from "@/server/storage/local";
import { abortMultipart, completeMultipart, deleteObject, downloadObject, partUrls, r2Config, startMultipart } from "@/server/storage/r2";
import { ensureEditable, touchAfterMediaChange } from "./media";
import { getProjectDoc, mediaOut } from "./service";

/** Clips uploaded from the browser straight into R2, in parallel parts (the video never passes through this server):
 * start -> the browser PUTs each part to its presigned URL -> complete (joined, checked, thumbnailed, added to the
 * project). Without R2 settings, start answers { direct: false } and the browser uses the normal upload route. */

const MIN_PART = 8 * 1024 * 1024; // R2/S3: every part but the last at least 5 MiB; at most 10,000 parts
const MAX_PARTS = 10_000;

export const startSchema = z.object({ files: z.array(z.object({ name: z.string().min(1).max(300), size: z.number().int().positive(), type: z.string().max(100).optional() })).min(1).max(100) });
export const completeSchema = z.object({ parts: z.array(z.object({ n: z.number().int().min(1).max(MAX_PARTS), etag: z.string().min(1).max(200) })).min(1).max(MAX_PARTS) });

const pending = async () => (await db()).collection("direct_uploads");

export const partSizeFor = (size: number) => Math.max(MIN_PART, Math.ceil(size / MAX_PARTS / (1024 * 1024)) * 1024 * 1024);

export async function startDirectVideos(projectId: string, files: z.infer<typeof startSchema>["files"]) {
  const c = r2Config();
  if (!c) return { direct: false as const };
  const doc = await getProjectDoc(projectId);
  ensureEditable(doc);
  const limit = Number(env("MAX_VIDEOS_PER_PROJECT", "0")); // 0 = unlimited
  if (limit && (doc.videoOrder ?? []).length + files.length > limit) throw new ValidationFailed(`A project can hold at most ${limit} videos.`, { code: "TOO_MANY_VIDEOS" });
  const pid = String(doc._id), out = [];
  for (const f of files) {
    const { display, ext } = checkNewMedia(f.name, f.size, "video", Number(env("MAX_DIRECT_VIDEO_SIZE_MB", "4096")));
    const mediaId = new ObjectId(), key = projectKey(pid, "input", `${mediaId}${ext}`);
    const uploadId = await startMultipart(c, key);
    const partSize = partSizeFor(f.size), count = Math.ceil(f.size / partSize);
    await (await pending()).insertOne({ _id: mediaId, projectId: doc._id, key, uploadId, name: display, size: f.size, mimeType: f.type || "video/mp4", createdAt: new Date() });
    out.push({ mediaId: String(mediaId), name: f.name, partSize, parts: partUrls(c, key, uploadId, count) });
  }
  return { direct: true as const, files: out };
}

async function pendingUpload(projectId: string, mediaId: string) {
  const doc = await getProjectDoc(projectId);
  const up = await (await pending()).findOne({ _id: parseId(mediaId, "Upload"), projectId: doc._id });
  if (!up) throw new NotFoundError("This upload was not started or is already finished.", { code: "UPLOAD_NOT_FOUND" });
  return { doc, up };
}

/** The parts joined into the clip, which is then checked and added to the project like a normal upload. */
export async function completeDirectVideo(projectId: string, mediaId: string, parts: z.infer<typeof completeSchema>["parts"]) {
  const c = r2Config();
  if (!c) throw new AppError("Direct uploads are not set up on this server.", { code: "DIRECT_UPLOAD_OFF", status: 409 });
  const { doc, up } = await pendingUpload(projectId, mediaId);
  ensureEditable(doc);
  const key = String(up.key), pid = String(doc._id), local = directUploadPath(key);
  await completeMultipart(c, key, String(up.uploadId), parts);
  try {
    // read back once onto this server's disk: checked, thumbnailed, analysed and rendered from there
    const size = await downloadObject(c, key, local);
    if (size !== up.size) throw new ValidationFailed("The clip did not arrive complete. Add it again.", { code: "UPLOAD_INCOMPLETE" });
    ensureProject(pid);
    const { facts, thumbnailKey } = await describeMedia(local, pid, up._id, "video");
    const media = await insertMedia({ _id: up._id, projectId: doc._id, kind: "video", originalName: String(up.name), storedKey: key, thumbnailKey, size, mimeType: String(up.mimeType), facts });
    await (await db()).collection("projects").updateOne({ _id: doc._id }, { $push: { videoOrder: up._id } } as never);
    await touchAfterMediaChange(doc);
    await (await pending()).deleteOne({ _id: up._id });
    if (!settings.storageMounted) await deleteObject(c, key); // the bucket is not this server's storage: the local copy is the clip
    return mediaOut(media as never);
  } catch (e) {
    await fs.promises.rm(local, { force: true });
    await deleteObject(c, key);
    await (await pending()).deleteOne({ _id: up._id });
    throw e;
  }
}

/** A direct upload the browser gave up on: its parts are thrown away. */
export async function cancelDirectVideo(projectId: string, mediaId: string) {
  const c = r2Config();
  const { up } = await pendingUpload(projectId, mediaId);
  if (c) await abortMultipart(c, String(up.key), String(up.uploadId));
  await (await pending()).deleteOne({ _id: up._id });
}
