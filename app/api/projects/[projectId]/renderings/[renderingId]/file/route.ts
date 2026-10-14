import fs from "node:fs";
import path from "node:path";
import { db, parseId } from "@/server/core/db";
import { NotFoundError } from "@/server/core/errors";
import { runFfmpeg } from "@/server/core/ffmpeg";
import { route, sendFile } from "@/server/core/http";
import { getProjectDoc } from "@/server/projects/service";
import { localPath } from "@/server/storage/local";

/** The rendered MP4, streamed with seeking. `?download=1` saves it; `?music=false` is the same Reel without sound (the
 * picture copied, no re-encode, made once) to post with a sound added inside Instagram / TikTok. */
export const GET = route<{ projectId: string; renderingId: string }>(async (req, { projectId, renderingId }) => {
  const q = new URL(req.url).searchParams;
  const download = ["1", "true"].includes(q.get("download") ?? "");
  const music = !["0", "false"].includes(q.get("music") ?? "true");
  const doc = await getProjectDoc(projectId);
  const r = await (await db()).collection("renderings").findOne({ _id: parseId(renderingId, "Rendering"), projectId: doc._id });
  if (!r) throw new NotFoundError("Rendering not found.", { code: "RENDERING_NOT_FOUND" });
  let file = localPath(r.storedKey);
  if (!fs.existsSync(file)) throw new NotFoundError("The rendered file is missing from storage.", { code: "RENDERING_FILE_MISSING" });
  let slug = String(doc.name).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "reel";
  if (!music) {
    const silent = path.join(path.dirname(file), `${path.parse(file).name}_nomusic.mp4`);
    if (!fs.existsSync(silent)) await runFfmpeg(["-i", file, "-map", "0:v:0", "-c:v", "copy", "-an", "-movflags", "+faststart", silent], 120_000);
    file = silent;
    slug = `${slug}-no-music`;
  }
  return sendFile(req, file, "video/mp4", { downloadName: download ? `${slug}.mp4` : undefined });
});

export const HEAD = GET;
