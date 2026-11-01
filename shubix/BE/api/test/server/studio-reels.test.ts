// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MongoMemoryServer } from "mongodb-memory-server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// never the real bucket (this computer's .env may hold R2 keys): storage is the local folder here
vi.mock("@/server/storage/r2", async (orig) => ({ ...(await orig<typeof import("../../src/server/storage/r2")>()), r2Config: () => null }));

/** My Reels: a finished Reel saved from Fast Studio is kept for its owner only, complete or not at all, within the plan's
 * limit; it can be shared by a link and deleted (its file too). Here without R2: the file is kept in the storage folder. */

let mongo: MongoMemoryServer;
let R: typeof import("../../src/server/studio/reels");
let withUser: typeof import("../../src/server/core/auth").withUser;
let mainDb: typeof import("../../src/server/core/db").mainDb;
const storage = fs.mkdtempSync(path.join(os.tmpdir(), "reels-"));

beforeAll(async () => {
  mongo = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = "reels_test";
  process.env.STORAGE_PATH = storage;
  R = await import("../../src/server/studio/reels");
  ({ withUser } = await import("../../src/server/core/auth"));
  ({ mainDb } = await import("../../src/server/core/db"));
}, 120_000);

afterAll(async () => {
  const { client } = await import("../../src/server/core/db");
  await (await client()).close();
  await mongo?.stop();
  fs.rmSync(storage, { recursive: true, force: true });
});

beforeEach(async () => {
  await (await mainDb()).collection("studio_reels").deleteMany({});
});

const meta = (size: number) => ({ name: "Goa trip", size, type: "video/mp4" as const, dur: 14.5, width: 1080, height: 1920, fps: 30 });
const as = <T>(uid: string, fn: () => Promise<T>) => withUser(uid, fn);
const put = (bytes: Uint8Array) => new Request("http://x/file", { method: "PUT", body: bytes as BodyInit, duplex: "half" } as RequestInit);

async function save(uid: string, bytes: Uint8Array) {
  return as(uid, async () => {
    const s = await R.startReel(meta(bytes.length));
    expect(s.direct).toBe(false);
    await R.receiveFile(s.id, put(bytes));
    return R.completeReel(s.id, []);
  });
}

describe("My Reels", () => {
  it("keeps a saved Reel for its owner, with its file", async () => {
    const reel = await save("anna", new Uint8Array(5000).fill(7));
    expect(reel).toMatchObject({ name: "Goa trip", size: 5000, width: 1080, fps: 30, shared: false });
    const mine = await as("anna", () => R.listReels());
    expect(mine.reels.map((r) => r.id)).toEqual([reel.id]);
    expect(mine.usage).toMatchObject({ used: 1, limit: R.LIMITS.free, plan: "free" });
    expect((await as("bob", () => R.listReels())).reels).toEqual([]); // nobody else sees it
    const res = await as("anna", () => R.reelFile(new Request(`http://x/api/studio/reels/${reel.id}/file`), reel.id));
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBe(5000);
  });

  it("keeps nothing of a Reel that did not arrive complete", async () => {
    await expect(
      as("anna", async () => {
        const s = await R.startReel(meta(5000));
        await R.receiveFile(s.id, put(new Uint8Array(1200)));
        return R.completeReel(s.id, []);
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_INCOMPLETE" });
    expect(await (await mainDb()).collection("studio_reels").countDocuments({})).toBe(0);
  });

  it("refuses a file bigger than announced", async () => {
    await expect(
      as("anna", async () => {
        const s = await R.startReel(meta(100));
        return R.receiveFile(s.id, put(new Uint8Array(5000)));
      }),
    ).rejects.toMatchObject({ code: "UPLOAD_TOO_BIG" });
  });

  it("stops at the plan's limit with a clear message", async () => {
    const d = await mainDb();
    await d.collection("studio_reels").insertMany(
      Array.from({ length: R.LIMITS.free }, (_, i) => ({ ...meta(10), key: `reels/anna/${i}.mp4`, status: "ready", createdAt: new Date(), ownerId: "anna" })),
    );
    await expect(as("anna", () => R.startReel(meta(10)))).rejects.toMatchObject({ code: "REELS_FULL", status: 409 });
    await expect(as("bob", () => R.startReel(meta(10)))).resolves.toMatchObject({ direct: false }); // another person's space is their own
  });

  it("shares by a link anyone can open, until it is turned off", async () => {
    const reel = await save("anna", new Uint8Array(800).fill(1));
    const on = await as("anna", () => R.shareReel(reel.id, true));
    expect(on.shareUrl).toMatch(/^\/api\/public\/studio-reels\/[\w-]{20,40}$/);
    const token = on.shareUrl!.split("/").pop()!;
    expect((await R.publicReel(new Request("http://x/p"), token)).status).toBe(200); // no account needed
    await as("anna", () => R.shareReel(reel.id, false));
    await expect(R.publicReel(new Request("http://x/p"), token)).rejects.toMatchObject({ code: "REEL_NOT_FOUND" });
  });

  it("deletes the Reel and its file", async () => {
    const reel = await save("anna", new Uint8Array(300).fill(2));
    const doc = await (await mainDb()).collection("studio_reels").findOne({});
    const file = path.join(storage, String(doc!.key));
    expect(fs.existsSync(file)).toBe(true);
    await expect(as("bob", () => R.deleteReel(reel.id))).rejects.toMatchObject({ code: "REEL_NOT_FOUND" }); // not someone else
    await as("anna", () => R.deleteReel(reel.id));
    expect(fs.existsSync(file)).toBe(false);
    expect((await as("anna", () => R.listReels())).reels).toEqual([]);
  });
});
