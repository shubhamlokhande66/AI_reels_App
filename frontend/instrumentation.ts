/** Server start-up (Next.js calls `register` once per server): the background work that runs for the life of the
 * server - jobs left "processing" by an earlier run are failed cleanly (their credits come back), the auto-delete sweep
 * runs every 10 minutes, and scheduled posts are published when their time comes. On Cloudflare (KEEP_ALIVE_URL set) the
 * app also pings itself through the Worker while a job runs, so the container does not sleep in the middle of a render. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ busyJobs, recoverStaleJobs }, { startRetention }, { startScheduler }, { settings }] = await Promise.all([
    import("@/server/jobs/manager"), import("@/server/workspace"), import("@/server/publish"), import("@/server/core/config"),
  ]);
  recoverStaleJobs().catch((e) => console.warn("recovering interrupted jobs:", e));
  startRetention();
  startScheduler();
  if (settings.keepAliveUrl) {
    setInterval(() => {
      if (busyJobs() > 0) fetch(settings.keepAliveUrl, { signal: AbortSignal.timeout(20_000) }).catch(() => {});
    }, 10_000).unref?.(); // well inside SLEEP_AFTER (30 s on Cloudflare)
  }
}
