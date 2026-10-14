import fs from "node:fs";
import { db, parseId } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { localPath } from "@/server/storage/local";

export const GET = route<{ projectId: string; mediaId: string }>(async (req, { projectId, mediaId }) => {
  const doc = await getProjectDoc(projectId);
  const media = await (await db()).collection("media").findOne({ _id: parseId(mediaId, "Media"), projectId: doc._id });
  if (!media?.thumbnailKey) throw new NotFoundError("Thumbnail not found.", { code: "THUMBNAIL_NOT_FOUND" });
  const file = localPath(media.thumbnailKey);
  if (!fs.existsSync(file)) throw new NotFoundError("Thumbnail not found.", { code: "THUMBNAIL_NOT_FOUND" });
  return sendFile(req, file, "image/jpeg", { cache: "public, max-age=3600" });
});
