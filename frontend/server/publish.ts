import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import { ObjectId } from "mongodb";
import { settings } from "@/server/core/config";
import { withUser } from "@/server/core/auth";
import { db, mainDb, parseId } from "@/server/core/db";
import { NotFoundError, ValidationFailed } from "@/server/core/errors";
import { getProjectDoc } from "@/server/projects/service";
import { localPath } from "@/server/storage/local";

/** Publish / schedule a finished Reel to Instagram, TikTok and YouTube (was publish/ and api/publish.py). The platforms
 * that pull the video get a signed, short-lived public link; YouTube is uploaded directly. */

const GRAPH = "https://graph.facebook.com/v21.0", LINK_MINUTES = 120;
export type Platform = "instagram" | "tiktok" | "youtube";
class PublishError extends Error {}
const title = (p: string) => p[0].toUpperCase() + p.slice(1);

/** Which platforms are connected, and the .env settings still missing for the others (names, never values). */
export function connections(): Record<Platform, { connected: boolean; missing: string[] }> {
  const s = settings, miss = (pairs: [string, string][]) => pairs.filter(([, v]) => !v).map(([n]) => n);
  const need: Record<Platform, string[]> = {
    instagram: miss([["INSTAGRAM_USER_ID", s.instagramUserId], ["INSTAGRAM_ACCESS_TOKEN", s.instagramAccessToken]]),
    tiktok: miss([["TIKTOK_ACCESS_TOKEN", s.tiktokAccessToken]]),
    youtube: miss([["YOUTUBE_CLIENT_ID", s.youtubeClientId], ["YOUTUBE_CLIENT_SECRET", s.youtubeClientSecret], ["YOUTUBE_REFRESH_TOKEN", s.youtubeRefreshToken]]),
  };
  for (const p of ["instagram", "tiktok"] as const) {
    if (!s.publicBaseUrl) need[p].push("PUBLIC_BASE_URL");
    if (!s.secretKey) need[p].push("SECRET_KEY");
  }
  return Object.fromEntries(Object.entries(need).map(([p, m]) => [p, { connected: !m.length, missing: m }])) as ReturnType<typeof connections>;
}

const sign = (payload: string) => crypto.createHmac("sha256", settings.secretKey).update(payload).digest("hex").slice(0, 40);
export function publicLink(projectId: string, renderingId: string, minutes = LINK_MINUTES): string {
  const payload = Buffer.from(JSON.stringify({ u: null, p: projectId, r: renderingId, e: Math.trunc(Date.now() / 1000) + minutes * 60 })).toString("base64url");
  return `${settings.publicBaseUrl.replace(/\/+$/, "")}/api/public/reels/${payload}.${sign(payload)}.mp4`;
}
export function readLink(token: string): Record<string, unknown> | null {
  if (!settings.secretKey) return null;
  const t = token.replace(/\.mp4$/, ""), at = t.lastIndexOf(".");
  if (at < 0) return null;
  const payload = t.slice(0, at), sig = t.slice(at + 1), want = sign(payload);
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return Number(data.e ?? 0) > Date.now() / 1000 ? data : null;
  } catch { return null; }
}

async function check(r: Response, platform: string): Promise<Record<string, unknown>> {
  const text = await r.text();
  let data: unknown = {};
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (r.status >= 400 || (d.error && platform !== "tiktok")) {
    const err = d.error, msg = (err && typeof err === "object" ? (err as Record<string, unknown>).message : err) || text.slice(0, 200);
    throw new PublishError(`${title(platform)} said: ${msg}`);
  }
  return d;
}
const form = (o: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(o) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function postInstagram(videoUrl: string, caption: string, wait = 300, poll = 5): Promise<[string, string]> {
  const uid = settings.instagramUserId, token = settings.instagramAccessToken;
  const c = await check(await fetch(`${GRAPH}/${uid}/media`, form({ media_type: "REELS", video_url: videoUrl, caption, share_to_feed: "true", access_token: token })), "instagram");
  const cid = String(c.id), deadline = Date.now() + wait * 1000;
  for (;;) {
    const st = await check(await fetch(`${GRAPH}/${cid}?${new URLSearchParams({ fields: "status_code", access_token: token })}`), "instagram");
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") throw new PublishError("Instagram could not process the video (check it is an MP4 of 3-90 s).");
    if (Date.now() > deadline) throw new PublishError("Instagram is taking too long to process the video. Try again in a few minutes.");
    await sleep(poll * 1000);
  }
  const done = await check(await fetch(`${GRAPH}/${uid}/media_publish`, form({ creation_id: cid, access_token: token })), "instagram");
  const link = await check(await fetch(`${GRAPH}/${done.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`), "instagram");
  return [String(done.id), String(link.permalink ?? "")];
}
async function postTiktok(videoUrl: string, caption: string): Promise<[string, string]> {
  const r = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", { method: "POST", headers: { Authorization: `Bearer ${settings.tiktokAccessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ post_info: { title: caption.slice(0, 2200), privacy_level: "PUBLIC_TO_EVERYONE" }, source_info: { source: "PULL_FROM_URL", video_url: videoUrl } }) });
  const data = await check(r, "tiktok"), err = (data.error ?? {}) as Record<string, unknown>;
  if (![undefined, null, "", "ok"].includes(err.code as string)) throw new PublishError(`TikTok said: ${err.message || err.code}`);
  return [String(((data.data ?? {}) as Record<string, unknown>).publish_id ?? ""), ""];
}
async function postYoutube(file: string, name: string, description: string): Promise<[string, string]> {
  const tok = (await check(await fetch("https://oauth2.googleapis.com/token", form({ client_id: settings.youtubeClientId, client_secret: settings.youtubeClientSecret, refresh_token: settings.youtubeRefreshToken, grant_type: "refresh_token" })), "youtube")).access_token as string;
  const t = name.toLowerCase().includes("#shorts") ? name : `${name} #Shorts`;
  const start = await fetch(`https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, { method: "POST", headers: { Authorization: `Bearer ${tok}`, "X-Upload-Content-Type": "video/mp4", "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { title: t.slice(0, 100), description: description.slice(0, 5000) }, status: { privacyStatus: "public" } }) });
  const loc = start.headers.get("location");
  await check(start, "youtube");
  if (!loc) throw new PublishError("YouTube said: no upload address.");
  const vid = String((await check(await fetch(loc, { method: "PUT", body: fs.readFileSync(file), headers: { "Content-Type": "video/mp4" }, signal: AbortSignal.timeout(600_000) }), "youtube")).id);
  return [vid, `https://youtube.com/shorts/${vid}`];
}

/** Publish one post (already 'publishing'); each platform's result is recorded. */
export async function runPost(postId: ObjectId) {
  const d = await db(), post = await d.collection("posts").findOne({ _id: postId });
  if (!post) return;
  const r = await d.collection("renderings").findOne({ _id: post.renderingId }), project = await d.collection("projects").findOne({ _id: post.projectId });
  if (!r || !project) { await d.collection("posts").updateOne({ _id: postId }, { $set: { status: "failed", error: "The Reel no longer exists.", updatedAt: new Date() } }); return; }
  const pid = String(post.projectId), rid = String(r._id), caption = (post.caption as string) || (project.name as string), results: Record<string, unknown> = {};
  for (const p of post.platforms as Platform[]) {
    try {
      if (!connections()[p].connected) throw new PublishError(`${title(p)} is not connected on this server.`);
      const [id, url] = p === "youtube" ? await postYoutube(localPath(r.storedKey as string), caption.split("\n")[0].slice(0, 90), caption) : p === "instagram" ? await postInstagram(publicLink(pid, rid), caption) : await postTiktok(publicLink(pid, rid), caption);
      results[p] = { ok: true, postId: id, url, error: null };
    } catch (e) { results[p] = { ok: false, postId: null, url: "", error: (e as Error).message || (e as Error).name }; }
  }
  const status = Object.values(results).every((x) => (x as { ok: boolean }).ok) ? "done" : "failed";
  await d.collection("posts").updateOne({ _id: postId }, { $set: { status, results, updatedAt: new Date() } });
}
/** Start every scheduled post whose time has come (claimed one at a time, so none is published twice). */
export async function runDuePosts(): Promise<number> {
  const d = await mainDb();
  let ran = 0;
  for (;;) {
    const post = await d.collection("posts").findOneAndUpdate({ status: "scheduled", at: { $lte: new Date() } }, { $set: { status: "publishing", updatedAt: new Date() } });
    if (!post) break;
    await withUser((post.ownerId as string) ?? null, () => runPost(post._id)); // published as its owner: their Reel, their records
    ran++;
  }
  return ran;
}
let timer: NodeJS.Timeout | null = null;
export function startScheduler(everyS = 30) {
  if (timer) return;
  timer = setInterval(() => { runDuePosts().catch((e) => console.warn("publishing scheduler:", e)); }, everyS * 1000);
  timer.unref?.();
}

const out = (p: Record<string, unknown>) => ({ id: String(p._id), renderingId: String(p.renderingId), platforms: p.platforms, caption: p.caption ?? "", at: p.at ?? null, status: p.status, results: p.results ?? {}, error: p.error ?? null, createdAt: p.createdAt });
export async function publish(projectId: string, renderingId: string, req: { platforms: Platform[]; caption: string; at: Date | null }) {
  const doc = await getProjectDoc(projectId), d = await db();
  const r = await d.collection("renderings").findOne({ _id: parseId(renderingId, "Rendering"), projectId: doc._id });
  if (!r) throw new NotFoundError("Rendering not found.", { code: "RENDERING_NOT_FOUND" });
  const chosen = [...new Set(req.platforms)], conn = connections(), off = chosen.filter((p) => !conn[p].connected);
  if (off.length) throw new ValidationFailed(`Not connected yet: ${off.map(title).join(", ")}. Download the Reel and post it yourself, or ask the admin to connect it.`, { code: "PLATFORM_NOT_CONNECTED", details: { missing: Object.fromEntries(off.map((p) => [p, conn[p].missing])) } });
  const now = new Date(), at = req.at, min = 60_000;
  if (at && at.getTime() < now.getTime() - min) throw new ValidationFailed("Choose a time in the future.", { code: "TIME_IN_PAST" });
  if (at && at.getTime() > now.getTime() + 60 * 86400_000) throw new ValidationFailed("Schedule at most 60 days ahead.", { code: "TIME_TOO_FAR" });
  const scheduled = Boolean(at && at.getTime() > now.getTime() + min);
  const post = { _id: new ObjectId(), projectId: doc._id, renderingId: r._id, platforms: chosen, caption: req.caption.trim(), at: at ?? now, status: scheduled ? "scheduled" : "publishing", results: {}, createdAt: now, updatedAt: now };
  await d.collection("posts").insertOne(post);
  if (!scheduled) void runPost(post._id).catch((e) => console.warn("publish:", e));
  return out(post);
}
export async function projectPosts(projectId: string) {
  const doc = await getProjectDoc(projectId);
  return (await (await db()).collection("posts").find({ projectId: doc._id }).sort({ createdAt: -1 }).limit(50).toArray()).map(out);
}
export async function cancelPost(postId: string) {
  const res = await (await db()).collection("posts").updateOne({ _id: parseId(postId, "Post"), status: "scheduled" }, { $set: { status: "cancelled", updatedAt: new Date() } });
  if (!res.modifiedCount) throw new NotFoundError("No scheduled post to cancel (it may already be published).", { code: "POST_NOT_SCHEDULED" });
  return { ok: true };
}
/** The file behind a signed public link (no sign-in), or null. */
export async function publicReelFile(token: string): Promise<string> {
  const data = readLink(token), ok = (v: unknown) => typeof v === "string" && ObjectId.isValid(v);
  if (!data || !ok(data.r) || !ok(data.p)) throw new NotFoundError("This link has expired.", { code: "LINK_EXPIRED" });
  const r = await (await db()).collection("renderings").findOne({ _id: new ObjectId(data.r as string), projectId: new ObjectId(data.p as string) });
  const file = r ? localPath(r.storedKey as string) : null;
  if (!file || !fs.existsSync(file)) throw new NotFoundError("Rendering not found.", { code: "RENDERING_NOT_FOUND" });
  return file;
}
