import { Container, getContainer } from "@cloudflare/containers";

/** Reel Maker on Cloudflare: this Worker passes every request to ONE app container (the Next.js server, FFmpeg included;
 * with CONTAINER_ROLE "api" the API alone, the website being on Vercel: docs/deploy-vercel-cloudflare.md).
 * The container sleeps after SLEEP_AFTER without requests. Reels saved to My Reels are kept in R2: docker/start.sh mounts
 * the bucket in the container. */

interface Env {
  APP: DurableObjectNamespace<ReelApp>;
  SLEEP_AFTER?: string;
  CONTAINER_ROLE?: string;
  [key: string]: unknown;
}

export class ReelApp extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "30s";
  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    if (typeof env.SLEEP_AFTER === "string" && env.SLEEP_AFTER) this.sleepAfter = env.SLEEP_AFTER;
    if (env.CONTAINER_ROLE === "api") this.defaultPort = 4000; // the API alone (the website on Vercel)
    // every setting (vars and secrets) goes to the app as an environment variable; bindings are not strings
    this.envVars = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
  }
  // A cold start (the machine, the R2 mount, the server) takes 20-30 s, more than the library waits by itself (20 s), and
  // its saved state can still say "healthy" from the container before: this object waits for the port itself, once
  // per start (`ready`: the server answered since this object woke or the container last stopped).
  // If the container stopped without this object hearing it (a new version rolled out), the answer is "not running":
  // the container is let go, started again and the request asked once more (a request with a body: the next one is).
  private ready = false;
  override onStop() { this.ready = false; }
  private wake(signal?: AbortSignal) {
    return this.startAndWaitForPorts(this.defaultPort, { portReadyTimeoutMS: 90_000, instanceGetTimeoutMS: 30_000, abort: signal });
  }
  override async fetch(request: Request): Promise<Response> {
    const again = request.method === "GET" || request.method === "HEAD" ? request.clone() : null;
    if (!this.ready || !this.ctx.container?.running) { await this.wake(request.signal); this.ready = true; }
    const res = await super.fetch(request);
    if (res.status < 500 || !/^(Error proxying request to container|Failed to start container)/.test(await res.clone().text())) return res;
    this.ready = false;
    try { await this.destroy(); } catch { /* already gone */ }
    if (!again) return res;
    await this.wake(again.signal); this.ready = true;
    return super.fetch(again);
  }
  override onError(error: unknown) {
    console.error("app container error", error);
    throw error;
  }
}

const app = (env: Env) => getContainer(env.APP, "main");

// An open tab says "still here" every 5 minutes (lib/usePresence.ts, the admin's "online now"). Waking the container
// only for that would bill it for a few minutes each time someone leaves a tab open: while it sleeps, the Worker answers
// the ping itself. Opening a page wakes it anyway, so the first ping of a visit is still counted.
const PING = "/api/public/ping";
const awake = async (env: Env) => {
  try { const s = await app(env).getState(); return s.status === "running" || s.status === "healthy"; }
  catch { return true; } // unsure: as before, to the app
};

// The API alone answers only these: anything else (bots looking for .env files and the like) is answered here, without
// waking the container (it is billed while awake).
const API_PATHS = /^\/(api\/|ads\.txt$|app-ads\.txt$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (env.CONTAINER_ROLE === "api" && !API_PATHS.test(path)) return new Response("Not found", { status: 404 });
    if (request.method === "POST" && path === PING && !(await awake(env)))
      return Response.json({ ok: true, asleep: true });
    return app(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
