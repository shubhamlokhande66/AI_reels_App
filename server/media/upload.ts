import "server-only";
import Busboy from "busboy";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { env, settings } from "@/server/core/config";
import { AppError, PayloadTooLarge, ValidationFailed } from "@/server/core/errors";

/** A multipart upload read as a stream (busboy): each file goes to its own temporary file as it arrives, so a 500 MB
 * video is never held in memory. The caller moves the files where they belong; `cleanup` removes what is left. */

export interface UploadedFile {
  field: string;
  filename: string;
  mimeType: string;
  tmp: string;
  size: number;
  tooLarge: boolean;
}

export interface Upload {
  files: UploadedFile[];
  fields: Record<string, string>;
  cleanup: () => void;
}

const minFree = () => Number(env("MIN_FREE_DISK_MB", "1024")) * 1024 * 1024;

export function freeBytes(dir: string): number {
  try {
    const s = fs.statfsSync(dir);
    return s.bavail * s.bsize;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** The request's files, up to `maxBytes` each (a bigger one is cut off there and marked tooLarge). */
export async function readUpload(req: Request, maxBytes: number, maxFiles = 100): Promise<Upload> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("multipart/form-data") || !req.body) throw new ValidationFailed("Request validation failed.", { details: [{ loc: ["body", "files"], msg: "Field required" }] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "reel-upload-"));
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const bb = Busboy({ headers: { "content-type": type }, limits: { files: maxFiles, fileSize: maxBytes } });
      const writes: Promise<void>[] = [];
      bb.on("file", (field, stream, info) => {
        const f: UploadedFile = { field, filename: info.filename ?? "", mimeType: info.mimeType || "application/octet-stream", tmp: path.join(dir, String(files.length)), size: 0, tooLarge: false };
        files.push(f);
        const out = fs.createWriteStream(f.tmp);
        stream.on("data", (chunk: Buffer) => {
          f.size += chunk.length;
          if (f.size % (32 * 1024 * 1024) < chunk.length && freeBytes(settings.storagePath) - f.size < minFree()) {
            stream.destroy(new AppError("Not enough free disk space to store this upload.", { code: "INSUFFICIENT_DISK_SPACE", status: 507 }));
          }
        });
        stream.on("limit", () => {
          f.tooLarge = true;
        });
        writes.push(new Promise((ok, bad) => {
          out.on("finish", ok);
          out.on("error", bad);
          stream.on("error", bad);
        }));
        stream.pipe(out);
      });
      bb.on("field", (name, value) => {
        fields[name] = value;
      });
      bb.on("error", reject);
      bb.on("close", () => Promise.all(writes).then(() => resolve(), reject));
      Readable.fromWeb(req.body as never).on("error", reject).pipe(bb);
    });
  } catch (e) {
    cleanup();
    throw e;
  }
  return { files, fields, cleanup };
}

export const tooLarge = (maxBytes: number) => new PayloadTooLarge(`File exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB limit.`, { details: { maxBytes } });
