import "server-only";
import { MongoClient, ObjectId, type Collection, type Db, type Document } from "mongodb";
import { currentUser } from "./auth";
import { NotFoundError } from "./errors";
import { settings } from "./config";

/** MongoDB: one client for the whole server (kept on globalThis so a dev reload does not open a new pool each time).
 * The same database and collections as the Python backend (backend/app/core/database.py). With accounts on, `db()` is
 * the signed-in user's view: every query is limited to their documents (ownerId) and every insert is stamped with it,
 * so one user can never read another's data; `mainDb()` is the whole database (accounts, housekeeping). */

const g = globalThis as unknown as { __mongo?: Promise<MongoClient> };
export const OWNER = "ownerId";
export const UNSCOPED = new Set(["users", "app_settings", "wallets", "credit_ledger", "payments", "presence"]);

export function client(): Promise<MongoClient> {
  g.__mongo ??= new MongoClient(settings.mongodbUri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20 }).connect();
  return g.__mongo;
}
export async function mainDb(): Promise<Db> {
  return (await client()).db(settings.mongodbDb);
}
/** The database for the current request or job: the signed-in user's view (accounts on), else the whole one. */
export async function db(): Promise<Db> {
  const d = await mainDb(), uid = currentUser();
  return uid ? scopedDb(d, uid) : d;
}

const FILTERED = new Set(["find", "findOne", "countDocuments", "distinct", "updateOne", "updateMany", "deleteOne", "deleteMany", "findOneAndUpdate", "findOneAndDelete"]);
const BLOCKED = new Set(["findOneAndReplace", "bulkWrite", "watch", "estimatedDocumentCount", "drop"]);
function scopedCollection<T extends Document>(col: Collection<T>, owner: string): Collection<T> {
  const f = (flt: unknown) => ({ ...((flt as object) ?? {}), [OWNER]: owner });
  const stamp = (doc: Record<string, unknown>) => { doc[OWNER] = owner; return doc; }; // in place: the driver fills in _id in place too
  return new Proxy(col, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof prop !== "string" || typeof v !== "function") return v;
      if (BLOCKED.has(prop)) return () => { throw new Error(`${prop} is not available on a user's view of the database`); };
      if (prop === "distinct") return (key: string, flt?: unknown, ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(target, key, f(flt), ...rest);
      if (FILTERED.has(prop)) return (flt?: unknown, ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(target, f(flt), ...rest);
      if (prop === "insertOne") return (doc: Record<string, unknown>, ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(target, stamp(doc), ...rest);
      if (prop === "insertMany") return (docs: Record<string, unknown>[], ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(target, docs.map(stamp), ...rest);
      if (prop === "replaceOne") return (flt: unknown, doc: Record<string, unknown>, ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(target, f(flt), stamp(doc), ...rest);
      if (prop === "aggregate") return (pipeline: unknown[] = [], ...rest: unknown[]) => (v as (...a: unknown[]) => unknown).call(target, [{ $match: { [OWNER]: owner } }, ...pipeline], ...rest);
      return v.bind(target);
    },
  });
}
function scopedDb(d: Db, owner: string): Db {
  return new Proxy(d, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (prop === "collection") return (name: string, ...rest: unknown[]) => { const col = (v as (...a: unknown[]) => Collection).call(target, name, ...rest); return UNSCOPED.has(name) ? col : scopedCollection(col, owner); };
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

const HEX24 = /^[0-9a-f]{24}$/;

/** An id from the URL: unknown or malformed ids are a 404, never a 500 (like services/ids.py). */
export function parseId(value: string, what = "Resource"): ObjectId {
  if (typeof value !== "string" || !HEX24.test(value)) throw new NotFoundError(`${what} not found.`, { code: `${what.toUpperCase()}_NOT_FOUND` });
  return new ObjectId(value);
}

export { ObjectId };
