import path from "node:path";
import { NotFoundError } from "../../../../server/core/errors";
import { route, sendFile } from "../../../../server/core/http";

/** The face models the browser's clip analysis loads (the server's own files: server/video/data), cached for a year. */
const MODELS = new Set(["haarcascade_frontalface_default.xml", "haarcascade_profileface.xml"]);

export const GET = route<{ name: string }>(async (req, { name }) => {
  if (!MODELS.has(name)) throw new NotFoundError("Model not found.", { code: "NOT_FOUND" });
  return sendFile(req, path.join(process.cwd(), "src", "server", "video", "data", name), "application/xml", { cache: "public, max-age=31536000, immutable" });
});
