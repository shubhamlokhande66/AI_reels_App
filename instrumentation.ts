/** Server start-up (Next.js calls `register` once per server): the database's indexes are made (server/core/indexes.ts).
 * Reels are made on the phone, so there is no job queue, render or scheduler running here. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // a host without a lasting disk (Vercel): the AI settings and brand logos come back from the database first
  await import("@/server/storage/dbFiles").then((m) => m.restoreFiles()).catch((e) => console.warn("kept files:", e));
  void import("@/server/core/indexes").then((m) => m.ensureIndexes()).catch((e) => console.warn("database indexes:", e)); // once per server
}
