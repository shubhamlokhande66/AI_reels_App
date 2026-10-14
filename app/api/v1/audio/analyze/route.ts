import fs from "node:fs";
import path from "node:path";
import { analyzeToJson, videoShape } from "@/server/audio/analysisJson";
import { ValidationFailed } from "@/server/core/errors";
import { route } from "@/server/core/http";
import { readUpload } from "@/server/media/upload";
import { projectSong, songDocument } from "@/server/services/music";

const MAX_UPLOAD_MB = 200;

/** A song analysed (Essentia beats) as audio_analysis.json schema 1.0: tempo, beats with bar starts, energy curve,
 * labelled sections, candidate events. Send project_id (the project's song, analysed once) or a file. onsets=true adds
 * every attack; full=true returns the whole internal document. */
export const POST = route(async (req) => {
  const up = await readUpload(req, MAX_UPLOAD_MB * 1024 * 1024, 1);
  try {
    const flag = (k: string) => ["1", "true", "yes", "on"].includes((up.fields[k] ?? "").toLowerCase());
    const shape = (doc: Parameters<typeof videoShape>[0]) => (flag("full") ? doc : videoShape(doc, flag("onsets")));
    const file = up.files.find((f) => f.field === "file");
    if (file) {
      if (file.tooLarge) throw new ValidationFailed(`The file is larger than ${MAX_UPLOAD_MB} MB.`, { code: "FILE_TOO_LARGE" });
      const named = `${file.tmp}${(path.extname(file.filename || "song") || ".audio").slice(0, 8)}`;
      fs.renameSync(file.tmp, named);
      return shape(await analyzeToJson(named, 10));
    }
    const projectId = up.fields.project_id;
    if (!projectId) throw new ValidationFailed("Send project_id or a file.", { code: "NO_INPUT" });
    return shape(await songDocument((await projectSong(projectId)).audio.key, 10));
  } finally {
    up.cleanup();
  }
});
