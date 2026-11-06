import { describe, expect, it, vi } from "vitest";
import { songAnalysis } from "@mobile/core/engine/studio/song";
import { createNativeEngine, editCopyOf, pcmOf, variesFrameRate, wavOf } from "../lib/nativeEngine";
import { limitStereo, voiceBand } from "../engine/brain/pure";

// The phone's file server, in this test: the song made here, the JavaScript analysis in place of SongAnalysis.kt, a clip's readings made up
const SR = 22050;
function clickTrack(seconds: number) {
  const n = seconds * SR, x = new Float32Array(n);
  for (let b = 0; b * 0.5 < seconds; b++) for (let i = 0; i < 2000 && b * 11025 + i < n; i++) x[b * 11025 + i] = Math.exp(-i / 300) * Math.sin(i * 0.05);
  return x;
}
function fileServer(mono: Float32Array) {
  const saved: Record<string, Uint8Array> = {};
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => String(body), json: async () => body, arrayBuffer: async () => body as ArrayBuffer });
  const fetcher = async (url: string, init?: { method?: string; body?: unknown }) => {
    const u = new URL(url), path = u.pathname.slice(1);
    if (path === "sound") { const out = new ArrayBuffer(8 + mono.byteLength), v = new DataView(out); v.setInt32(0, SR, true); v.setInt32(4, 1, true); new Float32Array(out, 8).set(mono); return ok(out); }
    if (path === "song") {
      const b = init!.body as Uint8Array, len = new DataView(b.buffer, b.byteOffset).getUint32(0, true), o = JSON.parse(new TextDecoder().decode(b.subarray(4, 4 + len)));
      const m = new Float32Array(b.slice(4 + len).buffer), r = songAnalysis(m, o.sr, o);
      return ok({ ...r, rmsF: Array.from(r.rmsF as unknown as Float32Array), pfArr: Array.from(r.pfArr as unknown as Float32Array), onEnv: Array.from(r.onEnv as unknown as Float64Array) });
    }
    if (path === "probe") return ok({ dur: 8, w: 1080, h: 1920 });
    if (path === "scan") { const samples = Array.from({ length: 80 }, (_, i) => ({ t: i / 10, m: 0.02 + 0.01 * Math.sin(i), b: 0.5, cx: 0.5, sh: 100 + i, sx: 0.5, sy: 0.5, sw: 0.2, gx: 0, gy: 0, ax: 0.5, ay: 0.5, aw: 0.3 })); return ok(`0.5\n${JSON.stringify({ samples, scenes: [] })}\n`); }
    if (path === "faces") return ok(`${JSON.stringify([{ t: 0.1, rects: [{ x: 0.5, y: 0.4, s: 0.3 }] }, { t: 0.5, rects: [{ x: 0.5, y: 0.4, s: 0.3 }] }])}\n`);
    if (path === "out") { saved[u.searchParams.get("name")!] = init!.body as Uint8Array; return ok({ path: `/out/${u.searchParams.get("name")}` }); }
    return { ok: false, status: 404, text: async () => "no", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetcher, saved };
}
const engine = (seconds = 30) => { const s = fileServer(clickTrack(seconds)); return { ...s, e: createNativeEngine({ base: "http://phone", key: "k", fetch: s.fetcher }) }; };
const clips = [{ path: "/a.mp4", name: "a.mp4" }, { path: "/b.mp4", name: "b.mp4" }, { path: "/c.mp4", name: "c.mp4" }];

const reel = async (seconds = 30) => { const x = engine(seconds); await x.e.call("song", { path: "/s.mp3", name: "s.mp3" }); await x.e.call("clips", { paths: clips }); return x; };
describe("the studio with no page", () => {
  it("makes a Reel from a song and clips", async () => {
    const { e } = engine();
    const song = await e.call("song", { path: "/s.mp3", name: "s.mp3" }) as { beats: number; bpm: number };
    expect(song.beats).toBeGreaterThan(20);
    expect(await e.call("clips", { paths: clips })).toMatchObject({ clips: 3, names: ["a.mp4", "b.mp4", "c.mp4"] });
    const r = await e.call("ready") as { work: { shots: number }; state: { edit: { start: number; end: number; src: number }[] } };
    expect(r.work.shots).toBeGreaterThan(3);
    const shots = r.state.edit;
    expect(shots[0].start).toBe(0);
    for (let i = 1; i < shots.length; i++) expect(shots[i].start).toBeCloseTo(shots[i - 1].end, 3);
    expect(shots[shots.length - 1].end).toBeCloseTo(30, 0);
    expect(new Set(shots.map((s) => s.src)).size).toBeGreaterThan(1);
  });
  it("cuts the Reel to a part of the song", async () => {
    const { e } = engine(60);
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    await e.call("clips", { paths: clips });
    await e.call("choose", { length: 15 });
    const r = await e.call("ready") as { state: { edit: { end: number }[] } }, last = r.state.edit[r.state.edit.length - 1];
    expect(last.end).toBeGreaterThan(10);
    expect(last.end).toBeLessThan(20);
  });
  it("reads only the clips it has not read, and a change of order keeps the Reel's clips", async () => {
    const { e } = engine();
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    await e.call("clips", { paths: clips.slice(0, 2) });
    expect(await e.call("clips", { paths: clips })).toMatchObject({ clips: 3 });
  });
  it("gives the Reel's whole sound as a WAV", async () => {
    const { e, saved } = engine(10);
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    await e.call("clips", { paths: clips });
    const m = await e.call("exportMix", { name: "mix.wav" }) as { path: string; plan: { watermark: boolean } };
    expect(m.path).toBe("/out/mix.wav");
    expect(m.plan.watermark).toBe(true);
    expect(saved["mix.wav"].length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(saved["mix.wav"].subarray(0, 4))).toBe("RIFF");
  });
  it("cancel stops the clips still to read", async () => {
    const { e } = engine();
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    const going = e.call("clips", { paths: clips });
    await e.call("cancel");
    const r = await going as { clips: number };
    expect(r.clips).toBeLessThan(3);
  });
  it("says so for an operation it does not have", async () => {
    const { e } = engine();
    await expect(e.call("nothing")).rejects.toThrow(/Not on the phone's own engine yet/);
  });
  const edit = async (e: ReturnType<typeof engine>["e"]) => (await e.call("state") as { edit: { start: number; end: number; tr?: string; efx?: string; cs?: Record<string, unknown>; uk?: unknown[] }[]; overlays: { text: string }[]; settings: { au: Record<string, unknown> } });
  it("changes a shot and takes it back", async () => {
    const { e } = await reel(), before = JSON.stringify((await edit(e)).edit.map((s) => s.efx));
    await e.call("seek", { time: 1 });
    await e.call("shotStyle", { kind: "effect", value: "rgbpulse" });
    const at = async () => (await edit(e)).edit.find((s) => s.start <= 1 && s.end > 1)!;
    expect((await at()).efx).toBe("rgbpulse");
    await e.call("shotSet", { patch: { bri: 0.3 } });
    expect((await at()).cs?.bri).toBe(0.3);
    expect(JSON.stringify((await edit(e)).edit.map((s) => s.efx))).not.toBe(before);
  });
  it("adds and removes keyframes", async () => {
    const { e } = await reel();
    await e.call("kfSeek", { time: 0.5 });
    const k = await e.call("kfSet", { values: { s: 1.2 } }) as { ok: boolean };
    expect(k.ok).toBe(true);
    const row = await e.call("kfSeek", { time: 0.5 }) as { keyframes: unknown[] };
    expect(row.keyframes.length).toBeGreaterThan(0);
    expect(await e.call("kfClear") as { keyframes: unknown[] }).toMatchObject({ keyframes: [] });
  });
  it("sets the music's mix and adds a sound effect", async () => {
    const { e } = await reel(10);
    await e.call("audioMix", { mvol: 0.5 });
    expect((await edit(e)).settings.au.mvol).toBe(0.5);
    expect(await e.call("sfx", { kind: "whoosh", time: 2 })).toMatchObject({ ok: true });
  });
  it("adds a text template", async () => {
    const { TEXT_TEMPLATES } = await import("@mobile/core/lib/text-templates"), key = (Array.isArray(TEXT_TEMPLATES) ? (TEXT_TEMPLATES[0] as { key: string }).key : Object.keys(TEXT_TEMPLATES)[0]);
    const { e } = await reel();
    expect(await e.call("template", { key, time: 2 })).toMatchObject({ ok: true });
    expect((await edit(e)).overlays.length).toBeGreaterThan(0);
  });
  it("marks a shot to play backwards", async () => {
    const { e } = await reel();
    await e.call("seek", { time: 1 });
    expect(await e.call("shotReverse")).toMatchObject({ ok: true });
    expect((await edit(e)).edit.find((s) => s.start <= 1 && s.end > 1)!.cs?.rev).toBe(true);
  });
  it("adds a layer, moves it and deletes it", async () => {
    const { e } = await reel();
    expect(await e.call("layerAdd", { path: "/o.mp4", name: "o.mp4" })).toMatchObject({ ok: true, count: 1 });
    await e.call("layerSet", { key: "op", value: 0.5 });
    const rows = await e.call("layerList") as { opacity: number; native: { path: string } }[];
    expect(rows[0].opacity).toBe(0.5); expect(rows[0].native.path).toBe("/o.mp4");
    expect(await e.call("layerDelete")).toMatchObject({ ok: true });
  });
});

describe("its sound helpers", () => {
  it("reads the file server's sound", () => {
    const out = new ArrayBuffer(8 + 16), v = new DataView(out); v.setInt32(0, 44100, true); v.setInt32(4, 2, true); new Float32Array(out, 8).set([0.5, -0.5, 1, 0]);
    const p = pcmOf(out);
    expect(p.sampleRate).toBe(44100); expect(Array.from(p.channels[0])).toEqual([0.5, 1]); expect(Array.from(p.mono)).toEqual([0, 0.5]);
  });
  it("keeps a loud mix under full scale", () => {
    const x = new Float32Array(44100).fill(1), wav = new DataView(wavOf({ length: x.length, sampleRate: 44100, numberOfChannels: 1, getChannelData: () => x }, 2));
    let peak = 0; for (let o = 44; o < wav.byteLength; o += 4) peak = Math.max(peak, Math.abs(wav.getInt16(o, true)));
    expect(peak / 32767).toBeLessThanOrEqual(0.945);
    expect(peak / 32767).toBeGreaterThan(0.9);
  });
});

describe("what the old page did, on the phone's own engine", () => {
  type Call = { url: string; method: string; body?: unknown };
  /** the phone's file server and the API, with some answers of its own; every call is kept */
  const withAnswers = (seconds: number, answer: (path: string, init: { method?: string; body?: unknown } | undefined, url: URL) => unknown, extra: Record<string, unknown> = {}) => {
    const s = fileServer(clickTrack(seconds)), calls: Call[] = [];
    const fetch = async (to: string, init?: { method?: string; body?: unknown }) => {
      const u = new URL(to), path = u.pathname; calls.push({ url: to, method: init?.method ?? "GET", body: init?.body });
      const got = answer(path, init, u);
      return got !== undefined ? got as never : s.fetcher(to, init);
    };
    return { ...s, calls, e: createNativeEngine({ base: "http://phone", key: "k", fetch: fetch as never, ...extra } as never) };
  };
  const ok = (body: unknown, tag?: string) => ({ ok: true, status: 200, text: async () => String(body), json: async () => body, arrayBuffer: async () => body as ArrayBuffer, headers: { get: () => tag ?? null } });
  const refused = (status = 404) => ({ ok: false, status, text: async () => "no", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
  const started = async (x: { e: { call(op: string, a?: Record<string, unknown>): Promise<unknown> } }) => { await x.e.call("song", { path: "/s.mp3", name: "s.mp3" }); await x.e.call("clips", { paths: clips }); await x.e.call("ready"); };

  it("a shot with its own sound on is heard in the Reel", async () => {
    const silent = engine(10), voiced = engine(10);
    await started(silent); await started(voiced);
    const host = voiced.e.host() as unknown as { ES: { edit: { cs?: Record<string, unknown>; src: number }[]; sources: { pcm?: { x: Float32Array } | null }[] } };
    host.ES.edit.forEach((s) => { s.cs = { ...s.cs, vol: 1 }; });
    await silent.e.call("exportMix", { name: "a.wav" }); await voiced.e.call("exportMix", { name: "b.wav" });
    expect(host.ES.sources[host.ES.edit[0].src].pcm?.x.length).toBeGreaterThan(1000);
    const a = silent.saved["a.wav"], b = voiced.saved["b.wav"]; let differ = 0;
    for (let i = 44; i < Math.min(a.length, b.length); i += 2) if (a[i] !== b[i]) differ++;
    expect(differ).toBeGreaterThan(1000);
  });
  it("a clip with no sound does not stop the Reel", async () => {
    const x = withAnswers(10, (path, _i, u) => (path === "/sound" && u.searchParams.get("p") !== "/s.mp3" ? refused(422) : undefined));
    await started(x);
    const host = x.e.host() as unknown as { ES: { edit: { cs?: Record<string, unknown> }[] } };
    host.ES.edit.forEach((s) => { s.cs = { ...s.cs, vol: 1 }; });
    expect((await x.e.call("exportMix", { name: "c.wav" }) as { path: string }).path).toBe("/out/c.wav");
  });
  it("a heavy clip is read from its edit copy, its sound from the original", async () => {
    const x = withAnswers(10, (path, init, u) => {
      if (path === "/probe") return ok({ dur: 8, w: 2160, h: 3840, size: 40_000_000, fps: 60, hdr: true, times: [] });
      if (path === "/copy") return ok({ path: `/copy${u.searchParams.get("p")}` });
      return undefined;
    });
    await x.e.call("song", { path: "/s.mp3", name: "s.mp3" });
    await x.e.call("clips", { paths: clips.slice(0, 1) });
    const copy = x.calls.find((c) => c.url.includes("/copy?"))!;
    expect(copy.url).toContain("w=1080"); expect(copy.url).toContain("h=1920"); expect(copy.url).toContain("fps=30");
    expect(x.calls.find((c) => c.url.includes("/scan?"))!.url).toContain(encodeURIComponent("/copy/a.mp4"));
    expect((x.e.host() as unknown as { ES: { sources: { path: string; soundPath: string }[] } }).ES.sources[0]).toMatchObject({ path: "/copy/a.mp4", soundPath: "/a.mp4" });
    expect(await x.e.call("copies")).toEqual([{ name: "a.mp4", path: "/copy/a.mp4", w: 1080, h: 1920 }]);
  });
  it("decides which clips are heavy", () => {
    const base = { dur: 10, w: 1080, h: 1920, size: 20_000_000 };
    expect(editCopyOf(base)).toBeNull();
    expect(editCopyOf({ ...base, fps: 30 })).toBeNull();
    expect(editCopyOf({ ...base, fps: 60 })).toMatchObject({ w: 1080, h: 1920 });
    expect(editCopyOf({ ...base, hdr: true })).not.toBeNull();
    expect(editCopyOf({ ...base, tenBit: true })).not.toBeNull();
    expect(editCopyOf({ ...base, w: 2160, h: 3840, size: 10_000_000 })).toBeNull();              // 4K, a low bitrate
    expect(editCopyOf({ ...base, w: 2160, h: 3840, size: 100_000_000 })).toMatchObject({ w: 1080, h: 1920 });
    expect(editCopyOf({ ...base, w: 4320, h: 7680 })).not.toBeNull();
    const even = Array.from({ length: 60 }, (_, i) => i / 30);
    expect(editCopyOf({ ...base, times: even })).toBeNull();
    const uneven = even.map((t, i) => (i % 3 === 0 ? t + 0.02 : t));
    expect(variesFrameRate(uneven)).toBe(true);
    expect(editCopyOf({ ...base, times: uneven })).not.toBeNull();
  });
  it("the words are heard from the band of a voice", () => {
    const tone = (hz: number) => Float32Array.from({ length: 16000 }, (_, i) => Math.sin(2 * Math.PI * hz * i / 16000));
    const level = (x: Float32Array) => { let s = 0; for (let i = 4000; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length - 4000)); };
    expect(level(voiceBand(tone(1000), 16000))).toBeGreaterThan(0.6);
    expect(level(voiceBand(tone(40), 16000))).toBeLessThan(0.08);
    expect(level(voiceBand(tone(7000), 16000))).toBeLessThan(0.15);
  });
  it("the limiter brings a loud sound down and leaves a quiet one alone", () => {
    const sine = (a: number) => Float32Array.from({ length: 44100 }, (_, i) => a * Math.sin(2 * Math.PI * 200 * i / 44100));
    const [L] = limitStereo(sine(2), sine(2), 44100); let peak = 0; for (let i = 4410; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]));
    expect(peak).toBeLessThan(1.2); expect(peak).toBeGreaterThan(0.7);
    const quiet = sine(0.3), [Q] = limitStereo(quiet, quiet, 44100);
    expect(Array.from(Q)).toEqual(Array.from(quiet));
  });
  it("a beat shape knows where the shot's subject is", async () => {
    const { e } = await reel(10);
    const host = e.host() as unknown as { ES: { edit: { efx?: string }[] } };
    host.ES.edit[0].efx = "circle"; host.ES.edit[1].efx = "none";
    const { plan } = await e.call("exportMix", { name: "m.wav" }) as { plan: { beatCam: ({ w: number; h: number; path: number[][] } | null)[] } };
    expect(plan.beatCam[0]).toMatchObject({ w: 1080, h: 1920 });
    expect(plan.beatCam[0]!.path.length).toBeGreaterThan(0);
    expect(plan.beatCam[0]!.path[0]).toHaveLength(3);
    expect(plan.beatCam[1]).toBeNull();
  });
  it("a text that follows the person gets the subject's path; others do not cost it", async () => {
    const { e } = await reel(10);
    const host = e.host() as unknown as { ES: { overlays: { track?: boolean }[] } };
    expect(((await e.call("exportMix", { name: "n.wav" })) as { plan: { textTrack: unknown } }).plan.textTrack).toBeNull();
    host.ES.overlays = [{ track: true }];
    const path = ((await e.call("exportMix", { name: "o.wav" })) as { plan: { textTrack: number[][] } }).plan.textTrack;
    expect(path.length).toBeGreaterThan(50);
    expect(path[0]).toHaveLength(5);
    expect(path[0][3]).toBe(1080);
  });
  const reelsApi = (usage: { used: number; limit: number }, puts: Call[], complete: Call[], removed: string[], failPart = false) => (path: string, init: { method?: string; body?: unknown } | undefined) => {
    const method = init?.method ?? "GET";
    if (path === "/probe") return ok({ dur: 9.04, w: 1080, h: 1920, size: 25, fps: 30 });
    if (path === "/api/studio/reels" && method === "GET") return ok({ reels: [], usage });
    if (path === "/api/studio/reels" && method === "POST") return ok({ id: "r1", direct: true, partSize: 10, parts: [{ n: 1, url: "http://store/1" }, { n: 2, url: "http://store/2" }, { n: 3, url: "http://store/3" }] });
    if (path.startsWith("/1") || path.startsWith("/2") || path.startsWith("/3")) { puts.push({ url: path, method, body: init?.body }); return failPart ? refused(500) : ok({}, `"tag${path}"`); }
    if (path === "/api/studio/reels/r1/complete") { complete.push({ url: path, method, body: init?.body }); return ok({ id: "r1" }); }
    if (path === "/api/studio/reels/r1" && method === "DELETE") { removed.push(path); return ok({ ok: true }); }
    return undefined;
  };
  const bytes = async (_p: string, at: number, n: number) => Uint8Array.from({ length: n }, (_, i) => at + i);
  it("My Reels is offered only with room in it", async () => {
    const roomy = withAnswers(5, reelsApi({ used: 1, limit: 5 }, [], [], [])), full = withAnswers(5, reelsApi({ used: 5, limit: 5 }, [], [], [])), offline = withAnswers(5, (p) => (p === "/api/studio/reels" ? refused(500) : undefined));
    expect(await roomy.e.call("exportOptions", {})).toMatchObject({ myReels: true, myReelsNote: expect.stringContaining("1 of 5") });
    expect(await full.e.call("exportOptions", {})).toMatchObject({ myReels: false });
    expect(await offline.e.call("exportOptions", {})).toMatchObject({ myReels: false });
  });
  it("a finished Reel goes to My Reels in parts", async () => {
    const puts: Call[] = [], complete: Call[] = [];
    const x = withAnswers(5, reelsApi({ used: 0, limit: 5 }, puts, complete, []), { readBytes: bytes });
    await x.e.call("saveToMyReels", { path: "/out/r.mp4", name: "r.mp4" });
    expect(puts.map((p) => (p.body as Uint8Array).length).sort()).toEqual([10, 10, 5]);
    expect(Array.from(puts.find((p) => p.url === "/3")!.body as Uint8Array)).toEqual([20, 21, 22, 23, 24]);
    const parts = JSON.parse(complete[0].body as string).parts as { n: number; etag: string }[];
    expect(parts.map((p) => p.n).sort()).toEqual([1, 2, 3]);
    expect(parts.find((p) => p.n === 2)!.etag).toBe(`"tag/2"`);
  });
  it("a failed save says so and leaves nothing half saved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    try {
      const removed: string[] = [];
      const x = withAnswers(5, reelsApi({ used: 0, limit: 5 }, [], [], removed, true), { readBytes: bytes });
      const going = x.e.call("saveToMyReels", { path: "/out/r.mp4", name: "r.mp4" });
      const seen = expect(going).rejects.toThrow(/saved on your phone/);
      await vi.advanceTimersByTimeAsync(20_000);
      await seen;
      expect(removed).toEqual(["/api/studio/reels/r1"]);
    } finally { vi.useRealTimers(); }
  });
});

describe("clips read behind the screen", () => {
  it("a clip that cannot be read is named, and the others go on", async () => {
    const server = fileServer(clickTrack(10)), told: [string, boolean][] = [];
    const fetcher = async (to: string, init?: { method?: string; body?: unknown }) => {
      const u = new URL(to);
      if (u.pathname === "/probe" && u.searchParams.get("p") === "/b.mp4") return { ok: false, status: 422, text: async () => "no", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      return server.fetcher(to, init);
    };
    const e = createNativeEngine({ base: "http://phone", key: "k", fetch: fetcher as never, clipDone: (name: string, ok: boolean) => told.push([name, ok]) } as never);
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    const r = await e.call("clips", { paths: clips }) as { clips: number; names: string[]; failed: string[] };
    expect(r.failed).toEqual(["b.mp4"]);
    expect(r.names).toEqual(["a.mp4", "c.mp4"]);
    expect(told).toEqual([["a.mp4", true], ["b.mp4", false], ["c.mp4", true]]);
    expect((await e.call("ready") as { work: { shots: number } }).work.shots).toBeGreaterThan(0);
  });
  it("no clip readable at all says so", async () => {
    const server = fileServer(clickTrack(10));
    const fetcher = async (to: string, init?: { method?: string; body?: unknown }) => new URL(to).pathname === "/probe" ? { ok: false, status: 422, text: async () => "no", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) } : server.fetcher(to, init);
    const e = createNativeEngine({ base: "http://phone", key: "k", fetch: fetcher as never } as never);
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    await expect(e.call("clips", { paths: clips })).rejects.toThrow(/cannot be read/);
  });
});

describe("Shubix AI's price before Make Reel", () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => String(body), json: async () => body, arrayBuffer: async () => body as ArrayBuffer });
  const priced = (balance: number, plan = "editor") => {
    const s = fileServer(clickTrack(10)), asked: string[] = [];
    const fetcher = async (to: string, init?: { method?: string; body?: unknown }) => {
      const p = new URL(to).pathname;
      if (p === "/api/studio/rank-shots" && (init?.method ?? "GET") === "GET") return ok({ available: true, planAi: true, costs: { reel: 10 }, balance });
      if (p === "/api/credits") return ok({ enabled: true, plan });
      if (p === "/api/plan-locks") return ok({});
      if (p.startsWith("/api/")) return { ok: false, status: 503, text: async () => "no", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
      return s.fetcher(to, init);
    };
    return { asked, e: createNativeEngine({ base: "http://phone", key: "k", fetch: fetcher as never, ask: async (q: { title: string }) => { asked.push(q.title); return true; } } as never) };
  };
  it("gives the price and the balance", async () => {
    expect(await priced(240).e.call("aiPrice")).toEqual({ on: true, cost: 10, balance: 240, paid: true });
  });
  it("asks nothing again after Make Reel; too few credits: Free goes on with the phone's edit, a plan waits", async () => {
    for (const [balance, plan, went] of [[240, "editor", true], [3, "free", true], [3, "editor", false]] as const) {
      const { e, asked } = priced(balance, plan);
      await e.call("song", { path: "/s.mp3", name: "s.mp3" });
      await e.call("clips", { paths: clips });
      await e.call("aiPrice");
      expect((await e.call("ai") as { went: boolean }).went).toBe(went);
      expect(asked).toEqual([]);
    }
  }, 30_000);
});

describe("the clips before Shubix AI", () => {
  const counted = () => { const s = fileServer(clickTrack(30)), read: string[] = []; const fetcher = async (to: string, init?: { method?: string; body?: unknown }) => { const u = new URL(to); if (u.pathname === "/scan") read.push(u.searchParams.get("p")!); return s.fetcher(to, init); }; return { read, e: createNativeEngine({ base: "http://phone", key: "k", fetch: fetcher as never } as never) }; };
  it("reads only a new clip, also after one was taken out or moved", async () => {
    const { e, read } = counted();
    await e.call("song", { path: "/s.mp3", name: "s.mp3" });
    await e.call("clips", { paths: clips });
    expect(read).toEqual(["/a.mp4", "/b.mp4", "/c.mp4"]);
    expect((await e.call("clips", { paths: [clips[2], clips[0]] }) as { names: string[] }).names).toEqual(["c.mp4", "a.mp4"]);
    expect(read).toHaveLength(3);
    const more = await e.call("clips", { paths: [clips[2], clips[0], clips[1], { path: "/d.mp4", name: "d.mp4" }] }) as { names: string[] };
    expect(more.names).toEqual(["c.mp4", "a.mp4", "b.mp4", "d.mp4"]);
    expect(read).toEqual(["/a.mp4", "/b.mp4", "/c.mp4", "/d.mp4"]);
  });
  it("says how much good video there is for the Reel's length", async () => {
    const { e } = await reel(30);
    const f = await e.call("footage") as { have: number; need: number };
    expect(f.need).toBeCloseTo(30, 0);
    expect(Number.isInteger(f.have)).toBe(true);
    expect(f.have).toBeGreaterThan(5);
    expect(f.have).toBeLessThanOrEqual(24);   // three clips of 8 s
  });
});
