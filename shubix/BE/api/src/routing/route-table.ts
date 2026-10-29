import fs from "node:fs";
import path from "node:path";
import { Injectable, Logger } from "@nestjs/common";

/** The app's endpoints, as the web app had them: src/routes/<path>/route.ts exports GET/POST/PUT/PATCH/DELETE, each a
 * web-standard (Request, { params }) => Response handler. The table is built once at start; a request is matched
 * against it in order (fixed segments before params, as Next.js does). */
export type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
type Entry = { route: string; re: RegExp; keys: string[]; mod: Record<string, unknown> };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function compile(route: string) {
  const keys: string[] = [];
  const src = route.split("/").map((seg) => { const m = /^\[(\w+)\]$/.exec(seg); if (m) { keys.push(m[1]); return "([^/]+)"; } return escape(seg); }).join("/");
  return { re: new RegExp(`^/${src}/?$`), keys };
}
/** a sortable rank: per segment 2 for a fixed one, 1 for a param (more specific first) */
export const rank = (route: string) => route.split("/").map((s) => (s.startsWith("[") ? "1" : "2")).join("") + "9";

@Injectable()
export class RouteTable {
  private entries: Entry[] = [];
  private log = new Logger("Routes");
  constructor() {
    const root = path.join(__dirname, "..", "routes");
    const found: string[] = [];
    const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else if (/^route\.(js|ts)$/.test(e.name)) found.push(p); } };
    walk(root);
    for (const file of found) {
      const route = path.relative(root, path.dirname(file)).split(path.sep).join("/");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.entries.push({ route, ...compile(route), mod: require(file) as Record<string, unknown> });
    }
    this.entries.sort((a, b) => (rank(a.route) > rank(b.route) ? -1 : rank(a.route) < rank(b.route) ? 1 : 0));
    this.log.log(`${this.entries.length} endpoints`);
  }
  /** the handler for a method and path, its params, and the methods the path has */
  match(method: string, pathname: string): { handler?: Handler; params: Record<string, string>; allow: string[] } | null {
    for (const e of this.entries) {
      const m = e.re.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      e.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const allow = ["GET", "POST", "PUT", "PATCH", "DELETE"].filter((x) => typeof e.mod[x] === "function");
      const handler = (e.mod[method] ?? (method === "HEAD" ? e.mod.GET : undefined)) as Handler | undefined;
      return { handler, params, allow };
    }
    return null;
  }
}
