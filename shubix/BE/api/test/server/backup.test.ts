// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { BSON, ObjectId } from "mongodb";

/** The backup: every collection but the visits, one document per line, ObjectIds and dates kept exactly. */
const id = new ObjectId(), at = new Date("2026-10-20T10:00:00Z");
const data: Record<string, BSON.Document[]> = { users: [{ _id: id, email: "a@b.c", createdAt: at }], wallets: [{ _id: "u1", extra: 25 }], presence: [{ _id: "v", at }] };
vi.mock("@/server/core/db", () => ({ mainDb: async () => ({
  listCollections: () => ({ toArray: async () => Object.keys(data).map((name) => ({ name })) }),
  collection: (n: string) => ({ find: () => { let k = 0; return { next: async () => data[n][k++] ?? null, close: async () => {} }; } }),
}) }));

describe("database backup", () => {
  it("streams a header, then each document, without the visits", async () => {
    const { backupStream } = await import("../../src/server/backup");
    const text = await new Response(await backupStream(at)).text();
    const lines = text.trim().split("\n").map((l) => BSON.EJSON.parse(l, { relaxed: false }));
    expect(lines[0]).toMatchObject({ backup: "shubix", collections: ["users", "wallets"] });
    expect(lines.slice(1).map((l) => l.c)).toEqual(["users", "wallets"]);
    expect(lines[1].d._id).toBeInstanceOf(ObjectId);
    expect(String(lines[1].d._id)).toBe(String(id));
    expect(lines[1].d.createdAt).toBeInstanceOf(Date);
    expect(lines[2].d).toEqual({ _id: "u1", extra: new BSON.Int32(25) });
  });
});
