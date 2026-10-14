import fs from "node:fs";
import path from "node:path";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import { playableAudio } from "@/server/media/playable";
import { getSong } from "@/server/songs/service";
import { localPath } from "@/server/storage/local";

/** A library song, in a type the browser plays, with seeking. */
export const GET = route<{ songId: string }>(async (req, { songId }) => {
  const doc = await getSong(songId);
  const file = localPath(doc.fileKey);
  if (!fs.existsSync(file)) throw new NotFoundError("The song file is missing from storage.", { code: "SONG_FILE_MISSING" });
  const [playable, type] = await playableAudio(file);
  return sendFile(req, playable, type, { downloadName: `${doc.name}${path.extname(file)}` });
});
