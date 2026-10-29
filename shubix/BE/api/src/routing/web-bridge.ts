import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";

/** Express ⇄ web-standard Request/Response, streamed both ways (a big upload or a video download is never held in memory). */
export function toWebRequest(req: ExpressRequest): Request {
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "localhost";
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) headers.append(k, x); else headers.set(k, v);
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : (Readable.toWeb(req) as ReadableStream);
  return new Request(`${req.protocol}://${host}${req.originalUrl}`, { method: req.method, headers, body, duplex: "half" } as RequestInit);
}

const SESSION = /^reel_session=([^;]*)/;
/** The phone app (X-Client: mobile) keeps its session token itself: a sign-in answer that sets the cookie also carries
 * the token in its JSON body (only these small answers are read whole). */
async function withMobileToken(req: ExpressRequest, r: Response): Promise<Response> {
  if (req.get("x-client") !== "mobile" || !(r.headers.get("content-type") ?? "").includes("json")) return r;
  const token = r.headers.getSetCookie().map((c) => SESSION.exec(c)?.[1]).find((t) => t && t !== '""');
  if (!token) return r;
  const body = (await r.json().catch(() => null)) as Record<string, unknown> | null;
  const headers = new Headers(r.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(body && typeof body === "object" ? { ...body, token } : body), { status: r.status, headers });
}

export async function sendWebResponse(req: ExpressRequest, res: ExpressResponse, response: Response) {
  const r = await withMobileToken(req, response);
  res.status(r.status);
  r.headers.forEach((v, k) => { if (k !== "set-cookie") res.setHeader(k, v); });
  const cookies = r.headers.getSetCookie();
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  if (!r.body || req.method === "HEAD") { res.end(); return; }
  // the client went away (a closed video): stop reading the file
  await pipeline(Readable.fromWeb(r.body as import("node:stream/web").ReadableStream), res).catch(() => {});
}
export const jsonError = (res: ExpressResponse, status: number, code: string, message: string) => res.status(status).json({ error: { code, message, details: null } });
