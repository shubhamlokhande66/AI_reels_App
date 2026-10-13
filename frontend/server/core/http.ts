import "server-only";
import fs from "node:fs";
import { Readable } from "node:stream";
import { settings } from "./config";
import { errorBody, errorResponse } from "./errors";

type Ctx<P> = { params: Promise<P> };

/** A route handler with the app's error model: an AppError becomes its JSON error, anything else a 500. */
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<Response | unknown>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const out = await fn(req, await ctx.params);
      if (out instanceof Response) return out;
      return out === undefined ? new Response(null, { status: 204 }) : Response.json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

const HOP = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "host", "content-length", "expect"]); // Node's fetch refuses "expect"

/** Forward a request to the Python backend unchanged: for the methods of a path that are not moved yet (a route
 * file takes over every method of its path, so the others must be passed on explicitly). */
export async function toPython(req: Request): Promise<Response> {
  try {
    return await forward(req);
  } catch (e) {
    console.error("Forwarding to the Python backend failed", e);
    return Response.json(errorBody("BACKEND_UNAVAILABLE", "The media server is not answering; is it running?"), { status: 502 });
  }
}

async function forward(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((v, k) => !HOP.has(k) && headers.set(k, v));
  const res = await fetch(`${settings.pythonUrl}${url.pathname}${url.search}`, {
    method: req.method, headers, body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
    // @ts-expect-error -- Node's fetch needs this to stream a request body
    duplex: "half", redirect: "manual",
  });
  const out = new Headers();
  res.headers.forEach((v, k) => !HOP.has(k) && k !== "content-encoding" && out.set(k, v));
  return new Response(res.body, { status: res.status, headers: out });
}

/** A file from disk, streamed (never read whole into memory), with Range support so a video or song can seek. */
export function sendFile(req: Request, file: string, type: string, opts: { cache?: string; downloadName?: string } = {}): Response {
  const size = fs.statSync(file).size;
  const headers = new Headers({ "Content-Type": type, "Accept-Ranges": "bytes" });
  if (opts.cache) headers.set("Cache-Control", opts.cache);
  if (opts.downloadName) headers.set("Content-Disposition", `attachment; filename="${opts.downloadName.replace(/"/g, "")}"`);
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && size > 0) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, Math.min(start, size - 1));
    end = Math.max(start, Math.min(end, size - 1));
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(req.method === "HEAD" ? null : body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(req.method === "HEAD" ? null : body, { status: 200, headers });
}

/** Every method of a path passed on to Python, the body streamed (used for uploads: a rewrite would buffer the body
 * and cut it at 10 MB). */
export const forwardAll = { GET: toPython, POST: toPython, PUT: toPython, PATCH: toPython, DELETE: toPython };
