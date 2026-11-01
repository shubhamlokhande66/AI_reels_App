import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db, ObjectId } from "../core/db";
import { env, settings } from "../core/config";
import { AppError, UnsupportedMedia, ValidationFailed } from "../core/errors";
import { probe, runFfmpeg } from "../core/ffmpeg";
import { ensureProject, keepLocalCopy, localPath, moveFileAsync } from "../storage/local";
import { audioFacts, videoFacts } from "./probe";
import { tooLarge, type UploadedFile } from "./upload";

/** Upload handling: checks, the file in its place, probing, thumbnails (was backend/app/services/media_service.py). */

export const VIDEO_EXTS = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];
export const AUDIO_EXTS = [".mp3", ".mpeg", ".mpga", ".mp2", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".amr", ".wma", ".aif", ".aiff", ".caf", ".weba"];
export const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff"];
export const MIN_IMAGE_SIDE = 400;

const UNSAFE = /[^\p{L}\p{N}_.\- ()[\]]+/gu;

/** A display-only name: no folders, no odd characters, bounded (files are stored under generated ids). */
export function sanitizeFilename(name: string | null | undefined, fallback = "upload"): string {
  const base = (name ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  let stem = dot >= 0 ? base.slice(0, dot) : base;
  let ext = dot >= 0 ? base.slice(dot + 1) : "";
  stem = stem.replace(UNSAFE, "_").replace(/^[ ._]+|[ ._]+$/g, "") || fallback;
  ext = ext.replace(UNSAFE, "").slice(0, 8);
  stem = stem.slice(0, 100);
  return ext ? `${stem}.${ext.toLowerCase()}` : stem;
}

export const extOf = (name: string) => {
  const b = path.basename(name);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i).toLowerCase() : "";
};

export const projectKey = (projectId: string, folder: string, name: string) => `projects/${projectId}/${folder}/${name}`;

/** The upload moved to its key. Into a mounted bucket this is a network copy, so it never holds up other requests. */
async function place(tmp: string, key: string) {
  const dest = localPath(key);
  await moveFileAsync(tmp, dest);
  return dest;
}

export async function makeThumbnail(src: string, dest: string, at: number): Promise<boolean> {
  try {
    await runFfmpeg(["-ss", at.toFixed(3), "-i", src, "-frames:v", "1", "-vf", "scale=360:-2:force_original_aspect_ratio=decrease", "-q:v", "4", dest], 60_000);
    return fs.existsSync(dest);
  } catch (e) {
    console.warn("thumbnail failed:", e instanceof AppError ? e.details ?? e.message : e);
    return false;
  }
}

/** A clip or a song saved to the project (the upload's temporary file is moved into storage). */
export async function saveUpload(projectId: ObjectId, f: UploadedFile, kind: "video" | "audio") {
  if (f.tooLarge) checkNewMedia(f.filename, Infinity, kind); // the type error first, as before, then the size one
  const { display, ext } = checkNewMedia(f.filename, f.size, kind);
  const mediaId = new ObjectId();
  const pid = String(projectId);
  ensureProject(pid);
  const key = projectKey(pid, "input", `${mediaId}${ext}`);
  // checked and thumbnailed from the local upload (not read back from the bucket), and only then stored
  const { facts, thumbnailKey } = await describeMedia(f.tmp, pid, mediaId, kind);
  await keepLocalCopy(f.tmp, key); // analysis and renders read it from here, not back from the bucket
  await place(f.tmp, key);
  return insertMedia({ _id: mediaId, projectId, kind, originalName: display, storedKey: key, thumbnailKey, size: f.size, mimeType: f.mimeType, facts });
}

/** A clip's or song's facts (duration, size, fps...) and, for a clip, its thumbnail; read from a file on the local disk. */
export async function describeMedia(file: string, pid: string, mediaId: ObjectId, kind: "video" | "audio") {
  const facts = await probe(file).then((info) => (kind === "video" ? videoFacts(info) : audioFacts(info)));
  let thumbnailKey: string | null = null;
  if (kind === "video") {
    const tk = projectKey(pid, "analysis", `thumb_${mediaId}.jpg`);
    thumbnailKey = (await makeThumbnail(file, localPath(tk), Math.min(facts.duration / 2, 1))) ? tk : null;
  }
  return { facts, thumbnailKey };
}

export async function insertMedia(m: {
  _id: ObjectId; projectId: ObjectId; kind: "video" | "audio"; originalName: string; storedKey: string; thumbnailKey: string | null; size: number;
  mimeType: string; facts: Record<string, number>;
}) {
  const { facts, ...rest } = m;
  const doc = { ...rest, mimeType: m.mimeType || "application/octet-stream", ...facts, createdAt: new Date() };
  await (await db()).collection("media").insertOne(doc);
  return doc;
}

/** The checks every new clip or song passes before anything is stored: a known type, not empty, not too large
 * (`maxMb`: a direct upload's own limit; it does not pass through the Worker's request size cap). */
export function checkNewMedia(filename: string, size: number, kind: "video" | "audio", maxMb?: number) {
  const display = sanitizeFilename(filename, kind === "video" ? "video" : "audio");
  const ext = extOf(display);
  const allowed = kind === "video" ? VIDEO_EXTS : AUDIO_EXTS;
  if (!allowed.includes(ext)) throw new UnsupportedMedia(`Unsupported ${kind} type '${ext || "unknown"}'.`, { details: { allowed: [...allowed].sort() } });
  const maxBytes = (maxMb ?? (kind === "video" ? settings.maxVideoSizeMb : settings.maxAudioSizeMb)) * 1024 * 1024;
  if (size > maxBytes) throw tooLarge(maxBytes);
  if (size <= 0) throw new ValidationFailed("The uploaded file is empty.", { code: "EMPTY_FILE" });
  return { display, ext };
}

/** A product photo: checked by really decoding it (turned upright from its camera data), with a small thumbnail. */
export async function saveImage(projectId: ObjectId, f: UploadedFile) {
  const display = sanitizeFilename(f.filename, "photo");
  const ext = extOf(display);
  if (ext === ".heic" || ext === ".heif") {
    throw new UnsupportedMedia("HEIC photos are not supported yet. Share or export the photo as JPG (on an iPhone: Settings > Camera > Formats > Most Compatible).", { details: { allowed: [...IMAGE_EXTS].sort() } });
  }
  if (!IMAGE_EXTS.includes(ext)) throw new UnsupportedMedia(`Unsupported photo type '${ext || "unknown"}'.`, { details: { allowed: [...IMAGE_EXTS].sort() } });
  const maxBytes = Number(env("MAX_IMAGE_SIZE_MB", "40")) * 1024 * 1024;
  if (f.tooLarge) throw tooLarge(maxBytes);
  if (f.size === 0) throw new ValidationFailed("The uploaded file is empty.", { code: "EMPTY_FILE" });
  let w = 0, h = 0;
  try {
    const meta = await sharp(f.tmp).metadata();
    const turned = (meta.orientation ?? 1) >= 5; // EXIF 5-8: the picture is stored on its side
    w = (turned ? meta.height : meta.width) ?? 0;
    h = (turned ? meta.width : meta.height) ?? 0;
  } catch {
    w = h = 0;
  }
  if (w < 16 || h < 16) throw new AppError("The image could not be read (or is too small to use).", { code: "CORRUPTED_IMAGE" });
  if (Math.min(w, h) < MIN_IMAGE_SIDE) {
    throw new ValidationFailed(`The photo is only ${w}x${h}. Use one with at least ${MIN_IMAGE_SIDE} pixels on its shortest side so close-ups stay sharp.`, { code: "IMAGE_TOO_SMALL" });
  }
  const mediaId = new ObjectId();
  const pid = String(projectId);
  ensureProject(pid);
  const key = projectKey(pid, "input", `${mediaId}${ext}`);
  const thumbKey = projectKey(pid, "analysis", `thumb_${mediaId}.jpg`);
  await sharp(f.tmp).rotate().resize(360, 360, { fit: "inside" }).jpeg({ quality: 82 }).toFile(localPath(thumbKey));
  await place(f.tmp, key);
  const doc = {
    _id: mediaId, projectId, kind: "image", originalName: display, storedKey: key, thumbnailKey: thumbKey, size: f.size,
    mimeType: f.mimeType || "image/jpeg", width: w, height: h, duration: null, createdAt: new Date(),
  };
  await (await db()).collection("media").insertOne(doc);
  return doc;
}

export function deleteMediaFiles(doc: { storedKey: string; thumbnailKey?: string | null }) {
  fs.rmSync(localPath(doc.storedKey), { force: true });
  if (doc.thumbnailKey) fs.rmSync(localPath(doc.thumbnailKey), { force: true });
}

/** An upload's per-file failure, as the API reports it. */
export const failure = (f: UploadedFile, e: unknown) =>
  e instanceof AppError ? { name: sanitizeFilename(f.filename), error: { code: e.code, message: e.message, details: e.details ?? null } } : null;
