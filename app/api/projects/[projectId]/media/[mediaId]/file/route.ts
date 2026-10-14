import fs from "node:fs";
import path from "node:path";
import { db, parseId } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import { playableAudio } from "@/server/media/playable";
import { getProjectDoc } from "@/server/projects/service";
import { localPath } from "@/server/storage/local";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
};

/** A clip, photo or song, streamed with seeking; a song in a type the browser plays (server/media/playable.ts). */
export const GET = route<{ projectId: string; mediaId: string }>(async (req, { projectId, mediaId }) => {
  const doc = await getProjectDoc(projectId);
  const media = await (await db()).collection("media").findOne({ _id: parseId(mediaId, "Media"), projectId: doc._id });
  if (!media) throw new NotFoundError("Media not found.", { code: "MEDIA_NOT_FOUND" });
  const file = localPath(media.storedKey);
  if (!fs.existsSync(file)) throw new NotFoundError("Media file is missing from storage.", { code: "MEDIA_FILE_MISSING" });
  if (media.kind === "audio") {
    const [playable, type] = await playableAudio(file);
    return sendFile(req, playable, type, { cache: "private, max-age=3600" });
  }
  return sendFile(req, file, TYPES[path.extname(media.originalName).toLowerCase()] ?? "application/octet-stream", { cache: "private, max-age=3600" });
});

export const HEAD = GET;
