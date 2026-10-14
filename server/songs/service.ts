import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Document } from "mongodb";
import { env } from "@/server/core/config";
import { db, ObjectId } from "@/server/core/db";
import { NotFoundError, UnsupportedMedia } from "@/server/core/errors";
import { probe } from "@/server/core/ffmpeg";
import { AUDIO_EXTS, extOf, sanitizeFilename } from "@/server/media/service";
import { audioFacts } from "@/server/media/probe";
import { localPath } from "@/server/storage/local";

/** The song library (was backend/app/services/songs.py): every song used once is kept, stored once by content hash;
 * audio files in SONG_IMPORT_FOLDERS (e.g. Downloads) are imported automatically. */

const FOLDER_SCAN_EVERY = 30;
const g = globalThis as unknown as { __songScan?: number };

const sha1 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = crypto.createHash("sha1");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d ?? null);

export function songOut(d: Document) {
  return {
    id: String(d._id), name: d.name, artist: d.artist || null, duration: d.duration ?? null, size: d.size ?? null, source: d.source ?? "upload",
    license: d.license || null, licenseUrl: d.licenseUrl || null, shareUrl: d.shareUrl || null, image: d.image || null,
    url: `/api/songs/${d._id}/file`, createdAt: iso(d.createdAt), lastUsedAt: iso(d.lastUsedAt), useCount: d.useCount ?? 0,
  };
}

/** Add `src` to the library (copied; the original is untouched). An identical song already there is returned. */
export async function addFile(src: string, name: string, source: string, meta: Record<string, unknown> = {}): Promise<Document> {
  const ext = extOf(src);
  if (!AUDIO_EXTS.includes(ext)) throw new UnsupportedMedia(`Unsupported audio type '${ext || "unknown"}'.`, { details: { allowed: [...AUDIO_EXTS].sort() } });
  const digest = await sha1(src);
  const d = await db();
  const existing = await d.collection("songs").findOne({ sha1: digest });
  if (existing) {
    if (meta.folderPath && !existing.folderPath) await d.collection("songs").updateOne({ _id: existing._id }, { $set: { folderPath: meta.folderPath } });
    return existing;
  }
  const facts = audioFacts(await probe(src));
  const songId = new ObjectId();
  const key = `songs/${songId}${ext}`;
  fs.mkdirSync(path.dirname(localPath(key)), { recursive: true });
  fs.copyFileSync(src, localPath(key));
  const doc = {
    _id: songId, name: sanitizeFilename(name, "song").split(".").slice(0, -1).join(".").slice(0, 120) || sanitizeFilename(name, "song").slice(0, 120),
    source, fileKey: key, size: fs.statSync(src).size, sha1: digest, createdAt: new Date(), lastUsedAt: null, useCount: 0, ...facts,
    ...Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== null && v !== undefined && v !== "")),
  };
  await d.collection("songs").insertOne(doc);
  return doc;
}

/** A song uploaded to a Reel joins the library (never fails the upload). */
export async function addFromProjectUpload(media: Document) {
  try {
    const doc = await addFile(localPath(media.storedKey), media.originalName || "song", "upload");
    await (await db()).collection("songs").updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() }, $inc: { useCount: 1 } });
  } catch (e) {
    console.warn("could not add the uploaded song to the library:", e);
  }
}

export function watchedFolders(): string[] {
  return env("SONG_IMPORT_FOLDERS").split(";").map((p) => p.trim()).filter(Boolean)
    .map((p) => p.replace(/^~(?=$|[\\/])/, os.homedir()).replace(/%([^%]+)%|\$\{?([A-Za-z_]\w*)\}?/g, (m, a, b) => process.env[a ?? b] ?? m));
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/** New audio files from the watched folders (at most every FOLDER_SCAN_EVERY s unless forced). */
export async function importFolders(force = false) {
  const folders = watchedFolders();
  const now = Date.now() / 1000;
  if (!folders.length || (!force && now - (g.__songScan ?? 0) < FOLDER_SCAN_EVERY)) return { folders, added: 0, scanned: false };
  g.__songScan = now;
  const d = await db();
  const known = new Set<string>([
    ...(await d.collection("songs").find({ folderPath: { $exists: true } }, { projection: { folderPath: 1 } }).toArray()).map((x) => x.folderPath),
    ...(await d.collection("song_ignored").find({}, { projection: { _id: 1 } }).toArray()).map((x) => String(x._id)),
  ]);
  let added = 0;
  const errors: string[] = [];
  for (const folder of folders) {
    if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
      errors.push(`${folder} does not exist`);
      continue;
    }
    for (const f of walk(folder)) {
      if (!AUDIO_EXTS.includes(extOf(f)) || known.has(f) || fs.statSync(f).size < 50_000) continue;
      try {
        const before = await d.collection("songs").countDocuments({});
        await addFile(f, path.basename(f), "folder", { folderPath: f });
        if ((await d.collection("songs").countDocuments({})) > before) added++;
      } catch (e) {
        errors.push(`${path.basename(f)}: ${String((e as Error).message ?? e).slice(0, 80)}`);
      }
    }
  }
  return { folders, added, scanned: true, errors: errors.slice(0, 10) };
}

export async function listSongs(q = "") {
  const query = q.trim()
    ? { $or: [{ name: { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { artist: { $regex: q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }] }
    : {};
  const docs = await (await db()).collection("songs").find(query).toArray();
  return docs.sort((a, b) => +(b.lastUsedAt || b.createdAt) - +(a.lastUsedAt || a.createdAt));
}

export async function getSong(songId: string) {
  if (!/^[0-9a-f]{24}$/.test(songId)) throw new NotFoundError("Song not found.", { code: "SONG_NOT_FOUND" });
  const doc = await (await db()).collection("songs").findOne({ _id: new ObjectId(songId) });
  if (!doc) throw new NotFoundError("Song not found.", { code: "SONG_NOT_FOUND" });
  return doc;
}

export async function deleteSong(songId: string) {
  const doc = await getSong(songId);
  fs.rmSync(localPath(doc.fileKey), { force: true });
  const d = await db();
  if (doc.folderPath) await d.collection("song_ignored").updateOne({ _id: doc.folderPath }, { $set: { at: new Date() } }, { upsert: true }); // stays deleted
  await d.collection("songs").deleteOne({ _id: doc._id });
}

export async function markUsed(songId: string) {
  const doc = await getSong(songId);
  await (await db()).collection("songs").updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() }, $inc: { useCount: 1 } });
}
