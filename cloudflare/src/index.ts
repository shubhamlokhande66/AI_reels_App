import { Container, getContainer } from "@cloudflare/containers";

/** Reel Maker on Cloudflare: this Worker passes every request to ONE app container (the Next.js server, FFmpeg included;
 * one instance, because the job queue lives in it). The container sleeps after SLEEP_AFTER without requests; while a
 * job runs, the app pings itself (KEEP_ALIVE_URL) so it stays awake. The cron trigger runs the auto-delete sweep and the
 * scheduled posts (/api/cron). Uploads and Reels are kept in R2: docker/start.sh mounts the bucket in the container. */

interface Env {
  APP: DurableObjectNamespace<ReelApp>;
  CRON_SECRET: string;
  SLEEP_AFTER?: string;
  [key: string]: unknown;
}

export class ReelApp extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "15m";
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return app(env).fetch(request);
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(app(env).fetch(new Request("http://app/api/cron", { method: "POST", headers: { "x-cron-key": env.CRON_SECRET } })).then(async (r) => {
      if (!r.ok) console.warn("cron:", r.status, (await r.text()).slice(0, 300));
    }));
  },
} satisfies ExportedHandler<Env>;
