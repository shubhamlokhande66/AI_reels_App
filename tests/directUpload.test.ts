import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

/** Storage stand-in: records each part PUT, answers with an ETag; `failOnce` parts fail on their first try. */
function fakeStorage(failOnce = new Set<string>()) {
  const puts: { url: string; size: number }[] = [];
  const tried = new Set<string>();
  class FakeXhr {
    status = 0; url = ""; upload = { onprogress: null as null | ((e: { loaded: number }) => void) };
    onload: null | (() => void) = null; onerror: null | (() => void) = null;
    open(_m: string, url: string) { this.url = url; }
    getResponseHeader(h: string) { return h === "ETag" ? `"etag-${new URL(this.url).searchParams.get("partNumber")}"` : null; }
    send(blob: Blob) {
      setTimeout(() => {
        if (failOnce.has(this.url) && !tried.has(this.url)) { tried.add(this.url); this.onerror?.(); return; }
        puts.push({ url: this.url, size: blob.size });
        this.upload.onprogress?.({ loaded: blob.size });
        this.status = 200;
        this.onload?.();
      }, 1);
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return puts;
}

const MB = 1024 * 1024;
const file = (name: string, size: number) => new File([new Uint8Array(size)], name, { type: "video/mp4" });

describe("clips uploaded straight to storage", () => {
  it("sends every part in parallel, retries a dropped one, then joins each clip", async () => {
    const big = file("big.mp4", 20 * MB), small = file("small.mp4", 3 * MB);
    const part = (m: string, n: number) => ({ n, url: `https://r2.test/${m}?partNumber=${n}` });
    const puts = fakeStorage(new Set(["https://r2.test/m1?partNumber=2"]));
    const completes: { url: string; body: unknown }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/videos/direct")) { // one clip per start
        const name = JSON.parse(String(init?.body)).files[0].name;
        return Response.json({ direct: true, files: [name === "big.mp4"
          ? { mediaId: "m1", name, partSize: 8 * MB, parts: [part("m1", 1), part("m1", 2), part("m1", 3)] }
          : { mediaId: "m2", name, partSize: 8 * MB, parts: [part("m2", 1)] }] });
      }
      completes.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ id: url.split("/").pop(), name: "x" }, { status: 201 });
    }));
    const progress: number[] = [];
    const res = await api.uploadVideos("p", [big, small], (f) => progress.push(f));

    expect(puts.map((p) => p.size).sort((a, b) => a - b)).toEqual([3 * MB, 4 * MB, 8 * MB, 8 * MB]); // last part is the rest
    expect(res.uploaded.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.failed).toEqual([]);
    const m1 = completes.find((c) => c.url.endsWith("/direct/m1"))!.body as { parts: { n: number; etag: string }[] };
    expect(m1.parts.map((p) => p.n).sort()).toEqual([1, 2, 3]); // part 2 made it on its retry
    expect(m1.parts.find((p) => p.n === 2)!.etag).toBe('"etag-2"');
    expect(progress.at(-1)).toBe(1);
  });

  it("reports a clip whose part keeps failing, and still adds the others", async () => {
    vi.useFakeTimers();
    const part = (m: string, n: number) => ({ n, url: `https://r2.test/${m}?partNumber=${n}` });
    class FlakyXhr {
      status = 0; url = ""; upload = { onprogress: null }; onload: null | (() => void) = null; onerror: null | (() => void) = null;
      open(_m: string, url: string) { this.url = url; }
      getResponseHeader() { return '"e"'; }
      send() { setTimeout(() => { if (this.url.includes("bad")) this.onerror?.(); else { this.status = 200; this.onload?.(); } }, 1); }
    }
    vi.stubGlobal("XMLHttpRequest", FlakyXhr);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (url.endsWith("/videos/direct")) {
        const name = JSON.parse(String(init?.body)).files[0].name;
        return Response.json({ direct: true, files: [{ mediaId: name, name, partSize: 8 * MB, parts: [part(name === "bad.mp4" ? "bad" : "ok", 1)] }] });
      }
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ id: url.split("/").pop() }, { status: 201 });
    }));
    const pending = api.uploadVideos("p", [file("bad.mp4", 10), file("ok.mp4", 10)]);
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.uploaded.map((m) => m.id)).toEqual(["ok.mp4"]);
    expect(res.failed.map((f) => f.name)).toEqual(["bad.mp4"]);
    expect(calls).toContain("DELETE /api/projects/p/videos/direct/bad.mp4"); // its parts are thrown away
  });

  it("uses the normal upload when the server has no direct uploads", async () => {
    let posted = "";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ direct: false })));
    class FormXhr {
      status = 201; responseText = JSON.stringify({ uploaded: [{ id: "m" }], failed: [] }); withCredentials = false;
      upload = { onprogress: null }; onload: null | (() => void) = null; onerror = null;
      open(_m: string, url: string) { posted = url; }
      setRequestHeader() {}
      send() { setTimeout(() => this.onload?.(), 1); }
    }
    vi.stubGlobal("XMLHttpRequest", FormXhr);
    const res = await api.uploadVideos("p", [file("a.mp4", 10)]);
    expect(posted).toBe("/api/projects/p/videos");
    expect(res.uploaded).toEqual([{ id: "m" }]);
  });
});
