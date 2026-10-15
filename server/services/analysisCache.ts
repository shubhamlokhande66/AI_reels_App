import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { localPath, mediaPath } from "@/server/storage/local";

/** The shared analysis cache (was backend/app/services/analysis_cache.py): a clip or song analysed once is never
 * analysed again, in any project - keyed by a hash of the file's content plus the analysis version. Same files
 * (storage/shared/analysis/<digest>/<kind>_v<version>.json) as the Python backend. */

const ROOT = "shared/analysis";
const hashes = new Map<string, string>();

export async function contentHash(key: string): Promise<string | null> {
  let file: string, st: fs.Stats;
  try {
    file = await mediaPath(key); // hashed from the local disk, not read back over the network
    st = await fs.promises.stat(file);
  } catch {
    return null;
  }
  const memo = `${file}|${st.size}|${st.mtimeMs}`;
  const hit = hashes.get(memo);
  if (hit) return hit;
  const digest = await new Promise<string>((resolve, reject) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(file).on("data", (c) => h.update(c)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
  });
  hashes.set(memo, digest);
  return digest;
}

const keyOf = (digest: string, kind: string, version: string | number) => `${ROOT}/${digest.slice(0, 40)}/${kind}_v${String(version).replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80)}.json`;

export function load<T = unknown>(digest: string | null, kind: string, version: string | number): T | null {
  if (!digest) return null;
  try {
    return JSON.parse(fs.readFileSync(localPath(keyOf(digest, kind, version)), "utf8")) as T;
  } catch {
    return null;
  }
}

export function save(digest: string | null, kind: string, version: string | number, doc: unknown) {
  if (!digest) return;
  try {
    const file = localPath(keyOf(digest, kind, version));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc));
  } catch (e) {
    console.info("shared analysis not cached:", e); // a cache that cannot be written only costs speed
  }
}

/** Every shared entry of a stored file (privacy: the person deleted their uploads). */
export async function forget(key: string) {
  const digest = await contentHash(key);
  if (digest) fs.rmSync(localPath(`${ROOT}/${digest.slice(0, 40)}`), { recursive: true, force: true });
}
