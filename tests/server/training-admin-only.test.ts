// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

/** Only the administrator teaches Shubix: making or changing a trend and saving a style are refused for everyone else
 * (the pages hide them too); reading them (to make Reels) and offering a copied Reel stay open. */
vi.mock("@/server/core/config", async (orig) => {
  const m = await orig<typeof import("@/server/core/config")>();
  return { ...m, settings: { ...m.settings, authEnabled: false, adminKey: "the-admin-key", adminEmails: "" } };
});
vi.mock("@/server/trends/references", () => ({
  listReferences: async () => [], createReference: async () => ({ id: "t" }), updateReference: async () => ({}), deleteReference: async () => undefined,
  addVideos: async () => ({}), removeVideo: async () => ({}),
}));
vi.mock("@/server/studio/styles", async (orig) => ({ ...(await orig<typeof import("@/server/studio/styles")>()), saveStyle: async () => ({ id: "s" }), suggestStyle: async () => ({ ok: true }), listSuggestions: async () => ({ items: [], total: 0 }) }));

const req = (url: string, method: string, admin: boolean, body?: unknown) =>
  new Request("http://x" + url, { method, headers: { "content-type": "application/json", ...(admin ? { "x-admin-key": "the-admin-key" } : {}) }, body: body ? JSON.stringify(body) : undefined });
const ctx = (p: Record<string, string> = {}) => ({ params: Promise.resolve(p) });

describe("training is the administrator's", () => {
  it("refuses a user and lets the administrator in", async () => {
    const refs = await import("@/app/api/references/route");
    const ref = await import("@/app/api/references/[refId]/route");
    const vids = await import("@/app/api/references/[refId]/videos/route");
    const vid = await import("@/app/api/references/[refId]/videos/[index]/route");
    const styles = await import("@/app/api/studio/styles/route");
    const sugg = await import("@/app/api/admin/style-suggestions/route");
    const id = "0123456789abcdef01234567";
    const calls: [string, (admin: boolean) => Promise<Response>][] = [
      ["new trend", (a) => refs.POST(req("/api/references", "POST", a), ctx() as never)],
      ["rename trend", (a) => ref.PATCH(req(`/api/references/${id}`, "PATCH", a, { name: "x" }), ctx({ refId: id }) as never)],
      ["delete trend", (a) => ref.DELETE(req(`/api/references/${id}`, "DELETE", a), ctx({ refId: id }) as never)],
      ["add Reels", (a) => vids.POST(req(`/api/references/${id}/videos`, "POST", a), ctx({ refId: id }) as never)],
      ["remove a Reel", (a) => vid.DELETE(req(`/api/references/${id}/videos/0`, "DELETE", a), ctx({ refId: id, index: "0" }) as never)],
      ["save a style", (a) => styles.POST(req("/api/studio/styles", "POST", a, { name: "x", category: "dance", fp: { dur: 15, bpm: 120, medianBeats: 1, medianSec: 0.5, hookBeats: 2, hookSec: 1, onBeat: 0.9, energy: "steady", zoomShare: 0.3, trans: {} } }), ctx() as never)],
      ["list users' Reels", (a) => sugg.GET(req("/api/admin/style-suggestions", "GET", a), ctx() as never)],
    ];
    for (const [what, call] of calls) {
      expect((await call(false)).status, what + " (user)").toBe(403);
      expect((await call(true)).status, what + " (admin)").toBeLessThan(300);
    }
    expect((await refs.GET(req("/api/references", "GET", false), ctx() as never)).status).toBeLessThan(300);   // reading stays open
  });
});
