import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { NextFunction, Request, Response } from "express";
import { AppModule } from "./app.module";
import { env } from "./server/core/config";

/** BE/api: every endpoint of the app (src/routes, served by src/routing) plus native Nest modules (auth, users).
 * No body parser: route handlers read the raw request stream themselves (uploads are streamed, never buffered). */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.set("trust proxy", true); // behind the web app rewrite / Cloudflare: the real host and protocol
  app.disable("x-powered-by");
  // the headers next.config.ts gave every API answer (the phone app calls the API directly)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });
  // CORS: the WEB_ORIGINS list; while developing also any port on this computer or the local network (the website,
  // Expo web on 8081, 8082, …). Production lists its origins (the website itself calls /api on its own address).
  const listed = env("WEB_ORIGINS").split(",").map((s) => s.trim()).filter(Boolean);
  const local = env("NODE_ENV") !== "production" ? /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2})(:\d+)?$/ : null;
  app.enableCors({ origin: (o, ok) => ok(null, !o || listed.includes(o) || !!local?.test(o)), credentials: true });
  // process.exit after closing: in the container node is PID 1, which ignores the SIGTERM Nest re-sends to itself by
  // default, so Cloudflare's stop left a "running" container with no server and every wake after it hung
  app.enableShutdownHooks(undefined, { useProcessExit: true });
  // the database indexes, once per server start (was instrumentation.ts)
  void import("./server/core/indexes").then((m) => m.ensureIndexes()).catch((e) => console.warn("database indexes:", e));
  const port = Number(env("API_PORT", "4000"));
  await app.listen(port);
  console.log(`Shubix API on http://localhost:${port}`);
}
void bootstrap();
