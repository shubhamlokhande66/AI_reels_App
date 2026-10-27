import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { currentUser } from "@/server/core/auth";
import { isAdminUser } from "@/server/core/admin";
import { db, mainDb, ObjectId, OWNER, parseId } from "@/server/core/db";
import { AppError, NotFoundError, ValidationFailed } from "@/server/core/errors";
import { sendFile } from "@/server/core/http";
import { enabled as creditsOn, wallet } from "@/server/credits";
import { localPath } from "@/server/storage/local";
import { abortMultipart, completeMultipart, deleteObject, objectSize, objectUrl, partSizeFor, partUrls, r2Config, startMultipart } from "@/server/storage/r2";

/**
 * My Reels: the finished Reels a person chose to keep in their account ("Export & save" in Fast Studio). Everything else
 * (song, clips, the edit, drafts) stays on their phone. The MP4 goes from the phone straight into R2 in parts through
 * presigned links, and is played and downloaded straight from R2 too, so no video passes through this server. Without R2
 * (a local install) the file is kept in this server's storage folder. Kept until deleted, up to a number per plan.
 */

export const LIMITS: Record<string, number> = { free: 10, creator: 100, pro: 500, business: 2000 };
const MAX_BYTES = 2 * 1024 ** 3; // a 4K minute is a few hundred MB; 2 GB is far above any Reel
const STALE_MS = 24 * 3600 * 1000; // an upload not finished within a day is dropped

export const StartIn = z.object({
  name: z.string().trim().min(1).max(120),
  size: z.number().int().positive().max(MAX_BYTES),
  type: z.enum(["video/mp4", "video/webm"]),
  dur: z.number().min(0).max(1800),
  width: z.number().int().min(16).max(4096),
  height: z.number().int().min(16).max(4096),
  fps: z.number().int().min(1).max(120),
  thumb: z.string().max(80_000).regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/).optional(),
});
export const CompleteIn = z.object({ parts: z.array(z.object({ n: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) })).max(10_000).default([]) });

type ReelDoc = {
  _id: ObjectId; name: string; size: number; type: string; dur: number; width: number; height: number; fps: number; thumb?: string;
  key: string; uploadId?: string; status: "uploading" | "ready"; shareToken?: string; createdAt: Date;
};

const reels = async () => (await db()).collection<ReelDoc>("studio_reels");

/** an account's plan for My Reels (the administrator: the top plan, everything open) */
async function planFor(uid: string): Promise<string> {
  if (!uid || !creditsOn()) return "free";
  if (await isAdminUser(uid)) return "business";
  return String((await wallet(uid)).plan ?? "free");
}
const planOf = async () => planFor(currentUser() ?? "");

/* ---- how long a saved Reel is kept, per plan (Admin → Settings → My Reels; 0 = until deleted, the default) ----
 * Keeps R2 inside its free 10 GB. There is no scheduler (the container sleeps): old Reels are removed when someone opens
 * My Reels or saves a Reel, at most once every 6 hours per server, across all users (each by their own plan). */
export const KEEP_PLANS = ["free", "creator", "pro", "business"] as const;
export type KeepDays = Record<(typeof KEEP_PLANS)[number], number>;
const KEEP_ID = "reels_keep" as unknown as ObjectId;
export const KeepIn = z.object(Object.fromEntries(KEEP_PLANS.map((p) => [p, z.number().int().min(0).max(3650)])) as Record<(typeof KEEP_PLANS)[number], z.ZodNumber>);
export async function keepDays(): Promise<KeepDays> {
  const d = (await (await mainDb()).collection("app_settings").findOne({ _id: KEEP_ID })) as { days?: Partial<KeepDays> } | null;
  return Object.fromEntries(KEEP_PLANS.map((p) => [p, Number(d?.days?.[p] ?? 0)])) as KeepDays;
}
export async function setKeepDays(days: KeepDays) {
  await (await mainDb()).collection("app_settings").updateOne({ _id: KEEP_ID }, { $set: { days, updatedAt: new Date() } }, { upsert: true });
  lastSweep = 0; // the new rule is applied at the next look
  return keepDays();
}
let lastSweep = 0;
const SWEEP_EVERY = 6 * 3600 * 1000;
/** Reels older than their owner's plan keeps: deleted (the file in R2 or on disk, then the entry). Returns how many. */
export async function sweepOld(now = Date.now()) {
  if (now - lastSweep < SWEEP_EVERY) return 0;
  lastSweep = now;
  const keep = await keepDays(), shortest = Math.min(...Object.values(keep).filter((d) => d > 0));
  if (!Number.isFinite(shortest)) return 0;
  const all = (await mainDb()).collection<ReelDoc & { [OWNER]?: string }>("studio_reels"), c = r2Config(), plans = new Map<string, string>();
  let n = 0;
  for (const d of await all.find({ status: "ready", createdAt: { $lt: new Date(now - shortest * 86400_000) } }).sort({ createdAt: 1 }).limit(200).toArray()) {
    const owner = d[OWNER] ?? "";
    if (!plans.has(owner)) plans.set(owner, await planFor(owner));
    const days = keep[plans.get(owner) as keyof KeepDays] ?? keep.free;
    if (!days || d.createdAt.getTime() > now - days * 86400_000) continue;
    try { if (c) await deleteObject(c, d.key); else await fs.promises.rm(localPath(d.key), { force: true }); } catch { continue; } // try again next time
    await all.deleteOne({ _id: d._id });
    n++;
  }
  return n;
}
const sweepSoon = () => { void sweepOld().catch((e) => console.warn("My Reels clean-up:", e)); };

export async function usage() {
  const plan = await planOf();
  const used = await (await reels()).countDocuments({ status: "ready" });
  const keep = (await keepDays())[plan as keyof KeepDays] ?? 0;
  return { used, limit: LIMITS[plan] ?? LIMITS.free, plan, cloud: true, keepDays: keep };
}

const out = (d: ReelDoc) => ({
  id: String(d._id), name: d.name, size: d.size, type: d.type, dur: d.dur, width: d.width, height: d.height, fps: d.fps,
  thumb: d.thumb ?? null, createdAt: d.createdAt, shared: !!d.shareToken, shareUrl: d.shareToken ? `/api/public/studio-reels/${d.shareToken}` : null,
});

/** Uploads started but never finished (the phone went offline, the tab closed): their parts are let go. */
async function dropStale() {
  const c = r2Config(), col = await reels();
  for (const d of await col.find({ status: "uploading", createdAt: { $lt: new Date(Date.now() - STALE_MS) } }).limit(20).toArray()) {
    if (c && d.uploadId) await abortMultipart(c, d.key, d.uploadId);
    else await fs.promises.rm(localPath(d.key), { force: true });
    await col.deleteOne({ _id: d._id });
  }
}

export async function listReels() {
  await dropStale();
  sweepSoon();
  const docs = await (await reels()).find({ status: "ready" }).sort({ createdAt: -1 }).limit(2000).toArray();
  return { reels: docs.map(out), usage: await usage() };
}

export async function startReel(d: z.infer<typeof StartIn>) {
  sweepSoon();
  const u = await usage();
  if (u.used >= u.limit)
    throw new AppError(`My Reels is full (${u.limit} Reels on your plan). Delete a Reel you no longer need, or choose a bigger plan.`, { code: "REELS_FULL", status: 409, details: u });
  const id = new ObjectId(), owner = currentUser() ?? "local";
  const key = `reels/${owner}/${id}.${d.type === "video/webm" ? "webm" : "mp4"}`;
  const c = r2Config();
  const doc: ReelDoc = { _id: id, name: d.name, size: d.size, type: d.type, dur: d.dur, width: d.width, height: d.height, fps: d.fps, thumb: d.thumb, key, status: "uploading", createdAt: new Date() };
  if (!c) {
    await (await reels()).insertOne(doc);
    return { id: String(id), direct: false as const, uploadUrl: `/api/studio/reels/${id}/file` };
  }
  doc.uploadId = await startMultipart(c, key);
  await (await reels()).insertOne(doc);
  const partSize = partSizeFor(d.size);
  return { id: String(id), direct: true as const, partSize, parts: partUrls(c, key, doc.uploadId, Math.ceil(d.size / partSize)) };
}

async function getReel(id: string, status?: ReelDoc["status"]) {
  const d = await (await reels()).findOne({ _id: parseId(id, "Reel"), ...(status ? { status } : {}) });
  if (!d) throw new NotFoundError("This Reel is no longer in My Reels.", { code: "REEL_NOT_FOUND" });
  return d;
}

/** Without R2: the phone sends the file here in one request; it is written to the storage folder as it arrives. */
export async function receiveFile(id: string, req: Request) {
  const d = await getReel(id, "uploading");
  if (d.uploadId || !req.body) throw new ValidationFailed("This upload goes straight to storage.", { code: "UPLOAD_WRONG_WAY" });
  const file = localPath(d.key), tmp = `${file}.part`;
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  let n = 0;
  const counted = Readable.fromWeb(req.body as never).on("data", (b: Buffer) => {
    n += b.length;
    if (n > d.size) counted.destroy(new ValidationFailed("The video is bigger than announced.", { code: "UPLOAD_TOO_BIG" }));
  });
  try {
    await pipeline(counted, fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  return { ok: true, size: n };
}

/** The parts joined (R2) or the file checked (local); the Reel is then in My Reels. */
export async function completeReel(id: string, parts: z.infer<typeof CompleteIn>["parts"]) {
  const d = await getReel(id, "uploading"), c = r2Config();
  let size: number | null;
  if (c && d.uploadId) {
    if (!parts.length) throw new ValidationFailed("No parts were uploaded.", { code: "UPLOAD_EMPTY" });
    await completeMultipart(c, d.key, d.uploadId, parts);
    size = await objectSize(c, d.key);
  } else {
    size = fs.existsSync(localPath(d.key)) ? (await fs.promises.stat(localPath(d.key))).size : null;
  }
  if (size !== d.size) {
    if (c) await deleteObject(c, d.key);
    else await fs.promises.rm(localPath(d.key), { force: true });
    await (await reels()).deleteOne({ _id: d._id });
    throw new ValidationFailed("The Reel did not arrive complete. Please save it again.", { code: "UPLOAD_INCOMPLETE" });
  }
  await (await reels()).updateOne({ _id: d._id }, { $set: { status: "ready" }, $unset: { uploadId: "" } });
  return out({ ...d, status: "ready" });
}

const fileName = (d: ReelDoc) => `${d.name.replace(/[^\w\- ]+/g, "").trim() || "reel"}.${d.type === "video/webm" ? "webm" : "mp4"}`;

/** Play or download: a short-lived link straight to R2 (or the file from this server's storage). */
function fileResponse(req: Request, d: ReelDoc, download: boolean): Response {
  const c = r2Config();
  if (c) return Response.redirect(objectUrl(c, d.key, 3600, download ? fileName(d) : undefined), 302);
  return sendFile(req, localPath(d.key), d.type, { cache: "private, max-age=3600", downloadName: download ? fileName(d) : undefined });
}

export async function reelFile(req: Request, id: string) {
  return fileResponse(req, await getReel(id, "ready"), new URL(req.url).searchParams.has("download"));
}

export async function renameReel(id: string, name: string) {
  const d = await getReel(id, "ready");
  await (await reels()).updateOne({ _id: d._id }, { $set: { name } });
  return out({ ...d, name });
}

/** A link anyone can open to watch the Reel (made once, kept until the Reel is deleted or the link is turned off). */
export async function shareReel(id: string, on: boolean) {
  const d = await getReel(id, "ready");
  const shareToken = on ? (d.shareToken ?? crypto.randomBytes(18).toString("base64url")) : undefined;
  await (await reels()).updateOne({ _id: d._id }, shareToken ? { $set: { shareToken } } : { $unset: { shareToken: "" } });
  return out({ ...d, shareToken });
}

/** A saved Reel's file, wherever it is kept (R2, else the disk): gone. For an account deleted with everything in it. */
export async function deleteReelFile(d: { key?: unknown; uploadId?: unknown }) {
  if (typeof d.key !== "string" || !d.key) return;
  const c = r2Config();
  if (c) {
    if (typeof d.uploadId === "string" && d.uploadId) await abortMultipart(c, d.key, d.uploadId).catch(() => {});
    await deleteObject(c, d.key);
  } else await fs.promises.rm(localPath(d.key), { force: true });
}
export async function deleteReel(id: string) {
  const d = await getReel(id), c = r2Config();
  if (c) {
    if (d.uploadId) await abortMultipart(c, d.key, d.uploadId);
    await deleteObject(c, d.key);
  } else await fs.promises.rm(localPath(d.key), { force: true });
  await (await reels()).deleteOne({ _id: d._id });
  return { ok: true };
}

/** A shared Reel, for anyone with its link (no account needed). */
export async function publicReel(req: Request, token: string) {
  if (!/^[\w-]{20,40}$/.test(token)) throw new NotFoundError("This link does not work any more.", { code: "REEL_NOT_FOUND" });
  const d = await (await mainDb()).collection<ReelDoc>("studio_reels").findOne({ shareToken: token, status: "ready" });
  if (!d) throw new NotFoundError("This link does not work any more.", { code: "REEL_NOT_FOUND" });
  return fileResponse(req, d, new URL(req.url).searchParams.has("download"));
}
