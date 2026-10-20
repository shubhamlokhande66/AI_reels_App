// Put a backup from Admin → Settings → Backup (server/backup.ts) back into a MongoDB database.
//   MONGODB_URI="mongodb+srv://..." MONGODB_DB=reel_maker node scripts/restore-backup.mjs shubix-backup-2026-10-20.ndjson
//   add --replace to overwrite documents that are already there (by default they are kept and skipped)
// Run it from the repo root (it uses the app's mongodb package). Reads the file line by line, inserts 500 at a time.
import fs from "node:fs";
import readline from "node:readline";
import { BSON, MongoClient } from "mongodb";

const file = process.argv[2], replace = process.argv.includes("--replace");
const uri = process.env.MONGODB_URI, dbName = process.env.MONGODB_DB || "reel_maker";
if (!file || !uri) { console.error("usage: MONGODB_URI=... [MONGODB_DB=...] node scripts/restore-backup.mjs <backup.ndjson> [--replace]"); process.exit(1); }

const client = await new MongoClient(uri).connect(), db = client.db(dbName);
const batches = new Map(), counts = {};
let first = true, skipped = 0;
const flush = async (c) => {
  const docs = batches.get(c); if (!docs?.length) return; batches.set(c, []);
  if (replace) { for (const d of docs) await db.collection(c).replaceOne({ _id: d._id }, d, { upsert: true }); counts[c] = (counts[c] || 0) + docs.length; return; }
  try { const r = await db.collection(c).insertMany(docs, { ordered: false }); counts[c] = (counts[c] || 0) + r.insertedCount; }
  catch (e) { const n = e?.result?.insertedCount ?? e?.insertedCount ?? 0; counts[c] = (counts[c] || 0) + n; skipped += docs.length - n; if (e?.code !== 11000 && !e?.writeErrors) throw e; }
};
for await (const text of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
  if (!text.trim()) continue;
  const o = BSON.EJSON.parse(text, { relaxed: false });
  if (first) { first = false; if (o.backup !== "shubix") throw new Error("This is not a Shubix backup."); console.log(`backup of ${new Date(o.at).toISOString()}: ${o.collections.length} collections`); continue; }
  if (!batches.has(o.c)) batches.set(o.c, []);
  batches.get(o.c).push(o.d);
  if (batches.get(o.c).length >= 500) await flush(o.c);
}
for (const c of batches.keys()) await flush(c);
await client.close();
for (const [c, n] of Object.entries(counts)) console.log(`  ${c}: ${n}`);
if (skipped) console.log(`${skipped} documents were already there and were kept (--replace overwrites them)`);
