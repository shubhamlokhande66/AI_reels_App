import "server-only";
import { mainDb, OWNER } from "./db";

/** The database's indexes, made once when the server starts (instrumentation.ts); making one that is there already
 * does nothing. Without them every look-up by user reads a whole collection; and two sign-ups at the same moment could both get the same email. A failure is logged, never fatal
 * (for example old duplicate emails: the unique index waits until they are cleaned up). */
const INDEXES: [collection: string, keys: Record<string, 1 | -1>, options?: { unique?: boolean; name?: string }][] = [
  ["users", { email: 1 }, { unique: true, name: "email_unique" }],
  ["payments", { userId: 1, createdAt: -1 }],
  ["payments", { status: 1, paidAt: -1 }],
  ["credit_ledger", { userId: 1, at: -1 }],
  ["credit_ledger", { ref: 1 }],
  ["studio_reels", { [OWNER]: 1, status: 1, createdAt: -1 }],
  ["studio_reels", { shareToken: 1 }],
  ["presence", { uid: 1, at: -1 }],
];

export async function ensureIndexes() {
  const d = await mainDb();
  await Promise.all(
    INDEXES.map(([name, keys, options]) =>
      d.collection(name).createIndex(keys, options ?? {}).catch((e: Error) => console.warn(`index on ${name} (${Object.keys(keys).join(", ")}) not made: ${e.message}`)),
    ),
  );
}
