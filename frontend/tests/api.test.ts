import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, assetUrl, errorMessage } from "@/lib/api";

afterEach(() => vi.unstubAllGlobals());

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })));
}

describe("api client", () => {
  it("returns parsed JSON", async () => {
    mockFetch(200, [{ id: "1" }]);
    expect(await api.listProjects()).toEqual([{ id: "1" }]);
  });

  it("turns backend errors into ApiError with code and details", async () => {
    mockFetch(422, { error: { code: "NO_AUDIO", message: "Upload a music file first.", details: null } });
    const err = await api.generate("abc").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe("NO_AUDIO");
    expect(err.status).toBe(422);
    expect(errorMessage(err)).toBe("Upload a music file first.");
  });

  it("handles non-JSON error responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    const err = await api.getProject("x").catch((e) => e);
    expect(err.code).toBe("HTTP_ERROR");
    expect(err.message).toContain("502");
  });

  it("reports an unreachable server clearly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    const err = await api.health().catch((e) => e);
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).toMatch(/backend/i);
  });

  it("handles 204 responses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.deleteProject("x")).resolves.toBeUndefined();
  });

  it("builds absolute asset URLs", () => {
    expect(assetUrl("/api/x")).toMatch(/^http.*\/api\/x$/);
    expect(assetUrl("https://cdn/x.mp4")).toBe("https://cdn/x.mp4");
    expect(assetUrl(null)).toBeUndefined();
  });
});

import { resolveApiUrl } from "@/lib/api";

describe("resolveApiUrl (phone mode)", () => {
  it("keeps localhost when the page is opened on the computer itself", () => {
    expect(resolveApiUrl("http://localhost:8000", "localhost")).toBe("http://localhost:8000");
    expect(resolveApiUrl("http://localhost:8000/", "127.0.0.1")).toBe("http://localhost:8000");
    expect(resolveApiUrl("http://localhost:8000", undefined)).toBe("http://localhost:8000"); // server-side render
  });
  it("uses the computer's network address when the page came through it (a phone)", () => {
    expect(resolveApiUrl("http://localhost:8000", "192.168.1.20")).toBe("http://192.168.1.20:8000");
    expect(resolveApiUrl("http://127.0.0.1:9000/", "10.63.183.201")).toBe("http://10.63.183.201:9000");
  });
  it("respects an API address that was configured on purpose", () => {
    expect(resolveApiUrl("https://api.example.com", "192.168.1.20")).toBe("https://api.example.com");
  });
  it("never throws on a malformed setting", () => {
    expect(resolveApiUrl("not a url", "192.168.1.20")).toBe("not a url");
  });
});
