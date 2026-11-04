import { beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
vi.mock("mongodb", async (orig) => ({
  ...(await orig<typeof import("mongodb")>()),
  MongoClient: class { connect = connect; },
}));

describe("the database connection", () => {
  beforeEach(() => { connect.mockReset(); delete (globalThis as { __mongo?: unknown }).__mongo; });

  it("tries again after a failed connection, so the server recovers without a restart", async () => {
    const { client } = await import("../../src/server/core/db");
    const good = { ok: true };
    connect.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce(good);
    await expect(client()).rejects.toThrow("network down");
    await expect(client()).resolves.toBe(good);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("keeps one connection once it works", async () => {
    const { client } = await import("../../src/server/core/db");
    connect.mockResolvedValue({ ok: true });
    await client(); await client();
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
