import { describe, expect, it } from "vitest";
import { songAnalysis } from "@mobile/core/engine/studio/song";
import { createNativeEngine, pcmOf, wavOf } from "../lib/nativeEngine";

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
  const reel = async (seconds = 30) => { const x = engine(seconds); await x.e.call("song", { path: "/s.mp3", name: "s.mp3" }); await x.e.call("clips", { paths: clips }); return x; };
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
