import path from "node:path";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import { BEAT_THIS_DIR } from "@/server/audio/beatThis";

/** The files Fast Studio's on-device beat tracker downloads once (then keeps in the browser): the 8-bit Beat This! model
 * and its mel filterbank, the same files the server uses. Cached for a year; the file name changes with the model. */
const FILES: Record<string, string> = { "beat_this_final0.int8.onnx": "application/octet-stream", "mel-filterbank.bin": "application/octet-stream" };

export const GET = route<{ name: string }>(async (req, { name }) => {
  const type = FILES[name];
  if (!type) throw new NotFoundError("No such model file.", { code: "MODEL_NOT_FOUND" });
  return sendFile(req, path.join(BEAT_THIS_DIR, name), type, { cache: "public, max-age=31536000, immutable" });
});
