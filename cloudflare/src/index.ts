import { Container, getContainer } from "@cloudflare/containers";

/** Reel Maker on Cloudflare: this Worker passes every request to ONE app container (the Next.js server, FFmpeg included).
 * The container sleeps after SLEEP_AFTER without requests. Reels saved to My Reels are kept in R2: docker/start.sh mounts
 * the bucket in the container. */

interface Env {
  APP: DurableObjectNamespace<ReelApp>;
  SLEEP_AFTER?: string;
  [key: string]: unknown;
}

export class ReelApp extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "30s";
  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    if (typeof env.SLEEP_AFTER === "string" && env.SLEEP_AFTER) this.sleepAfter = env.SLEEP_AFTER;
    // every setting (vars and secrets) goes to the app as an environment variable; bindings are not strings
    this.envVars = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "POST" && new URL(request.url).pathname === PING && !(await awake(env)))
      return Response.json({ ok: true, asleep: true });
    return app(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
