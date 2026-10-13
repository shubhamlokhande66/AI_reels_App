import fs from "node:fs";
import { route } from "@/server/core/http";
import { extOf, sanitizeFilename } from "@/server/media/service";
import { readUpload } from "@/server/media/upload";
import { addFile, importFolders, listSongs, songOut } from "@/server/songs/service";

/** The song library (watched folders are scanned at most every 30 s). */
export const GET = route(async (req) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const folder = await importFolders();
  return { songs: (await listSongs(q)).map(songOut), folders: folder.folders };
});

/** Songs added to the library (up to 20 at once), each reported on its own. */
export const POST = route(async (req) => {
  const up = await readUpload(req, 1024 * 1024 * 1024, 20);
  const out = [], failed = [];
  try {
    for (const f of up.files.filter((x) => x.field === "files").slice(0, 20)) {
      const named = `${f.tmp}${extOf(sanitizeFilename(f.filename, "song"))}`;
      try {
        fs.renameSync(f.tmp, named);
        out.push(songOut(await addFile(named, f.filename || "song", "upload")));
      } catch (e) {
        failed.push({ name: f.filename, error: String((e as Error).message ?? e).slice(0, 160) });
      }
    }
  } finally {
    up.cleanup();
  }
  return Response.json({ uploaded: out, failed }, { status: 201 });
});
