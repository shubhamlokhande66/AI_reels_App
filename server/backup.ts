import "server-only";
import { BSON } from "mongodb";
import { mainDb } from "@/server/core/db";

/** Admin → Settings → Backup: the whole database as one file, for MongoDB's free tier (M0), which keeps no backups.
 * NDJSON: a first line { backup, at, collections }, then one line per document { c: collection, d: document } in
 * MongoDB's Extended JSON (ObjectIds, dates and numbers come back exactly). Streamed: the server never holds it all.
 * Put back with scripts/restore-backup.mjs. Visits ("presence", kept 30 days, rebuilt by people visiting) are left out. */
export const SKIP = new Set(["presence"]);
const line = (o: unknown) => new TextEncoder().encode(BSON.EJSON.stringify(o as BSON.Document, { relaxed: false }) + "\n");

export async function backupStream(now = new Date()): Promise<ReadableStream<Uint8Array>> {
  const d = await mainDb();
  const names = (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).filter((n) => !SKIP.has(n) && !n.startsWith("system.")).sort();
  let i = 0, cursor: ReturnType<ReturnType<typeof d.collection>["find"]> | null = null;
  return new ReadableStream<Uint8Array>({
    start(ctl) { ctl.enqueue(line({ backup: "shubix", version: 1, at: now, collections: names })); },
    async pull(ctl) {
      for (;;) {
        if (!cursor) { if (i >= names.length) { ctl.close(); return; } cursor = d.collection(names[i]).find({}); }
        const doc = await cursor.next();
        if (doc) { ctl.enqueue(line({ c: names[i], d: doc })); return; }
        await cursor.close(); cursor = null; i++;
      }
    },
    async cancel() { await cursor?.close(); },
  });
}
