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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return app(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
