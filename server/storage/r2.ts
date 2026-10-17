import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "@/server/core/config";
import { AppError } from "@/server/core/errors";

/** Cloudflare R2 through its S3 API, for uploads that go from the browser straight into the bucket (the video never passes
 * through this server). Every call is a presigned URL (AWS Signature V4, query form), the same kind the browser gets.
 * Object keys are the storage keys: the bucket is what docker/start.sh mounts at STORAGE_PATH. */

export interface R2Config { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string }

export function r2Config(): R2Config | null {
  const accountId = env("R2_ACCOUNT_ID"), bucket = env("R2_BUCKET");
  const accessKeyId = env("R2_ACCESS_KEY_ID", env("AWS_ACCESS_KEY_ID")), secretAccessKey = env("R2_SECRET_ACCESS_KEY", env("AWS_SECRET_ACCESS_KEY"));
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || env("DIRECT_UPLOADS", "on").toLowerCase() === "off") return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

// ------------------------------------------------------------------ Signature V4 (query string)
/** RFC 3986 encoding, as Signature V4 wants it (encodeURIComponent leaves !'()* alone). */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac("sha256", key).update(data).digest();
const sha256 = (data: string) => crypto.createHash("sha256").update(data).digest("hex");

export interface PresignIn {
  method: string; host: string; path: string; query?: Record<string, string>; region: string; service: string;
  accessKeyId: string; secretAccessKey: string; expires: number; now?: Date;
}

/** A presigned URL: anyone holding it may make exactly this request (method, object, query) until it expires. */
export function presign(p: PresignIn): string {
  const now = p.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""), day = amzDate.slice(0, 8);
  const scope = `${day}/${p.region}/${p.service}/aws4_request`;
  const query: Record<string, string> = {
    ...p.query, "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${p.accessKeyId}/${scope}`, "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(p.expires), "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const canonicalPath = p.path.split("/").map(enc).join("/");
  const request = [p.method, canonicalPath, canonicalQuery, `host:${p.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(request)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${p.secretAccessKey}`, day), p.region), p.service), "aws4_request");
  const signature = crypto.createHmac("sha256", key).update(toSign).digest("hex");
  return `https://${p.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// ------------------------------------------------------------------ R2 calls
const URL_SECONDS = 3 * 3600; // long enough for a slow phone connection to finish a big clip

function r2Url(c: R2Config, method: string, key: string, query: Record<string, string> = {}, expires = URL_SECONDS) {
  const host = `${c.accountId}.r2.cloudflarestorage.com`;
  return presign({ method, host, path: `/${c.bucket}/${key.replace(/^\/+/, "")}`, query, region: "auto", service: "s3", accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey, expires });
}

async function call(c: R2Config, method: string, key: string, query: Record<string, string>, body?: string): Promise<string> {
  const res = await fetch(r2Url(c, method, key, query, 300), { method, body, headers: body ? { "Content-Type": "application/xml" } : undefined });
  const text = await res.text();
  if (!res.ok) throw new AppError("The storage service refused the upload. Try again in a moment.", { code: "STORAGE_ERROR", status: 502, details: text.slice(0, 300) });
  return text;
}

/** Start a multipart upload of `key` (the browser then sends the parts itself). */
export async function startMultipart(c: R2Config, key: string): Promise<string> {
  const xml = await call(c, "POST", key, { uploads: "" });
  const id = /<UploadId>([^<]+)<\/UploadId>/.exec(xml)?.[1];
  if (!id) throw new AppError("The storage service did not start the upload.", { code: "STORAGE_ERROR", status: 502 });
  return id;
}

/** Presigned PUT URLs for parts 1..count of an upload. */
export const partUrls = (c: R2Config, key: string, uploadId: string, count: number) =>
  Array.from({ length: count }, (_, i) => ({ n: i + 1, url: r2Url(c, "PUT", key, { partNumber: String(i + 1), uploadId }) }));

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Join the uploaded parts into the object. */
export async function completeMultipart(c: R2Config, key: string, uploadId: string, parts: { n: number; etag: string }[]) {
  const body = `<CompleteMultipartUpload>${[...parts].sort((a, b) => a.n - b.n).map((p) => `<Part><PartNumber>${p.n}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`).join("")}</CompleteMultipartUpload>`;
  const xml = await call(c, "POST", key, { uploadId }, body);
  if (/<Error>/.test(xml)) throw new AppError("The upload could not be finished. Try adding the clip again.", { code: "STORAGE_ERROR", status: 502, details: xml.slice(0, 300) });
}

export async function abortMultipart(c: R2Config, key: string, uploadId: string) {
  await call(c, "DELETE", key, { uploadId }).catch(() => {});
}

export async function deleteObject(c: R2Config, key: string) {
  await call(c, "DELETE", key, {}).catch(() => {});
}

/** Download an object to a local file (R2 to this container is fast; the mounted folder may not list it yet). Returns its size. */
export async function downloadObject(c: R2Config, key: string, dest: string): Promise<number> {
  const res = await fetch(r2Url(c, "GET", key, {}, 300));
  if (!res.ok || !res.body) throw new AppError("The uploaded clip could not be read back from storage.", { code: "STORAGE_ERROR", status: 502 });
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
    await fs.promises.rename(tmp, dest);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  return (await fs.promises.stat(dest)).size;
}

/** A presigned GET link to an object (the browser plays or downloads it straight from R2, not through this server). */
export const objectUrl = (c: R2Config, key: string, seconds = 3600, downloadName?: string) =>
  r2Url(c, "GET", key, downloadName ? { "response-content-disposition": `attachment; filename="${downloadName.replace(/["\\]/g, "")}"` } : {}, seconds);

/** The size of a stored object (null: not there). */
export async function objectSize(c: R2Config, key: string): Promise<number | null> {
  const res = await fetch(r2Url(c, "HEAD", key, {}, 300), { method: "HEAD" });
  if (res.status === 404) return null;
  if (!res.ok) throw new AppError("The storage service could not be reached. Try again in a moment.", { code: "STORAGE_ERROR", status: 502 });
  return Number(res.headers.get("content-length") ?? 0);
}
