import path from "node:path";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import MODEL_FILES from "@/server/studio/model-files.json";

/** The model files Fast Studio downloads once (then keeps in the browser): the 8-bit Beat This! beat tracker and its mel
 * filterbank (the same files the server uses), Silero VAD (speech detection, MIT), MediaPipe selfie segmentation and BlazeFace (Apache-2.0). Cached for a year; the file name
 * changes with the model. */
// the list is shared with scripts/cf-assets.mjs, which puts the same files on Cloudflare's static assets (free, and the
// app's container is not woken for them); this route serves them everywhere else (and on Cloudflare if one is missing)
const FILES = new Map(MODEL_FILES.files.map((f) => [f.name, path.join(process.cwd(), f.dir)]));

export const GET = route<{ name: string }>(async (req, { name }) => {
  const file = FILES.get(name);
  if (!file) throw new NotFoundError("No such model file.", { code: "MODEL_NOT_FOUND" });
  return sendFile(req, path.join(file, name), "application/octet-stream", { cache: "public, max-age=31536000, immutable" });
});
