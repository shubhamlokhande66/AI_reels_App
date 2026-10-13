/** Server start-up (Next.js calls `register` once per server): the background work that runs for the life of the
 * server - jobs left "processing" by an earlier run are failed cleanly (their credits come back), the auto-delete sweep
 * runs every 10 minutes, and scheduled posts are published when their time comes. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ recoverStaleJobs }, { startRetention }, { startScheduler }] = await Promise.all([
    import("@/server/jobs/manager"), import("@/server/workspace"), import("@/server/publish"),
  ]);
  recoverStaleJobs().catch((e) => console.warn("recovering interrupted jobs:", e));
  startRetention();
  startScheduler();
}
