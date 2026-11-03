import { Container, getContainer } from "@cloudflare/containers";

/** One API container behind this Worker. It is intentionally allowed to sleep while nobody is using Shubix. */
interface Env {
  APP: DurableObjectNamespace<ReelApp>;
  SLEEP_AFTER?: string;
  CONTAINER_ROLE?: string;
  [key: string]: unknown;
}

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const RETRY_AFTER_SECONDS = "2";

/** Match only known proxy/container transport failures, never ordinary API 5xx responses. */
async function isContainerProxyFailure(response: Response): Promise<boolean> {
  if (response.status < 500) return false;
  const body = (await response.clone().text()).slice(0, 2048).trim();
  return /^(Error proxying request to container|Failed to start container|Container is not running|Container failed to start)/i.test(body)
    || /upstream connect error|connection refused|container unavailable/i.test(body);
}

function recovering(): Response {
  return Response.json(
    { error: "The API is restarting after a temporary interruption. Please retry shortly.", code: "API_CONTAINER_RECOVERING" },
    { status: 503, headers: { "Retry-After": RETRY_AFTER_SECONDS, "Cache-Control": "no-store" } },
  );
}

export class ReelApp extends Container<Env> {
  defaultPort = 3000;
  // Cost control: no cron/keep-alive. After this idle period Cloudflare stops the container.
  sleepAfter = "30s";

  constructor(ctx: ConstructorParameters<typeof Container<Env>>[0], env: Env) {
    super(ctx, env);
    if (typeof env.SLEEP_AFTER === "string" && env.SLEEP_AFTER) this.sleepAfter = env.SLEEP_AFTER;
    if (env.CONTAINER_ROLE === "api") this.defaultPort = 4000;
    this.envVars = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === "string"));
  }

  // "running" alone is not readiness. A container is ready only after its API port accepts connections.
  private ready = false;
  override onStop() { this.ready = false; }

  private async wake(signal?: AbortSignal): Promise<void> {
    let lastError: unknown;
    // A transient host/startup failure must not strand the API until a manual redeploy.
    // The original user request has NOT been forwarded yet, so retrying startup cannot duplicate work.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await this.startAndWaitForPorts(this.defaultPort, {
          portReadyTimeoutMS: 240_000,
          instanceGetTimeoutMS: 60_000,
          abort: signal,
        });
        this.ready = true;
        return;
      } catch (error) {
        this.ready = false;
        lastError = error;
        if (signal?.aborted) throw error;
        console.error("API container start/readiness attempt failed", { attempt: attempt + 1, error });
        // Clear a half-started or stale instance after every failed attempt, including the final one.
        // The next real request will then start from a clean stopped state instead of inheriting a wedged VM.
        try { await this.destroy(); } catch { /* it may already have stopped */ }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("API container did not become ready");
  }

  /** True only when this Durable Object has confirmed readiness for the current container start. */
  canHandlePresencePing(): boolean {
    return this.ready && this.ctx.container?.running === true;
  }

  private async resetContainer(): Promise<void> {
    this.ready = false;
    try { await this.destroy(); } catch { /* already stopped or being replaced */ }
  }

  private async retrySafeRequest(request: Request): Promise<Response> {
    try {
      await this.wake(request.signal);
      const response = await super.fetch(request);
      if (await isContainerProxyFailure(response)) {
        await this.resetContainer();
        return recovering();
      }
      return response;
    } catch (error) {
      await this.resetContainer();
      if (request.signal.aborted) throw error;
      console.error("API container recovery retry failed", error);
      return recovering();
    }
  }

  override async fetch(request: Request): Promise<Response> {
    // Only safe methods can be replayed after a proxy failure. POST/PUT/PATCH/DELETE may have
    // reached the API before the connection broke, so replaying them could duplicate payments/jobs.
    const retry = RETRYABLE_METHODS.has(request.method) ? request.clone() : null;

    if (!this.ready || !this.ctx.container?.running) {
      try {
        await this.wake(request.signal);
      } catch (error) {
        this.ready = false;
        if (request.signal.aborted) throw error;
        console.error("API container could not wake for incoming request", error);
        return recovering();
      }
    }

    let response: Response;
    try {
      response = await super.fetch(request);
    } catch (error) {
      await this.resetContainer();
      if (request.signal.aborted) throw error;
      console.error("API container proxy request failed", error);
      return retry ? this.retrySafeRequest(retry) : recovering();
    }

    if (!(await isContainerProxyFailure(response))) return response;

    await this.resetContainer();
    return retry ? this.retrySafeRequest(retry) : recovering();
  }

  override onError(error: unknown) {
    this.ready = false;
    console.error("API container lifecycle error", error);
    throw error;
  }
}

const app = (env: Env) => getContainer(env.APP, "main");

// Presence pings must never wake an idle container. Real API requests do wake it automatically.
const PING = "/api/public/ping";
const awake = async (env: Env) => {
  try {
    // Do not trust a stale "healthy" status: only this DO instance can confirm it has checked
    // the current container port. If not confirmed, answer the heartbeat at the edge.
    return await app(env).canHandlePresencePing();
  } catch {
    return false;
  }
};

const API_PATHS = /^\/(api\/|ads\.txt$|app-ads\.txt$)/;
const PROBE = /\/\.|\.(env|php|asp|aspx|jsp|cgi|bak|sql|ini|log|ya?ml)$/i;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if ((env.CONTAINER_ROLE === "api" && !API_PATHS.test(path)) || PROBE.test(path))
      return new Response("Not found", { status: 404 });

    // The app's 5-minute presence ping is answered at the edge if the container is asleep.
    // This avoids waking/billing a container just because a browser tab is still open.
    if (request.method === "POST" && path === PING && !(await awake(env)))
      return Response.json({ ok: true, asleep: true });

    return app(env).fetch(request);
  },
} satisfies ExportedHandler<Env>;
