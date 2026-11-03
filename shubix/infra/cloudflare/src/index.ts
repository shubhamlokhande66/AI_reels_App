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

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRY_AFTER_SECONDS = "2";

/** Only treat known container/proxy transport failures as a dead container; ordinary application 5xx responses
 * must pass through untouched. */
async function isContainerProxyFailure(response: Response): Promise<boolean> {
  if (response.status < 500) return false;
  const body = (await response.clone().text()).slice(0, 2048);
  return /^(Error proxying request to container|Failed to start container|Container is not running|Container failed to start)/i.test(body.trim())
    || /upstream connect error|connection refused|container unavailable/i.test(body);
}

function unavailable(): Response {
  return Response.json(
    { error: "The API is waking up after a temporary interruption. Please retry shortly.", code: "API_CONTAINER_RECOVERING" },
    { status: 503, headers: { "Retry-After": RETRY_AFTER_SECONDS, "Cache-Control": "no-store" } },
  );
}

export class ReelApp extends Container<Env> {
  defaultPort = 3000;
  sleepAfter = "30s";
  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    if (typeof env.SLEEP_AFTER === "string" && env.SLEEP_AFTER) this.sleepAfter = env.SLEEP_AFTER;
    if (env.CONTAINER_ROLE === "api") this.defaultPort = 4000; // the API alone (the website is on Vercel)
    // every setting (vars and secrets) goes to the app as an environment variable; bindings are not strings
    this.envVars = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
  }

  // A cold start includes the machine, R2 mount and API bootstrap. Wait for the actual listening port, not only
  // the container state: a stale "healthy" state can outlive the process that previously answered requests.
  private ready = false;
  override onStop() { this.ready = false; }

  private wake(signal?: AbortSignal) {
    return this.startAndWaitForPorts(this.defaultPort, {
      portReadyTimeoutMS: 240_000,
      instanceGetTimeoutMS: 60_000,
      abort: signal,
    });
  }

  private async resetContainer() {
    this.ready = false;
    try { await this.destroy(); } catch { /* it may already have stopped */ }
  }

  override async fetch(request: Request): Promise<Response> {
    // Replaying a POST/PUT/PATCH/DELETE can duplicate payments, credits or AI jobs. Only retry safe methods.
    const retry = RETRYABLE_METHODS.has(request.method) ? request.clone() : null;

    if (!this.ready || !this.ctx.container?.running) {
      try {
        await this.wake(request.signal);
        this.ready = true;
      } catch (error) {
        this.ready = false;
        if (request.signal.aborted) throw error;
        console.error("API container wake failed", error);
        return unavailable();
      }
    }

    let response: Response;
    try {
      response = await super.fetch(request);
    } catch (error) {
      await this.resetContainer();
      if (request.signal.aborted) throw error;
      console.error("API container proxy request failed", error);
      if (!retry) return unavailable();

      try {
        await this.wake(retry.signal);
        this.ready = true;
        const retried = await super.fetch(retry);
        if (await isContainerProxyFailure(retried)) await this.resetContainer();
        return retried;
      } catch (retryError) {
        await this.resetContainer();
        if (retry.signal.aborted) throw retryError;
        console.error("API container retry failed", retryError);
        return unavailable();
      }
    }

    if (!(await isContainerProxyFailure(response))) return response;

    await this.resetContainer();
    // Never replay a non-idempotent request: the container may have processed it before the proxy failed.
    if (!retry) return unavailable();

    try {
      await this.wake(retry.signal);
      this.ready = true;
      const retried = await super.fetch(retry);
      if (await isContainerProxyFailure(retried)) await this.resetContainer();
      return retried;
    } catch (error) {
      await this.resetContainer();
      if (retry.signal.aborted) throw error;
      console.error("API container recovery retry failed", error);
      return unavailable();
    }
  }

  override onError(error: unknown) {
    this.ready = false;
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
// bots looking for secrets under /api too (/api/.env, /api/v1/.git/config, /api/x.php): no real route has a part starting
// with a dot or ends like that
const PROBE = /\/\.|\.(env|php|asp|aspx|jsp|cgi|bak|sql|ini|log|ya?ml)$/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if ((env.CONTAINER_ROLE === "api" && !API_PATHS.test(path)) || PROBE.test(path)) return new Response("Not found", { status: 404 });
    if (request.method === "POST" && path === PING && !(await awake(env)))
      return Response.json({ ok: true, asleep: true });
    return app(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
