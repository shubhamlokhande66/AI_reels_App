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
  const origins = env("WEB_ORIGINS", "http://localhost:3001,http://localhost:8081") /* the website, Expo web */.split(",").map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  // the database indexes, once per server start (was instrumentation.ts)
  void import("./server/core/indexes").then((m) => m.ensureIndexes()).catch((e) => console.warn("database indexes:", e));
  const port = Number(env("API_PORT", "4000"));
  await app.listen(port);
  console.log(`Shubix API on http://localhost:${port}`);
}
void bootstrap();
