/**
 * My Reels from the browser: save a finished Reel to the account (server/studio/reels.ts), list, share and delete them.
 * The video goes from the phone straight to storage in parts (three at a time, each retried), never through our server.
 */

import { adminHeaders } from "@/lib/admin";

export type CloudReel = {
  id: string; name: string; size: number; type: string; dur: number; width: number; height: number; fps: number;
  thumb: string | null; createdAt: string; shared: boolean; shareUrl: string | null;
};
export type CloudUsage = { used: number; limit: number; plan: string; cloud: boolean };
export type SaveMeta = { name: string; dur: number; width: number; height: number; fps: number; thumb?: string };

/** An error to show as is: written for people. */
export class CloudError extends Error {
  code: string;
  constructor(message: string, code = "CLOUD_ERROR") {
    super(message);
    this.code = code;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      credentials: "include",
      headers: { ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...adminHeaders(), ...init.headers },
    });
  } catch {
    throw new CloudError("We cannot connect right now. Check your internet and try again.", "NETWORK_ERROR");
  }
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    throw new CloudError(e?.error?.message || "That did not work. Please try again.", e?.error?.code);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const listCloudReels = () => call<{ reels: CloudReel[]; usage: CloudUsage }>("/api/studio/reels");
export const deleteCloudReel = (id: string) => call<{ ok: true }>(`/api/studio/reels/${id}`, { method: "DELETE" });
export const renameCloudReel = (id: string, name: string) => call<CloudReel>(`/api/studio/reels/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const shareCloudReel = (id: string, on: boolean) => call<CloudReel>(`/api/studio/reels/${id}/share`, { method: "POST", body: JSON.stringify({ on }) });
export const cloudReelUrl = (id: string, download = false) => `/api/studio/reels/${id}/file${download ? "?download" : ""}`;
export async function cloudUsage(): Promise<CloudUsage | null> {
  try {
    return (await listCloudReels()).usage;
  } catch (e) {
    console.warn("My Reels not offered:", e); // signed out or offline: the studio just does not offer it
    return null;
  }
}

type Start = { id: string; direct: true; partSize: number; parts: { n: number; url: string }[] } | { id: string; direct: false; uploadUrl: string };

/** One part, PUT to its presigned link; tried up to four times. Its bytes count towards the progress while it goes. */
async function putPart(url: string, data: Blob, onBytes: (n: number) => void): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let sent = 0;
    try {
      return await new Promise<string>((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open("PUT", url);
        x.upload.onprogress = (e) => {
          onBytes(e.loaded - sent);
          sent = e.loaded;
        };
        x.onload = () => {
          const tag = x.getResponseHeader("ETag");
          if (x.status >= 200 && x.status < 300 && tag) resolve(tag);
          else reject(new Error(`part ${x.status}`));
        };
        x.onerror = () => reject(new Error("part network"));
        x.send(data);
      });
    } catch (e) {
      onBytes(-sent); // a failed try gives its bytes back
      if (attempt >= 3) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

/** Save a finished Reel to My Reels. Progress goes from 0 to 1. */
export async function saveToCloud(blob: Blob, meta: SaveMeta, onProgress?: (p: number) => void): Promise<CloudReel> {
  const type = blob.type === "video/webm" ? "video/webm" : "video/mp4";
  const start = await call<Start>("/api/studio/reels", { method: "POST", body: JSON.stringify({ ...meta, size: blob.size, type }) });
  let done = 0;
  const tick = (n: number) => {
    done = Math.max(0, done + n);
    onProgress?.(Math.min(0.99, done / blob.size));
  };
  try {
    if (start.direct) {
      const etags: { n: number; etag: string }[] = [];
      const queue = [...start.parts];
      const worker = async () => {
        for (let p = queue.shift(); p; p = queue.shift()) {
          const a = (p.n - 1) * start.partSize;
          etags.push({ n: p.n, etag: await putPart(p.url, blob.slice(a, Math.min(blob.size, a + start.partSize)), tick) });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      const reel = await call<CloudReel>(`/api/studio/reels/${start.id}/complete`, { method: "POST", body: JSON.stringify({ parts: etags }) });
      onProgress?.(1);
      return reel;
    }
    await call(start.uploadUrl, { method: "PUT", body: blob, headers: { "Content-Type": type } });
    const reel = await call<CloudReel>(`/api/studio/reels/${start.id}/complete`, { method: "POST", body: JSON.stringify({ parts: [] }) });
    onProgress?.(1);
    return reel;
  } catch (e) {
    await deleteCloudReel(start.id).catch(() => {});
    if (e instanceof CloudError) throw e;
    throw new CloudError("Your Reel is saved on your phone, but it could not be saved to My Reels. Please try again.", "UPLOAD_FAILED");
  }
}
