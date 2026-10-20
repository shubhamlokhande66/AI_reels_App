// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/** My Reels: a saved Reel is removed once it is older than its owner's plan keeps (0 = kept until deleted). */
const DAY = 86400_000, NOW = Date.UTC(2026, 9, 20);
const state = vi.hoisted(() => ({ keep: {} as Record<string, number>, reels: [] as Record<string, unknown>[], deleted: [] as string[], files: [] as string[], plans: {} as Record<string, string> }));
vi.mock("@/server/core/db", async () => {
  const { ObjectId } = await import("mongodb");
  const reels = {
    find: (f: { createdAt: { $lt: Date } }) => ({ sort: () => ({ limit: () => ({ toArray: async () => state.reels.filter((r) => (r.createdAt as Date) < f.createdAt.$lt) }) }) }),
    deleteOne: async (f: { _id: string }) => { state.deleted.push(f._id); },
  };
  const settings = { findOne: async () => ({ days: state.keep }), updateOne: async (_f: unknown, u: { $set: { days: Record<string, number> } }) => { state.keep = u.$set.days; } };
  const mainDb = async () => ({ collection: (n: string) => (n === "studio_reels" ? reels : settings) });
  return { mainDb, db: mainDb, ObjectId, OWNER: "ownerId", parseId: (x: string) => x };
});
vi.mock("@/server/storage/r2", () => ({ r2Config: () => ({}), deleteObject: async (_c: unknown, key: string) => { state.files.push(key); },
  abortMultipart: vi.fn(), completeMultipart: vi.fn(), objectSize: vi.fn(), objectUrl: vi.fn(), partSizeFor: vi.fn(), partUrls: vi.fn(), startMultipart: vi.fn() }));
vi.mock("@/server/credits", () => ({ enabled: () => true, wallet: async (uid: string) => ({ plan: state.plans[uid] ?? "free" }) }));

const reel = (id: string, owner: string, daysOld: number) => ({ _id: id, ownerId: owner, key: `reels/${owner}/${id}.mp4`, status: "ready", createdAt: new Date(NOW - daysOld * DAY) });

describe("My Reels keep days", () => {
  it("removes only what is older than its owner's plan keeps; 0 keeps forever; at most once per 6 hours", async () => {
    const { sweepOld, setKeepDays } = await import("@/server/studio/reels");
    state.plans = { u1: "free", u2: "pro", u3: "creator" };
    state.reels = [reel("a", "u1", 40), reel("b", "u1", 10), reel("c", "u2", 100), reel("d", "u2", 400), reel("e", "u3", 999)];
    await setKeepDays({ free: 30, creator: 0, pro: 365, business: 0 });
    expect(await sweepOld(NOW)).toBe(2);
    expect(state.deleted.sort()).toEqual(["a", "d"]);           // free: 40 days > 30; pro: 400 > 365; creator 0 = forever
    expect(state.files.sort()).toEqual(["reels/u1/a.mp4", "reels/u2/d.mp4"]);
    expect(await sweepOld(NOW + 3600_000)).toBe(0);             // not again within 6 hours
  });
  it("nothing to do when every plan keeps forever", async () => {
    const { sweepOld, setKeepDays } = await import("@/server/studio/reels");
    state.deleted = [];
    await setKeepDays({ free: 0, creator: 0, pro: 0, business: 0 });
    expect(await sweepOld(NOW + 7 * 3600_000)).toBe(0);
    expect(state.deleted).toEqual([]);
  });
});
