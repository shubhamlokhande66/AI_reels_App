import "server-only";
import fs from "node:fs";
import path from "node:path";
import { settings } from "@/server/core/config";
import { AppError } from "@/server/core/errors";

/** Files under one root (STORAGE_PATH), addressed by keys like `projects/<id>/input/x.mp4`: the same layout as the Python
 * backend (backend/app/storage/local.py). A key can never point outside the root.
 * With STORAGE_MOUNTED (an R2 bucket mounted through FUSE on Cloudflare), keys with a `temp` folder (render work) live on
 * the local disk instead (SCRATCH_PATH): they are short-lived and written in pieces, which a bucket is slow at. */

const root = settings.storagePath, scratch = settings.scratchPath;
const isScratch = (key: string) => settings.storageMounted && /(^|\/)temp(\/|$)/.test(key.replace(/\\/g, "/"));

export function localPath(key: string): string {
  const clean = key.replace(/^[/\\]+/, ""), base = isScratch(clean) ? scratch : root;
  const p = path.resolve(base, clean);
  if (p !== base && !p.startsWith(base + path.sep)) throw new AppError("Invalid storage key.", { code: "INVALID_STORAGE_KEY" });
  return p;
}

/** Is this file inside the (mounted) bucket, so a writer should work on the local disk and copy it in at the end? */
export const inBucket = (file: string) => settings.storageMounted && path.resolve(file).startsWith(root + path.sep);

export const exists = (key: string) => fs.existsSync(localPath(key));

export function ensureProject(projectId: string) {
  for (const sub of ["input", "output", "analysis"]) fs.mkdirSync(localPath(`projects/${projectId}/${sub}`), { recursive: true });
}

export function deletePrefix(prefix: string) {
  fs.rmSync(localPath(prefix), { recursive: true, force: true });
  if (settings.storageMounted) fs.rmSync(path.resolve(scratch, prefix.replace(/^[/\\]+/, "")), { recursive: true, force: true }); // its temp work too
}

/** Move a file, also between the local disk and the bucket (a rename cannot cross them: copy, then delete). */
export function moveFile(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
}
