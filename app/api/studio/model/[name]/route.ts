import path from "node:path";
import { NotFoundError } from "@/server/core/errors";
import { route, sendFile } from "@/server/core/http";
import { BEAT_THIS_DIR } from "@/server/audio/beatThis";

/** The model files Fast Studio downloads once (then keeps in the browser): the 8-bit Beat This! beat tracker and its mel
 * filterbank (the same files the server uses), and Silero VAD (speech detection, MIT). Cached for a year; the file name
 * changes with the model. */
const VAD_DIR = path.join(process.cwd(), "server", "audio", "data", "vad");
const FILES: Record<string, [string, string]> = {
  "beat_this_final0.int8.onnx": [BEAT_THIS_DIR, "application/octet-stream"],
  "mel-filterbank.bin": [BEAT_THIS_DIR, "application/octet-stream"],
  "silero_vad_16k_op15.onnx": [VAD_DIR, "application/octet-stream"],
};

export const GET = route<{ name: string }>(async (req, { name }) => {
  const file = FILES[name];
  if (!file) throw new NotFoundError("No such model file.", { code: "MODEL_NOT_FOUND" });
  return sendFile(req, path.join(file[0], name), file[1], { cache: "public, max-age=31536000, immutable" });
});
