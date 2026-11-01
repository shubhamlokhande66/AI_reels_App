import fs from "node:fs";
import path from "node:path";
import { env, settings } from "../core/config";
import { AppError } from "../core/errors";

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

// ------------------------------------------------------------------ local copies of bucket media
/** With a mounted bucket, every read of a clip or song goes over the network (ffmpeg seeks, decodes and hashes it many
 * times). mediaPath() gives a copy on the local disk instead: fetched once, then reused by analysis and every render. */
const cacheRoot = path.join(scratch, "media-cache");
const cacheLimit = () => Number(env("MEDIA_CACHE_GB", "10")) * 1024 ** 3;
const fetching = new Map<string, Promise<string>>();

const cachePath = (key: string) => {
  const p = path.resolve(cacheRoot, key.replace(/^[/\\]+/, ""));
  if (!p.startsWith(cacheRoot + path.sep)) throw new AppError("Invalid storage key.", { code: "INVALID_STORAGE_KEY" });
  return p;
};

/** The file for a stored key, read from the local disk (a cached copy when the key lives in a mounted bucket). */
export async function mediaPath(key: string): Promise<string> {
  const src = localPath(key);
  if (!settings.storageMounted || !inBucket(src)) return src;
  const local = cachePath(key);
  const fresh = await Promise.all([fs.promises.stat(local), fs.promises.stat(src)]).then(([a, b]) => a.size === b.size, () => false);
  if (fresh) {
    const now = new Date();
    fs.promises.utimes(local, now, now).catch(() => {}); // recently used: kept longest
    return local;
  }
  let p = fetching.get(local);
  if (!p) {
    p = (async () => {
      await fs.promises.mkdir(path.dirname(local), { recursive: true });
      const tmp = `${local}.${process.pid}.part`;
      try {
        await fs.promises.copyFile(src, tmp);
        await fs.promises.rename(tmp, local);
      } catch (e) {
        await fs.promises.rm(tmp, { force: true });
        throw e;
      }
      void trimCache();
      return local;
    })().finally(() => fetching.delete(local));
    fetching.set(local, p);
  }
  return p;
}

/** Where a file uploaded straight to the bucket is put on this server: its local copy with a mounted bucket, else its
 * normal place (the bucket is not this server's storage then). */
export const directUploadPath = (key: string) => (settings.storageMounted ? cachePath(key) : localPath(key));

/** At upload time the file is already on the local disk: keep a copy for analysis and renders (no fetch back). */
export async function keepLocalCopy(file: string, key: string) {
  if (!settings.storageMounted || !inBucket(localPath(key))) return;
  const local = cachePath(key);
  await fs.promises.mkdir(path.dirname(local), { recursive: true });
  await fs.promises.copyFile(file, local);
  void trimCache();
}

let trimming = false;
/** The cache stays under MEDIA_CACHE_GB: the least recently used copies go first (the bucket still has them). */
async function trimCache() {
  if (trimming) return;
  trimming = true;
  try {
    const files: { file: string; size: number; used: number }[] = [];
    const walk = async (dir: string) => {
      for (const e of await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) await walk(f);
        else if (!e.name.endsWith(".part")) { const st = await fs.promises.stat(f).catch(() => null); if (st) files.push({ file: f, size: st.size, used: Math.max(st.atimeMs, st.mtimeMs) }); }
      }
    };
    await walk(cacheRoot);
    let total = files.reduce((a, f) => a + f.size, 0);
    for (const f of files.sort((a, b) => a.used - b.used)) {
      if (total <= cacheLimit()) break;
      await fs.promises.rm(f.file, { force: true });
      total -= f.size;
    }
  } finally {
    trimming = false;
  }
}

export function ensureProject(projectId: string) {
  for (const sub of ["input", "output", "analysis"]) fs.mkdirSync(localPath(`projects/${projectId}/${sub}`), { recursive: true });
}

export function deletePrefix(prefix: string) {
  fs.rmSync(localPath(prefix), { recursive: true, force: true });
  if (settings.storageMounted) {
    fs.rmSync(path.resolve(scratch, prefix.replace(/^[/\\]+/, "")), { recursive: true, force: true }); // its temp work too
    fs.rmSync(cachePath(prefix), { recursive: true, force: true }); // and its local media copies
  }
}

/** moveFile without holding up the server: a copy into the mounted bucket goes over the network (seconds to minutes for a
 * video), so it runs on Node's background threads while other requests are answered. Use this for anything large. */
export async function moveFileAsync(from: string, to: string) {
  await fs.promises.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.promises.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    await fs.promises.copyFile(from, to);
    await fs.promises.rm(from, { force: true });
  }
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
