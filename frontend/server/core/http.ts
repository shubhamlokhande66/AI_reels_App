import "server-only";
import fs from "node:fs";
import { Readable } from "node:stream";
import { resolveUser, withUser } from "./auth";
import { errorResponse } from "./errors";

type Ctx<P> = { params: Promise<P> };

/** A route handler with the app's error model: an AppError becomes its JSON error, anything else a 500. */
export function route<P = Record<string, string>>(fn: (req: Request, params: P) => Promise<Response | unknown>) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      const uid = await resolveUser(req); // accounts on: the signed-in user for this request and the jobs it starts
      const out = await withUser(uid, async () => fn(req, await ctx.params));
      if (out instanceof Response) return out;
      return out === undefined ? new Response(null, { status: 204 }) : Response.json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
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
