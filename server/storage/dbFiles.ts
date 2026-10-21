import "server-only";
import fs from "node:fs";
import path from "node:path";
import { Binary } from "mongodb";
import { env } from "@/server/core/config";
import { mainDb } from "@/server/core/db";
import { localPath } from "@/server/storage/local";

/** Small files the app keeps on its own disk (the AI settings, brand logos) on a host whose disk is thrown away (Vercel:
 * each server copy has only a temporary /tmp). A copy of each is kept in the database, put back on the disk when a server
 * starts, and checked for changes made by the other server copies once a minute. The code that reads these files stays as
 * it is (plain files); whoever writes or deletes one calls keepFile / forgetFiles. Off on a host with a lasting disk. */

const KEEP = ["settings/", "brands/"];
const MAX = 8 * 1024 * 1024;
export const filesInDb = () => !!process.env.VERCEL || ["1", "true", "on", "yes"].includes(env("FILES_IN_DB").toLowerCase());
const kept = (key: string) => KEEP.some((p) => key.startsWith(p));

interface FileDoc { _id: string; data: Binary; at: Date; gone?: boolean }
const files = async () => (await mainDb()).collection<FileDoc>("app_files");
let since = new Date(0), timer: ReturnType<typeof setInterval> | null = null;

async function pull() {
  const now = new Date();
  for await (const d of (await files()).find({ at: { $gt: since } })) {
    const f = localPath(d._id);
    if (d.gone) { fs.rmSync(f, { force: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, Buffer.from(d.data.buffer));
  }
  since = new Date(now.getTime() - 5000); // a little overlap: a write that lands while this runs is read next time
}

/** At server start: the kept files back on this server's disk, then a check for changes every minute. */
export async function restoreFiles() {
  if (!filesInDb()) return;
  // at most 8 s: a slow database must not hold the server's start (the minute check catches up)
  try { await Promise.race([pull(), new Promise((_, no) => setTimeout(() => no(new Error("timed out")), 8000))]); }
  catch (e) { console.warn("kept files: could not restore", e); }
  if (!timer) { timer = setInterval(() => { void pull().catch(() => {}); }, 60_000); timer.unref?.(); }
}

/** After writing a kept file: its copy in the database (the other server copies pick it up within a minute). */
export async function keepFile(key: string) {
  if (!filesInDb() || !kept(key)) return;
  try {
    const buf = fs.readFileSync(localPath(key));
    if (buf.length > MAX) return;
    await (await files()).updateOne({ _id: key }, { $set: { data: new Binary(buf), at: new Date() }, $unset: { gone: "" } }, { upsert: true });
  } catch (e) { console.warn("kept files: could not save", key, e); }
}

/** After deleting kept files (one key, or every key under a prefix ending in "/"). */
export async function forgetFiles(keyOrPrefix: string) {
  if (!filesInDb()) return;
  try {
    const col = await files(), at = new Date();
    const q = keyOrPrefix.endsWith("/") ? { _id: { $regex: `^${keyOrPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` } } : { _id: keyOrPrefix };
    await col.updateMany(q, { $set: { gone: true, at, data: new Binary(Buffer.alloc(0)) } });
  } catch (e) { console.warn("kept files: could not forget", keyOrPrefix, e); }
}
