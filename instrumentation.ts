/** Server start-up (Next.js calls `register` once per server): the background work that runs for the life of the
 * server - the job queue (MongoDB) is polled for waiting and stalled jobs (server/jobs/manager.ts), the auto-delete sweep
 * runs every 10 minutes, and scheduled posts are published when their time comes. On Cloudflare (KEEP_ALIVE_URL set) the
 * app also pings itself through the Worker while a job runs, so the container does not sleep in the middle of a render. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ hasWork, pump, recoverStaleJobs, runsJobs }, { startRetention }, { startScheduler }, { settings }] = await Promise.all([
    import("@/server/jobs/manager"), import("@/server/workspace"), import("@/server/publish"), import("@/server/core/config"),
  ]);
  void import("@/server/core/indexes").then((m) => m.ensureIndexes()).catch((e) => console.warn("database indexes:", e)); // once per server
  recoverStaleJobs().catch((e) => console.warn("recovering interrupted jobs:", e));
  if (runsJobs()) {
    // the job queue lives in MongoDB: take waiting jobs (also ones another instance started) and requeue stalled ones
    const every = Math.max(Number(process.env.JOB_POLL_SECONDS ?? 5), 1) * 1000;
    setInterval(() => { void recoverStaleJobs().catch(() => {}); void pump(); }, every).unref?.();
  }
  startRetention();
  startScheduler();
  if (settings.keepAliveUrl) {
    setInterval(() => {
      void hasWork().then((busy) => { if (busy) return fetch(settings.keepAliveUrl, { signal: AbortSignal.timeout(20_000) }); }).catch(() => {});
    }, 10_000).unref?.(); // well inside SLEEP_AFTER (30 s on Cloudflare)
  }
}
