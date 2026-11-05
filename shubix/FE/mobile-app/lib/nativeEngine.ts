import { createHost, soundOf } from "../engine/brain/host";
import initial from "../engine/brain/initial-state.json";
import { limitStereo } from "../engine/brain/pure";
import { TTS_VOICES, voiceLanguage } from "../engine/lib/tts/voices";

/** The studio: its operations run on the brain in the app's own JS, with the phone's own code doing the heavy work through
 * its file server (SongAnalysis.kt, ClipScan.kt, ClipFaces.kt). */
type Fetch = (url: string, init?: { method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
export type NativeIo = { base: string; key: string; fetch: Fetch; token?: () => Promise<string | null>; onProgress?: (what: "song" | "clips", p: number) => void;
  /** Shubix AI's question: true Use, false the other button, null closed */
  ask?: (q: { title: string; text: string; list?: string[]; bal?: number | null; ok: string; no?: string; after?: number | null }) => Promise<boolean | null>;
  /** what Shubix is doing, in its words; an error when `err` */
  stat?: (text: string, err?: boolean) => void; spent?: () => void; tell?: (text: string) => void;
  /** one clip was read, or could not be */
  clipDone?: (name: string, ok: boolean) => void;
  /** a step of the work popup */
  readBytes?: (path: string, at: number, length: number) => Promise<Uint8Array>;
  task?: (state: "start" | "progress" | "done" | "fail" | "clear", id: string, title?: string, detail?: string, kind?: string, p?: number | null) => void };
type Args = Record<string, unknown>;
type Clip = { path: string; name: string };

const ascii = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

/** A clip's frame gaps say whether its frame rate varies: screen recordings, WhatsApp, many Android phones in low light. */
export function variesFrameRate(times: number[]) {
  if (times.length < 20) return false;
  const t = [...times].sort((a, b) => a - b), d: number[] = [];
  for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g > 1e-4) d.push(g); }
  if (d.length < 15) return false;
  const med = [...d].sort((a, b) => a - b)[d.length >> 1], off = d.filter((g) => g > med * 1.6 || g < med * 0.6).length / d.length;
  return off > 0.12 || Math.max(...d) > Math.max(0.25, med * 6);
}
export type ClipFacts = { dur: number; w: number; h: number; size?: number; fps?: number; hdr?: boolean; tenBit?: boolean; chroma422?: boolean; times?: number[] };
/** The edit copy a heavy clip needs (HDR, 10-bit, more than 30 fps, a varying frame rate, very large), H.264 at 30 fps; null: none. */
export function editCopyOf(f: ClipFacts) {
  const long = Math.max(f.w, f.h), size = f.size ?? 0, rate = f.dur > 0 ? (size * 8) / f.dur : 0;
  const heavy = !!f.hdr || !!f.tenBit || !!f.chroma422 || variesFrameRate(f.times ?? []) || (f.fps ?? 0) > 31 || long > 3840 || (long > 1920 && (rate > 20_000_000 || !size));
  if (!heavy || f.dur <= 0 || f.dur > 1200 || size > 8 * 1024 ** 3) return null;
  const k = Math.min(1, 1920 / long), even = (v: number) => Math.max(2, Math.round((v * k) / 2) * 2);
  const b = size ? Math.max(1_500_000, Math.min(10_000_000, Math.floor(rate * 0.9), Math.floor((400 * 1024 ** 2 * 8) / f.dur))) : 8_000_000;
  return { w: even(f.w), h: even(f.h), bitrate: b };
}

/** The song's bytes as the file server gives them: rate and channels, then floats, one sample of each channel after another */
export function pcmOf(raw: ArrayBuffer) {
  const top = new DataView(raw, 0, 8), sampleRate = top.getInt32(0, true), count = top.getInt32(4, true), all = new Float32Array(raw, 8), n = Math.floor(all.length / count);
  const channels = Array.from({ length: count }, () => new Float32Array(n)), mono = new Float32Array(n);
  for (let k = 0; k < count; k++) { const d = channels[k]; for (let i = 0; i < n; i++) { d[i] = all[i * count + k]; mono[i] += d[i] / count; } }
  return { sampleRate, channels, mono };
}

/** the file server's answer of lines: progress, then the one that starts with `first` */
function lastLine(text: string, first: string) {
  const lines = text.split("\n").filter(Boolean), last = lines[lines.length - 1] ?? "";
  if (last[0] !== first) throw new Error(last || "The phone could not read this file");
  return JSON.parse(last);
}

/** The Reel's whole sound as a 16-bit WAV: the studio's gain with its tiny fades, the limiter, the peak brought to -0.5 dBFS */
export function wavOf(buf: { length: number; sampleRate: number; numberOfChannels: number; getChannelData(c: number): Float32Array }, gain: number) {
  const n = buf.length, sr = buf.sampleRate, L0 = buf.getChannelData(0), R0 = buf.getChannelData(Math.min(1, buf.numberOfChannels - 1)), a = Math.round(0.02 * sr), z = Math.round(0.25 * sr);
  const at = (i: number) => (i < a ? i / a : 1) * (i > n - z ? Math.max(0, (n - i) / z) : 1) * gain;
  const G0 = new Float32Array(n), G1 = new Float32Array(n); for (let i = 0; i < n; i++) { const g = at(i); G0[i] = L0[i] * g; G1[i] = R0[i] * g; }
  const [L, R] = limitStereo(G0, G1, sr);
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0.944 ? 0.944 / peak : 1, out = new ArrayBuffer(44 + n * 4), v = new DataView(out);
  const tag = (o: number, t: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); tag(8, "WAVE"); tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) { v.setInt16(o, Math.max(-1, Math.min(1, L[i] * k)) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i] * k)) * 32767, true); }
  return out;
}

export function createNativeEngine(io: NativeIo) {
  const make = () => createHost(JSON.stringify(initial), { analyse: (m: Float32Array, sr: number, opts: Args) => analyse(m, sr, opts), getCtx, apiFetch, aiFrames, readSound, ask: (q: Parameters<NonNullable<NativeIo["ask"]>>[0]) => io.ask ? io.ask(q) : Promise.resolve(null), stat: io.stat, spent: io.spent, tell: io.tell, task: io.task, voices: TTS_VOICES, speak });
  let host = make(), signedIn = false;
  let stops = 0, read: Clip[] = [], reading = 0, copies: { name: string; path: string; w: number; h: number }[] = [];
  const url = (path: string, q = "") => `${io.base}/${path}?k=${io.key}${q}`;
  /** a file's sound, read by the phone (SoundReader.kt); it fails when the file has none */
  async function readSound(path: string) {
    const res = await io.fetch(url("sound", `&p=${encodeURIComponent(path)}`));
    if (!res.ok) throw new Error("No sound");
    return pcmOf(await res.arrayBuffer());
  }
  function getCtx() { return { createBuffer: (count: number, n: number, sr: number) => soundOf(Array.from({ length: count }, () => new Float32Array(n)), sr) }; }

  async function apiFetch(path: string, o: { method?: string; headers?: Record<string, string>; body?: unknown; signal?: unknown } = {}) {
    const token = await io.token?.();
    return io.fetch(io.base + path, { ...o, headers: { ...o.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } } as never);
  }
  /** the frames Shubix AI looks at, as JPEGs from the phone's own decoder */
  async function aiFrames(src: { path: string; w: number; h: number }) {
    const ts = (host.brain.aiTimes(src) as number[]).slice().sort((x, y) => x - y), sc = Math.min(1, 384 / Math.max(src.w, src.h));
    const w = Math.max(2, Math.round(src.w * sc / 2) * 2), h = Math.max(2, Math.round(src.h * sc / 2) * 2);
    const res = await io.fetch(url("aiframes", `&p=${encodeURIComponent(src.path)}&w=${w}&h=${h}`), { method: "POST", body: ts.map((t) => t.toFixed(3)).join(",") });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json() as (string | null)[]).map((image, i) => image ? { t: +ts[i].toFixed(2), image } : null).filter(Boolean);
  }
  /** the phone's own voice speaks: its samples and rate (SystemVoice.kt) */
  async function speak(text: string, voice: string) {
    const res = await io.fetch(url("speak", `&v=${encodeURIComponent(voiceLanguage(voice))}`), { method: "POST", body: text });
    if (!res.ok) throw new Error(await res.text());
    return { pcm: new Float32Array(await res.arrayBuffer()), sr: Number((res as unknown as { headers?: { get(k: string): string | null } }).headers?.get("X-Sample-Rate")) || 22050 };
  }
  async function analyse(mono: Float32Array, sr: number, opts: Args = {}) {
    const head = new TextEncoder().encode(JSON.stringify({ ...opts, sr })), body = new Uint8Array(4 + head.length + mono.byteLength);
    new DataView(body.buffer).setUint32(0, head.length, true); body.set(head, 4); body.set(new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength), 4 + head.length);
    const res = await io.fetch(url("song"), { method: "POST", body });
    if (!res.ok) throw new Error(await res.text());
    const r = await res.json() as Args & { rmsF: number[]; pfArr: number[]; onEnv: number[] };
    return { ...r, rmsF: Float32Array.from(r.rmsF), pfArr: Float32Array.from(r.pfArr), onEnv: Float64Array.from(r.onEnv) };
  }
  async function song(a: Args) {
    const g = stops, path = String(a.path), name = String(a.name);
    io.task?.("start", "song", "Adding your song", `Reading the sound of ${name.replace(/\.[^.]+$/, "")}`, "music");
    try {
      const res = await io.fetch(url("sound", `&p=${encodeURIComponent(path)}`));
      if (!res.ok) throw new Error("This file has no sound we can read. Try an MP3, M4A or WAV.");
      const { sampleRate, channels, mono } = pcmOf(await res.arrayBuffer());
      if (stops !== g) throw new Error("Stopped");
      io.task?.("progress", "song", undefined, "Finding the beats, drops and breaks");
      const r = await analyse(mono, sampleRate);
      if (stops !== g) throw new Error("Stopped");
      await host.setSong({ channels, mono, r, name, sampleRate });
      io.task?.("done", "song", "Song ready");
      return facts();
    } catch (e) { io.task?.(stops !== g ? "clear" : "fail", "song", e instanceof Error ? e.message : "The song could not be read"); throw e; }
  }
  const facts = () => { const r = host.ES.song.r as { period: number; beats: number[]; cutType: string[] }, n = (k: string) => r.cutType.filter((t) => t === k).length; return { duration: host.ES.buf.duration, bpm: Math.round(60 / r.period), beats: r.beats.length, drops: n("drop"), breaks: n("break") }; };

  /** My Reels with room left for this person (read at most once a minute); null: not offered */
  let room: { used: number; limit: number } | null = null, roomAt = 0;
  async function myReelsRoom() {
    if (Date.now() - roomAt > 60_000) {
      roomAt = Date.now();
      try { const r = await apiFetch("/api/studio/reels"); room = r.ok ? (await r.json() as { usage: { used: number; limit: number } }).usage : null; } catch { room = null; roomAt = 0; }
    }
    return room && room.limit > room.used ? room : null;
  }
  /** A finished Reel into My Reels: straight to storage in parts, three at a time, each tried four times. */
  async function saveToMyReels(path: string, name: string) {
    if (!io.readBytes) throw new Error("My Reels is not available here");
    const probe = await io.fetch(url("probe", `&p=${encodeURIComponent(path)}`));
    if (!probe.ok) throw new Error("The Reel could not be read");
    const f = await probe.json() as ClipFacts, size = f.size ?? 0;
    const send = async (to: string, method: string, body?: Args) => {
      const r = await apiFetch(to, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      if (!r.ok) { const e = await r.json().catch(() => null) as { error?: { message?: string } } | null; throw new Error(e?.error?.message || "That did not work. Please try again."); }
      return r.json();
    };
    const start = await send("/api/studio/reels", "POST", { name, dur: Math.round(f.dur * 10) / 10, width: f.w, height: f.h, fps: Math.round(f.fps || 30), size, type: "video/mp4" }) as
      { id: string; direct: true; partSize: number; parts: { n: number; url: string }[] } | { id: string; direct: false; uploadUrl: string };
    try {
      if (start.direct) {
        const tags: { n: number; etag: string }[] = [], queue = [...start.parts];
        const put = async (at: string, a: number) => {
          for (let tries = 0; ; tries++) {
            try {
              const r = await io.fetch(at, { method: "PUT", body: await io.readBytes!(path, a, Math.min(size - a, start.partSize)) }), tag = (r as unknown as { headers?: { get(k: string): string | null } }).headers?.get("etag");
              if (!r.ok || !tag) throw new Error(`part ${r.status}`);
              return tag;
            } catch (e) { if (tries >= 3) throw e; await new Promise((ok) => setTimeout(ok, 1000 * 2 ** tries)); }
          }
        };
        const worker = async () => { for (let q = queue.shift(); q; q = queue.shift()) tags.push({ n: q.n, etag: await put(q.url, (q.n - 1) * start.partSize) }); };
        await Promise.all([worker(), worker(), worker()]);
        return await send(`/api/studio/reels/${start.id}/complete`, "POST", { parts: tags });
      }
      const up = await apiFetch(start.uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: await io.readBytes(path, 0, size) });
      if (!up.ok) throw new Error(`upload ${up.status}`);
      return await send(`/api/studio/reels/${start.id}/complete`, "POST", { parts: [] });
    } catch {
      await apiFetch(`/api/studio/reels/${start.id}`, { method: "DELETE" }).catch(() => {});
      throw new Error("Your Reel is saved on your phone, but it could not be saved to My Reels. Please try again.");
    }
  }

  async function readClip(c: Clip) {
    const p = `&p=${encodeURIComponent(c.path)}`, probe = await io.fetch(url("probe", p));
    if (!probe.ok) throw new Error(`This clip cannot be read: ${c.name}`);
    const facts = await probe.json() as ClipFacts, { dur, w, h } = facts, plan = editCopyOf(facts);
    // a heavy clip: its edit copy is what is read, previewed and exported (no copy made: the original goes on)
    let path = c.path, W = w, H = h;
    if (plan) {
      const made = await io.fetch(url("copy", `${p}&w=${plan.w}&h=${plan.h}&fps=30&b=${plan.bitrate}`), { method: "POST" });
      if (made.ok) { path = (await made.json() as { path: string }).path; W = plan.w; H = plan.h; copies.push({ name: c.name, path, w: plan.w, h: plan.h }); }
    }
    const q = `&p=${encodeURIComponent(path)}&dur=${dur}`;
    const scan = lastLine(await (await io.fetch(url("scan", q), { method: "POST" })).text(), "{");
    let raw: { t: number; rects: unknown[] }[] = [];
    try { raw = lastLine(await (await io.fetch(url("faces", `${q}&w=${W}&h=${H}`), { method: "POST" })).text(), "["); } catch { /* no faces read: the Reel is still made */ }
    host.addClip({ name: c.name, path, soundPath: c.path, dur, w: W, h: H, samples: scan.samples, scenes: scan.scenes, faces: host.brain.trackFaces(raw), faceHow: "blazeface" });
  }
  async function clips(a: Args) {
    const list = a.paths as Clip[], g = stops, names = list.map((c) => c.name), had = host.ES.sources.map((s: { name: string }) => s.name);
    const keep = had.every((n: string, i: number) => names.indexOf(n) >= 0 && (i === 0 || names.indexOf(n) > names.indexOf(had[i - 1])));
    if (!keep) { host.ES.sources.length = 0; }
    const known = host.ES.sources.map((s: { name: string }) => s.name), fresh = list.filter((c) => !known.includes(c.name));
    const failed: string[] = []; let lastError: unknown;
    reading++;
    if (fresh.length) io.task?.("start", "clips", "Reading your clips", `Finding the best moments in ${fresh.length} clip${fresh.length > 1 ? "s" : ""}`, "clips");
    try {
      for (let i = 0; i < fresh.length; i++) {
        if (stops !== g) break;
        io.task?.("progress", "clips", undefined, `Clip ${i + 1} of ${fresh.length}`, undefined, i / fresh.length);
        // a clip that cannot be read is named on its own card: the others go on
        try { await readClip(fresh[i]); io.clipDone?.(fresh[i].name, true); }
        catch (e) { failed.push(fresh[i].name); lastError = e; io.clipDone?.(fresh[i].name, false); }
        io.onProgress?.("clips", (i + 1) / fresh.length);
      }
      if (stops === g && !host.ES.sources.length && lastError) throw lastError;
      io.task?.(stops !== g ? "clear" : "done", "clips", `${host.ES.sources.length} clip${host.ES.sources.length > 1 ? "s" : ""} ready`);
    } catch (e) { io.task?.("fail", "clips", e instanceof Error ? e.message : "The clip could not be read"); throw e; }
    finally { reading--; }
    host.ES.sources.sort((x: { name: string }, y: { name: string }) => names.indexOf(x.name) - names.indexOf(y.name));
    read = list;
    if (stops === g) host.makeReel();
    return { clips: host.ES.sources.length, names: host.ES.sources.map((s: { name: string }) => s.name), failed };
  }
  const kfRow = () => { const T = host.brain.kfTarget(); return T ? { ok: true, index: T.i, what: T.what, a: T.a, b: T.b, keyframes: ((T.obj.uk || []) as Args[]).map((k) => ({ ...k })) } : null; };
  function state(){ return ({ edit: host.brain.editOf(), overlays: host.ES.overlays, mode: host.ES.mode, settings: { au: host.ES.au, capsOn: !!host.ES.capsOn, caplang: host.ES.capLang ?? "", captr: host.ES.trTo ?? "", textStyle: host.ES.textStyle ?? "pop" } }); }
  const work = () => ({ clips: host.ES.sources.length, shots: host.ES.edit.length, songReady: !!host.ES.song?.r, pending: reading });

  const ops: Record<string, (a: Args) => unknown> = {
    setup: async () => { signedIn = true; return { ok: true, ai: await host.account().catch(() => false) }; },
    song,
    songAgain: () => { if (!host.ES.song?.r) throw new Error("Add your song again"); return facts(); },
    cancel: () => { stops++; return { ok: true }; },
    clips,
    choose: async (a) => {
      if (a.mode) { host.ES.mode = String(a.mode); }
      if (a.order) host.ES.seqOn = a.order === "order";
      if (a.aspect) host.ES.aspect = String(a.aspect);
      if (a.length !== undefined) { host.sec.len = Number(a.length); host.sec.auto = true; await host.useSection(); }
      else host.makeReel();
      return { mode: host.ES.mode, start: host.ES.secStart ?? 0 };
    },
    part: async (a) => { host.sec.start = Number(a.start); host.sec.auto = false; await host.useSection(); return { start: host.ES.secStart ?? 0 }; },
    ready: () => ({ work: work(), state: state() }),
    state,
    edit: (a) => { const list = a.shots as Args[]; if (list.length) { const last = list[list.length - 1]; if (Number(last.end) < host.ES.buf.duration) last.end = host.ES.buf.duration; } const ok = !!host.brain.restoreEdit(list) || true; if (Array.isArray(a.overlays)) host.ES.overlays = a.overlays; return { ok }; },
    shotCs: () => host.brain.shotCs(),
    shotSet: (a) => { host.brain.shotSet(a.patch ?? null); return { ok: true, state: state() }; },
    shotOp: (a) => ({ ok: !!host.brain.shotOp(String(a.op), a.arg), state: state() }),
    shotSlip: (a) => ({ ok: host.brain.shotSlip(Number(a.delta) || 0), state: state() }),
    shotTrim: (a) => ({ ok: host.brain.shotTrim(Number(a.direction) || 1), state: state() }),
    seek: (a) => { host.ES.pos = Math.max(0, Number(a.time) || 0); return { time: host.ES.pos }; },
    remix: () => { host.brain.remixNow?.(); return { ok: true, state: state() }; },
    aiState: async () => { if (!signedIn) { signedIn = true; await host.account().catch(() => false); } return { on: !!host.ES.aiOn }; },
    ai: async () => { if (!signedIn) { signedIn = true; await host.account().catch(() => false); } const g = stops; const went = await host.runAi(); return { went: went && stops === g }; },
    newReel: () => { host.brain.newReel?.(); host.ES.regenOk = true; host.ES.reelId = ""; host.ES.aiReel = ""; host.ES.gateNo = ""; host.ES.director = null; return { ok: true }; },
    keptOldReel: () => ({ ok: true }),
    aiPlan: () => { const d = host.ES.director; return d && d.slots && !d.interim ? { story: d.story || "", lines: [] } : null; },
    undo: () => ({ ok: !!host.brain.histGo(true), state: state() }),
    redo: () => ({ ok: !!host.brain.histGo(false), state: state() }),
    kfSet: (a) => { host.brain.kfSet(a.values); return { ok: true }; },
    audioMix: (a) => { host.ES.au = { ...host.ES.au, ...(a as object), ...("mfout" in a ? { mfoutManual: true } : {}) }; host.ES.clipMixKey = ""; host.brain.applyVo(); return host.ES.au; },
    sfx: (a) => { host.ES.pos = Math.max(0, Number(a.time) || 0); host.brain.sfxAdd(String(a.kind)); return { ok: true }; },
    mark: (a) => { host.ES.pos = Math.max(0, Number(a.time) || 0); const f = ({ add: host.brain.addMark, del: host.brain.delMark, clear: host.brain.clearMarks } as Record<string, () => void>)[String(a.op)]; if (!f) return { ok: false }; f(); return { ok: true, state: state() }; },
    shotStyle: (a) => { const i = host.brain.segAt(host.ES.pos), e = host.ES.edit[i]; if (!e) throw new Error("There is no selected shot"); if (a.kind === "transition") e.tr = String(a.value); else if (a.kind === "effect") e.efx = String(a.value); return { ok: true, state: state() }; },
    exportOptions: async (a) => {
      const base = host.exportOptions(a) as Args, u = await myReelsRoom();
      return u ? { ...base, myReels: true, myReelsNote: `Also kept in your account, to watch, download or share anywhere · ${u.used} of ${u.limit} used` } : base;
    },
    saveToMyReels: (a) => saveToMyReels(String(a.path), String(a.name || "reel.mp4")),
    copies: () => copies,
    layerList: () => host.ES.layers.map((L: Args & { m: number; mk?: { w?: number; h?: number; th?: number; f?: number; a?: number; inv?: boolean }; key?: { on?: boolean; c?: string; tol?: number }; followOffsetX?: number; followOffsetY?: number; s: number; op: number; r: number }, index: number) => {
      const M = host.ES.lmedia[L.m as number] as { path?: string; kind?: string } | undefined;
      return { index, id: L.id, t0: L.t0, t1: L.t1, x: L.x, y: L.y, scale: L.s, opacity: L.op, rotation: L.r, mask: L.mask, blend: L.blend || "source-over", follow: L.follow || "none", followOffsetX: L.followOffsetX || 0, followOffsetY: L.followOffsetY || 0,
        maskWidth: L.mk?.w ?? 0.8, maskHeight: L.mk?.h ?? 0.8, maskThreshold: L.mk?.th ?? 0.5, maskFeather: L.mk?.f ?? 0.12, maskAngle: L.mk?.a ?? 0, maskInverted: !!L.mk?.inv, chromaKey: !!L.key?.on, chromaColor: L.key?.c ?? "#00FF00", chromaTolerance: L.key?.tol ?? 0.35,
        native: M?.path ? { path: M.path, kind: M.kind, t0: L.t0, t1: L.t1, in: L.in, x: L.x, y: L.y, s: L.s, r: L.r, op: L.op, fh: L.fh, fv: L.fv, fin: L.fin, fout: L.fout, crop: L.crop, mask: L.mask, mk: L.mk, rad: L.rad, key: L.key, blend: L.blend } : null };
    }),
    layerAdd: async (a) => {
      const path = String(a.path), name = String(a.name || "overlay"), p = await io.fetch(url("probe", `&p=${encodeURIComponent(path)}`));
      const video = /\.(mp4|mov|m4v|3gp|webm|mkv)$/i.test(name) && p.ok, facts = video ? await p.json() as { dur: number; w: number; h: number } : { dur: 0, w: Number(a.w) || 1080, h: Number(a.h) || 1080 };
      await host.brain.layerAdd([{ kind: video ? "video" : "photo", path, name, ...facts }]);
      return { ok: true, count: host.ES.layers.length };
    },
    layerSelect: async (a) => ({ ok: !!(await host.brain.lySelect(Number(a.index))), selected: Number(a.index) }),
    layerSet: (a) => { host.brain.lySet(String(a.key), a.value); return { ok: true }; },
    layerDelete: () => ({ ok: host.brain.lyDelete() }),
    ttsVoices: () => TTS_VOICES,
    ttsAdd: (a) => host.addTtsAtPlayhead(String(a.text || ""), String(a.voice || "")),
    ttsClear: () => ({ ok: host.brain.clearTts() }),
    captions: (a) => host.setCaptions(!!a.enabled, a.language === undefined ? undefined : String(a.language), a.translation === undefined ? undefined : String(a.translation)),
    captionStyle: (a) => { host.ES.textStyle = String(a.style || "pop"); return { style: host.ES.textStyle }; },
    template: (a) => { host.ES.pos = Math.max(0, Number(a.time) || 0); return { ok: host.addTemplate(String(a.key), undefined, host.ES.pos, undefined, false) > 0, state: state() }; },
    shotReverse: async () => ({ ok: await host.brain.shotReverse(), state: state() }),
    shotExtract: async () => { const e = host.ES.edit[host.brain.segAt(host.ES.pos)], s = e && host.ES.sources[e.src]; if (!s) return { ok: false }; await song({ path: s.path, name: s.name }); return { ok: true }; },
    kfSeek: async (a) => { await host.brain.kfSeek(Math.max(0, Number(a.time) || 0)); return kfRow(); },
    kfEase: (a) => { const T = host.brain.kfTarget(), k = T && host.brain.kfAtHead(T); if (!k) throw new Error("Select a keyframe first"); k.ez = String(a.easing || "inOut"); return kfRow(); },
    kfRemove: () => { const T = host.brain.kfTarget(), k = T && host.brain.kfAtHead(T); if (!k) throw new Error("There is no keyframe at the playhead"); T.obj.uk.splice(T.obj.uk.indexOf(k), 1); if (!T.obj.uk.length) delete T.obj.uk; return kfRow(); },
    kfClear: () => { const T = host.brain.kfTarget(); if (T) delete T.obj.uk; return kfRow(); },
    kfStep: async (a) => {
      const T = host.brain.kfTarget(); if (!T || T.what !== "shot") return { ok: false, time: host.ES.pos };
      const local = host.ES.pos - T.a, frames = (T.obj.uk || []) as { t: number }[], next = Number(a.direction) < 0 ? [...frames].filter((f) => f.t < local - 0.02).pop() : frames.find((f) => f.t > local + 0.02);
      if (!next) return { ok: false, time: host.ES.pos };
      await host.brain.kfSeek(T.a + next.t); return { ok: true, time: host.ES.pos };
    },
    chat: async (a) => { const r = await host.brain.chatApp(String(a.text || "").slice(0, 300)); return { ...r, state: state() }; },
    set: (a) => {
      const box = String(a.box), v = a.value;
      if (box === "vfx") { host.ES.au = { ...host.ES.au, vfx: String(v) }; host.brain.applyVo(); }
      else if (box === "aitouch") { host.ES.au = { ...host.ES.au, ai: !!v }; host.brain.autoTools(); host.brain.applyVo(); host.ES.clipMixKey = ""; }
      else if (box === "look") host.ES.look = String(v);
      else if (box === "mode") { host.ES.mode = String(v); host.makeReel(); }
      else if (box === "seq") { host.ES.seqOn = v === "order"; host.makeReel(); }
      else if (box === "aspect") host.ES.aspect = String(v);
      else throw new Error(`The phone's own engine has no ${box}`);
      return { work: work(), state: state() };
    },
    exportMix: async (a) => {
      host.exportChoose(a); if (a.fixLocked) host.exportFix();
      await host.brain.ensureMix();
      const s = host.brain.exportSound(), plan = host.exportPlan();
      if (!s) return { path: null, plan };
      const res = await io.fetch(url("out", `&name=${encodeURIComponent(String(a.name || "mix.wav"))}`), { method: "PUT", body: new Uint8Array(wavOf(s.buf, s.gain)) });
      if (!res.ok) throw new Error("The Reel's sound could not be saved on the phone");
      return { ...(await res.json() as Args), plan };
    },
  };
  const NOT_YET: string[] = [];
  return {
    has: (op: string) => op in ops, notYet: NOT_YET, ascii, read: () => read, host: () => host,
    fresh: () => { stops++; read = []; copies = []; signedIn = false; host = make(); },
    call: async (op: string, a: Args = {}) => { const f = ops[op]; if (!f) throw new Error(`Not on the phone's own engine yet: ${op}`); return f(a); },
  };
}
