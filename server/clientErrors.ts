import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { currentUser } from "@/server/core/auth";
import { db } from "@/server/core/db";

/** Errors in people's browsers (the app or the studio breaking on a phone), kept on our own server so the administrator
 * sees them without an outside service: the same error is one row with a count, the page and device it was seen on last.
 * Kept 30 days. Nothing personal: the message, where in the code, the page, the browser. */
export const ClientError = z.object({
  kind: z.enum(["error", "rejection", "studio", "webgl"]).default("error"),
  message: z.string().max(400),
  stack: z.string().max(2000).default(""),
  path: z.string().max(300).default("/"),
});
const clip = (s: string, n: number) => s.replace(/[\u0000-\u001f]+/g, " ").slice(0, n);
export async function recordClientError(e: z.infer<typeof ClientError>, ua: string) {
  const message = clip(e.message, 400), where = clip(e.stack.split("\n").find((l) => /at |@/.test(l)) ?? "", 200);
  const id = crypto.createHash("sha1").update(`${e.kind}|${message}|${where}`).digest("hex").slice(0, 20);
  const now = new Date(), uid = currentUser() ?? null;
  await (await db()).collection("client_errors").updateOne({ _id: id as unknown as import("mongodb").ObjectId },
    { $setOnInsert: { firstAt: now, kind: e.kind, message, where }, $set: { lastAt: now, path: clip(e.path, 300), ua: clip(ua, 300), stack: clip(e.stack, 2000), ...(uid ? { lastUser: uid } : {}) }, $inc: { count: 1 } },
    { upsert: true });
  return { ok: true };
}
export async function listClientErrors() {
  const since = new Date(Date.now() - 30 * 864e5), c = (await db()).collection("client_errors");
  void c.deleteMany({ lastAt: { $lt: since } }).catch(() => {});
  const rows = await c.find({ lastAt: { $gte: since } }).sort({ lastAt: -1 }).limit(200).toArray();
  return { errors: rows.map((r) => ({ id: String(r._id), kind: r.kind, message: r.message, where: r.where, count: r.count ?? 1, firstAt: r.firstAt, lastAt: r.lastAt, path: r.path, ua: r.ua, stack: r.stack })) };
}
export async function clearClientError(id: string) { await (await db()).collection("client_errors").deleteOne({ _id: id as unknown as import("mongodb").ObjectId }); return { ok: true }; }
