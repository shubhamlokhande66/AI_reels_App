import { All, Controller, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RouteTable } from "./route-table";
import { jsonError, sendWebResponse, toWebRequest } from "./web-bridge";

/** Every request no native module answered: the app's endpoints (src/routes). */
@Controller()
export class RoutingController {
  constructor(private table: RouteTable) {}

  @All("{*path}")
  async handle(@Req() req: Request, @Res() res: Response) {
    const hit = this.table.match(req.method, req.path);
    if (!hit) return jsonError(res, 404, "NOT_FOUND", "Not found.");
    if (!hit.handler) {
      res.setHeader("Allow", [...hit.allow, "OPTIONS"].join(", "));
      return req.method === "OPTIONS" ? res.status(204).end() : jsonError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed.");
    }
    try {
      const out = await hit.handler(toWebRequest(req), { params: Promise.resolve(hit.params) });
      await sendWebResponse(req, res, out);
    } catch (e) {
      console.error("Unhandled error", e);
      if (!res.headersSent) jsonError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred.");
      else res.end();
    }
  }
}
