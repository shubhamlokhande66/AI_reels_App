import { createHost, soundOf } from "../engine/brain/host";
import initial from "../engine/brain/initial-state.json";

/** The studio with no page: the operations of the hidden page's bridge (engine/components/studio/bridge.ts), run on the brain in the app's own
 * JS, with the phone's own code doing the heavy work through its file server (SongAnalysis.kt, ClipScan.kt, ClipFaces.kt). On only when the
 * build says so (EXPO_PUBLIC_NATIVE_ENGINE): until the operations marked below are written, the page stays the app's engine. */
export const NATIVE_ENGINE = process.env.EXPO_PUBLIC_NATIVE_ENGINE === "1";

type Fetch = (url: string, init?: { method?: string; body?: unknown }) => Promise<{ ok: boolean; status: number; text(): Promise<string>; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
export type NativeIo = { base: string; key: string; fetch: Fetch; token?: () => Promise<string | null>; onProgress?: (what: "song" | "clips", p: number) => void;
  /** Shubix AI's question: true Use, false the other button, null closed */
  ask?: (q: { title: string; text: string; list?: string[]; bal?: number | null; ok: string; no?: string; after?: number | null }) => Promise<boolean | null>;
  /** what Shubix is doing, in its words; an error when `err` */
  stat?: (text: string, err?: boolean) => void; spent?: () => void };
type Args = Record<string, unknown>;
type Clip = { path: string; name: string };

const ascii = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return s; };

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

/** The Reel's whole sound as a 16-bit WAV: the studio's gain with its tiny fades, the peak brought to -0.5 dBFS */
export function wavOf(buf: { length: number; sampleRate: number; numberOfChannels: number; getChannelData(c: number): Float32Array }, gain: number) {
  const n = buf.length, sr = buf.sampleRate, L = buf.getChannelData(0), R = buf.getChannelData(Math.min(1, buf.numberOfChannels - 1)), a = Math.round(0.02 * sr), z = Math.round(0.25 * sr);
  const at = (i: number) => (i < a ? i / a : 1) * (i > n - z ? Math.max(0, (n - i) / z) : 1) * gain;
  let peak = 0; for (let i = 0; i < n; i++) { const g = at(i); peak = Math.max(peak, Math.abs(L[i] * g), Math.abs(R[i] * g)); }
  const k = peak > 0.944 ? 0.944 / peak : 1, out = new ArrayBuffer(44 + n * 4), v = new DataView(out);
  const tag = (o: number, t: string) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  tag(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); tag(8, "WAVE"); tag(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); tag(36, "data"); v.setUint32(40, n * 4, true);
  for (let i = 0, o = 44; i < n; i++, o += 4) { const g = at(i) * k; v.setInt16(o, Math.max(-1, Math.min(1, L[i] * g)) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i] * g)) * 32767, true); }
  return out;
}

export function createNativeEngine(io: NativeIo) {
  const make = () => createHost(JSON.stringify(initial), { analyse: (m: Float32Array, sr: number, opts: Args) => analyse(m, sr, opts), getCtx, apiFetch, aiFrames, ask: (q: Parameters<NonNullable<NativeIo["ask"]>>[0]) => io.ask ? io.ask(q) : Promise.resolve(null), stat: io.stat, spent: io.spent });
  let host = make(), signedIn = false;
  let stops = 0, read: Clip[] = [], reading = 0;
  const url = (path: string, q = "") => `${io.base}/${path}?k=${io.key}${q}`;
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
  async function analyse(mono: Float32Array, sr: number, opts: Args = {}) {
    const head = new TextEncoder().encode(JSON.stringify({ ...opts, sr })), body = new Uint8Array(4 + head.length + mono.byteLength);
    new DataView(body.buffer).setUint32(0, head.length, true); body.set(head, 4); body.set(new Uint8Array(mono.buffer, mono.byteOffset, mono.byteLength), 4 + head.length);
    const res = await io.fetch(url("song"), { method: "POST", body });
    if (!res.ok) throw new Error(await res.text());
    const r = await res.json() as Args & { rmsF: number[]; pfArr: number[]; onEnv: number[] };
    return { ...r, rmsF: Float32Array.from(r.rmsF), pfArr: Float32Array.from(r.pfArr), onEnv: Float64Array.from(r.onEnv) };
  }
  async function song(a: Args) {
    const g = stops, path = String(a.path), name = String(a.name), res = await io.fetch(url("sound", `&p=${encodeURIComponent(path)}`));
    if (!res.ok) throw new Error("This file has no sound we can read. Try an MP3, M4A or WAV.");
    const { sampleRate, channels, mono } = pcmOf(await res.arrayBuffer());
    if (stops !== g) throw new Error("Stopped");
    const r = await analyse(mono, sampleRate);
    if (stops !== g) throw new Error("Stopped");
    await host.setSong({ channels, mono, r, name, sampleRate });
    host.brain.sectionFacts?.();
    return facts();
  }
  const facts = () => { const r = host.ES.song.r as { period: number; beats: number[]; cutType: string[] }, n = (k: string) => r.cutType.filter((t) => t === k).length; return { duration: host.ES.buf.duration, bpm: Math.round(60 / r.period), beats: r.beats.length, drops: n("drop"), breaks: n("break") }; };

  async function readClip(c: Clip) {
    const p = `&p=${encodeURIComponent(c.path)}`, probe = await io.fetch(url("probe", p));
    if (!probe.ok) throw new Error(`This clip cannot be read: ${c.name}`);
    const { dur, w, h } = await probe.json() as { dur: number; w: number; h: number };
    const scan = lastLine(await (await io.fetch(url("scan", `${p}&dur=${dur}`), { method: "POST" })).text(), "{");
    let raw: { t: number; rects: unknown[] }[] = [];
    try { raw = lastLine(await (await io.fetch(url("faces", `${p}&dur=${dur}&w=${w}&h=${h}`), { method: "POST" })).text(), "["); } catch { /* no faces read: the Reel is still made */ }
    host.addClip({ name: c.name, path: c.path, dur, w, h, samples: scan.samples, scenes: scan.scenes, faces: host.brain.trackFaces(raw), faceHow: "blazeface" });
  }
  async function clips(a: Args) {
    const list = a.paths as Clip[], g = stops, names = list.map((c) => c.name), had = host.ES.sources.map((s: { name: string }) => s.name);
    const keep = had.every((n: string, i: number) => names.indexOf(n) >= 0 && (i === 0 || names.indexOf(n) > names.indexOf(had[i - 1])));
    if (!keep) { host.ES.sources.length = 0; }
    const known = host.ES.sources.map((s: { name: string }) => s.name), fresh = list.filter((c) => !known.includes(c.name));
    reading++;
    try {
      for (let i = 0; i < fresh.length; i++) { if (stops !== g) break; await readClip(fresh[i]); io.onProgress?.("clips", (i + 1) / fresh.length); }
    } finally { reading--; }
    host.ES.sources.sort((x: { name: string }, y: { name: string }) => names.indexOf(x.name) - names.indexOf(y.name));
    read = list;
    if (stops === g) host.makeReel();
    return { clips: host.ES.sources.length, names: host.ES.sources.map((s: { name: string }) => s.name) };
  }
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
    exportOptions: (a) => host.exportOptions(a),
    copies: () => [],
    frame: () => ({ src: "" }),
    layerList: () => [],
    ttsVoices: () => host.values.ttsVoices ?? [],
    cancelExport: () => ({ ok: true }),
    brainCheck: () => ({ copy: "{}", shots: [] }),
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
  // not written yet: the app's page is still needed for these
  const NOT_YET = ["answer", "chat", "exportReel", "kfSeek", "kfEase", "kfRemove", "kfClear", "kfStep", "template", "layerAdd", "layerSelect", "layerSet", "layerDelete", "ttsAdd", "ttsClear", "captions", "captionStyle", "shotExtract", "shotReverse", "set"];
  return {
    has: (op: string) => op in ops, notYet: NOT_YET, ascii, read: () => read, host: () => host,
    fresh: () => { stops++; read = []; signedIn = false; host = make(); },
    call: async (op: string, a: Args = {}) => { const f = ops[op]; if (!f) throw new Error(`Not on the phone's own engine yet: ${op}`); return f(a); },
  };
}
