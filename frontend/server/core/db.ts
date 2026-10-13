import "server-only";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { NotFoundError } from "./errors";
import { settings } from "./config";

/** MongoDB: one client for the whole server (kept on globalThis so a dev reload does not open a new pool each time).
 * The same database and collections as the Python backend (backend/app/core/database.py). */

const g = globalThis as unknown as { __mongo?: Promise<MongoClient> };

export function client(): Promise<MongoClient> {
  g.__mongo ??= new MongoClient(settings.mongodbUri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 }).connect();
  return g.__mongo;
}

export async function db(): Promise<Db> {
  return (await client()).db(settings.mongodbDb);
}

const HEX24 = /^[0-9a-f]{24}$/;

/** An id from the URL: unknown or malformed ids are a 404, never a 500 (like services/ids.py). */
export function parseId(value: string, what = "Resource"): ObjectId {
  if (typeof value !== "string" || !HEX24.test(value)) throw new NotFoundError(`${what} not found.`, { code: `${what.toUpperCase()}_NOT_FOUND` });
  return new ObjectId(value);
}

export { ObjectId };
