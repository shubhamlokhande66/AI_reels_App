// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

/** Vercel: the AI settings and brand logos survive a new server copy (kept in the database, put back on its disk). */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbfiles-"));
const docs = vi.hoisted(() => new Map<string, { _id: string; data: { buffer: Uint8Array }; at: Date; gone?: boolean }>());
vi.mock("@/server/storage/local", () => ({ localPath: (k: string) => path.join(dir, k) }));
vi.mock("@/server/core/db", () => ({
  mainDb: async () => ({ collection: () => ({
    find: (q: { at: { $gt: Date } }) => [...docs.values()].filter((d) => d.at > q.at.$gt),
    updateOne: async (f: { _id: string }, u: { $set: { data: { buffer: Uint8Array }; at: Date } }) => { docs.set(f._id, { _id: f._id, data: u.$set.data, at: u.$set.at }); },
    updateMany: async (f: { _id: string | { $regex: string } }, u: { $set: { gone: boolean; at: Date } }) => {
      for (const d of docs.values()) if (typeof f._id === "string" ? d._id === f._id : new RegExp(f._id.$regex).test(d._id)) Object.assign(d, u.$set);
    },
  }) }),
}));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("files kept in the database", () => {
  it("keeps settings and logos, puts them back on a fresh disk, forgets deleted ones", async () => {
    process.env.VERCEL = "1";
    const { keepFile, forgetFiles, restoreFiles } = await import("@/server/storage/dbFiles");
    const put = (k: string, v: string) => { fs.mkdirSync(path.dirname(path.join(dir, k)), { recursive: true }); fs.writeFileSync(path.join(dir, k), v); };
    put("settings/ai_config.json", '{"provider":"claude"}'); await keepFile("settings/ai_config.json");
    put("brands/b1/logo.png", "PNG"); await keepFile("brands/b1/logo.png");
    put("cache/x.json", "{}"); await keepFile("cache/x.json");               // not a kept file
    expect([...docs.keys()].sort()).toEqual(["brands/b1/logo.png", "settings/ai_config.json"]);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);       // a new server copy: an empty disk
    await restoreFiles();
    expect(fs.readFileSync(path.join(dir, "settings/ai_config.json"), "utf8")).toBe('{"provider":"claude"}');
    expect(fs.readFileSync(path.join(dir, "brands/b1/logo.png"), "utf8")).toBe("PNG");
    await forgetFiles("brands/b1/");
    expect(docs.get("brands/b1/logo.png")?.gone).toBe(true);
    delete process.env.VERCEL;
  });
});
