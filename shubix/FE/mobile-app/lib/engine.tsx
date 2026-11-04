import { useRef } from "react";
import { Platform, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { askAction, tasks, type TaskKind } from "@mobile/ui-mobile";
import { ShubixVideo } from "../modules/shubix-video";
import { clipDuration, type ProjectClip, type ReelProject } from "@mobile/validations";
import { buildSpeedRampSegments } from "@mobile/video-engine";
import { tokenStore } from "./device";
import { API_URL } from "./session";

/** The phone's own engine makes its Reels: the page in FE/mobile-app/engine (its own code, worked through
 * components/studio/bridge.ts), built into the APK and run hidden in the phone's browser engine. It does not come from
 * the website, so changing or deploying the website does not change the phone. The phone's screens stay its own; the
 * engine's task cards come over to the phone's (tasks). The app's little server (modules/shubix-video FileServer.kt)
 * serves the page, its files and its API calls, so this needs the app's own build (not Expo Go).
 * TODO (later): the same engine in Kotlin, without the hidden page (docs/roadmap.md). */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/$/, "");
export type AiPlan = { story: string; lines: string[] };
export type SongAnalysis = { duration: number; bpm: number; beats: number; drops: number; breaks: number };
/** a shot of the Reel as the studio made it (its state(): the clip, where in it, the transition into it, its effect, its speed) */
export type EngineShot = { start: number; end: number; type: string; tr?: string; efx?: string; sp: string; src: number; in: number; cs?: Record<string, unknown>; uk?: NonNullable<ProjectClip["keyframes"]> };
export type EngineReel = { work: { clips: number; shots: number }; state: { edit: EngineShot[]; mode?: string } & Record<string, unknown> };
/** the website's Export sheet: quality, frame rate, the watermark, without the song */
export type ExportChoice = { res?: "720" | "1080" | "4k"; fps?: 30 | 60; noWatermark?: boolean; noSong?: boolean; myReels?: boolean; fixLocked?: boolean };
export type ExportOptions = { res: Record<"720" | "1080" | "4k", { locked: boolean; off: boolean }>; fps60Locked: boolean; watermarkOff: boolean;
  size: string; fileName: string; myReels: boolean; myReelsNote: string; locked: { name: string; need: string }[] };

type Waiting = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Page = { injectJavaScript: (js: string) => void; reload: () => void };
const waiting = new Map<number, Waiting>();
let page: Page | null = null, held = "", next = 1, ready: (() => void) | null = null, isReady = new Promise<void>((r) => { ready = r; }), setUp = false;
const files = ShubixVideo ? ShubixVideo.fileServer(API_URL) : null;

/** whether this phone can make Reels with the studio (the app's own build, not Expo Go or the web) */
export const engineOn = Platform.OS !== "web" && !!files;

async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!engineOn) throw new Error("Making Reels needs the Shubix app (not Expo Go).");
  await isReady;
  if (!setUp && op !== "setup") { setUp = true; await call("setup", { files: `http://127.0.0.1:${files!.port}`, key: files!.key, token: await tokenStore.get() }); }
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    page?.injectJavaScript(`window.engine.call(${id}, ${JSON.stringify(op)}, ${JSON.stringify(args)}); true;`);
  });
}
/** the studio's texts as the phone keeps them (its own: a number id, t0 / t1, size as a multiple of 36); every setting kept */
export function textsOf(list: unknown): ReelProject["overlays"] | undefined {
  if (!Array.isArray(list)) return undefined;
  return (list as Record<string, unknown>[]).filter((o) => typeof o.text === "string" && o.kind !== "squareFrame").map((o) => {
    const start = Math.max(0, Number(o.start ?? o.t0) || 0), size = Number(o.size) || 1;
    const { box: _b, t0: _a, t1: _z, all: _l, ...rest } = o;
    return { ...rest, id: String(o.id), text: String(o.text).slice(0, 300), start, end: Math.max(start + 0.05, Number(o.end ?? o.t1) || start + 3), color: String(o.color || "#FFFFFF"),
      size: Math.max(8, Math.min(120, size > 4 ? size : Math.round(size * 36))) } as ReelProject["overlays"][number];
  });
}
const pathOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

export const engine = {
  /** the song: the website analyses it (beats, drops, breaks) and checks its beats */
  song: (uri: string, name: string) => call<SongAnalysis>("song", { path: pathOf(uri), name }),
  /** the Reel's choices, as the website's buttons: length (0 = the whole song), clip order, format, style */
  choose: (c: { length?: number; order?: "mix" | "order"; aspect?: string; mode?: "auto" | "smooth" | "fast" }) => call<{ start: number }>("choose", c),
  /** the song's part moved on the waves: the Reel uses the song from `start` */
  part: (start: number) => call<{ start: number }>("part", { start }),
  /** the clips: the website reads them (motion, scenes, faces) and makes the Reel on the beats */
  clips: (list: { uri: string; name: string }[]) => call<{ clips: number; names: string[] }>("clips", { paths: list.map((c) => ({ path: pathOf(c.uri), name: c.name })) }),
  /** once the Reel is made: its shots (`id`: the phone's draft, which the studio now holds) */
  ready: (id: string) => call<EngineReel>("ready").then((r) => { held = id; return r; }),
  /** whether the studio holds this draft as it made it (then the website's export makes it, with its transitions and effects) */
  holds: (id: string) => engineOn && held === id,
  /** the website's export of the Reel the studio holds: the MP4 on the phone */
  /** the Reel as the phone's editor changed it, back in the studio (its order, trims, speeds, transitions, effects), so
   * the website's export still makes it; false when the studio cannot make it so (a new clip, a turned or mirrored clip,
   * a filter: then the phone's export makes it) */
  edit: async (p: ReelProject) => {
    if (!engine.holds(p.id)) return false;
    const list = [];
    let t = 0;
    for (const c of p.clips) {
      const from = made.get(c.id) ?? [...made.values()].find((candidate) => candidate.clip.uri === c.uri && candidate.clip.kind === c.kind);
      if (!from || KEEP.some((k) => c[k] !== from.clip[k])) return false;
      const len = clipDuration(c);
      const hasRamp = !!c.speedRamp?.length;
      const sp = hasRamp ? "curve" : ((SPEED[from.shot.sp] ?? 1) === c.speed ? from.shot.sp : Object.keys(SPEED).find((k) => SPEED[k] === c.speed));
      if (!sp) return false; // a fixed speed the studio has not (it has slow, normal, fast)
      const base = from.shot;
      const cs = { ...(base.cs ?? {}) };
      if (hasRamp) {
        const segments = buildSpeedRampSegments(c.speedRamp!, c.end - c.start, { fallbackSpeed: c.speed, maxSegmentDuration: 0.2 });
        const sample = (timelineTime: number) => {
          const segment = segments.find((item) => timelineTime <= item.outputEnd + 0.0001) ?? segments[segments.length - 1];
          return segment?.speed ?? c.speed;
        };
        cs.curve = { a: sample(0), b: sample(len * 0.25), c: sample(len * 0.5), d: sample(len * 0.75), e: sample(len) };
      }
      if (c.reverse !== from.clip.reverse) cs.rev = c.reverse;
      if (c.rotation !== from.clip.rotation) cs.rot = c.rotation;
      if (c.mirror !== from.clip.mirror) cs.fh = c.mirror;
      if (c.flip !== from.clip.flip) cs.fv = c.flip;
      if (c.fit !== from.clip.fit) cs.fit = c.fit === "contain";
      if (c.muted !== from.clip.muted || c.volume !== from.clip.volume) cs.vol = c.muted ? 0 : c.volume;
      list.push({ ...from.shot, ...(Object.keys(cs).length ? { cs } : {}), start: t, end: t + len, in: c.start, sp, tr: c.transition === "hard" ? undefined : c.transition, efx: c.effect, uk: c.keyframes ?? from.shot.uk });
      t += len;
    }
    return (await call<{ ok: boolean }>("edit", { shots: list, overlays: p.overlays })).ok;
  },
  /** Studio history (including advanced tools) mapped back into the phone's clip model. */
  undo: async () => {
    if (!held) return { ok: false as const };
    const result = await call<{ ok: boolean; state?: { edit?: EngineShot[]; overlays?: ReelProject["overlays"] } }>("undo");
    if (!result.ok || !Array.isArray(result.state?.edit)) return { ok: false as const };
    return { ok: true as const, clips: shotsOf(result.state.edit, sources), overlays: textsOf(result.state.overlays) };
  },
  redo: async () => {
    if (!held) return { ok: false as const };
    const result = await call<{ ok: boolean; state?: { edit?: EngineShot[]; overlays?: ReelProject["overlays"] } }>("redo");
    if (!result.ok || !Array.isArray(result.state?.edit)) return { ok: false as const };
    return { ok: true as const, clips: shotsOf(result.state.edit, sources), overlays: textsOf(result.state.overlays) };
  },
  /** Ask Studio for another locally generated edit, then map its shots back to the native clip model. */
  remix: async () => {
    if (!held) return { ok: false as const };
    const result = await call<{ ok: boolean; state?: { edit?: EngineShot[]; overlays?: ReelProject["overlays"] } }>("remix");
    if (!result.ok || !Array.isArray(result.state?.edit)) return { ok: false as const };
    return { ok: true as const, clips: shotsOf(result.state.edit, sources), overlays: textsOf(result.state.overlays) };
  },
  /** a choice in one of the editor's tools, made in the studio as on the website (its button `attr`=`value` in `box`,
   * or its input `box` set to `value`), the editor's changes sent first: the Reel's clips after it; null when the studio
   * does not hold this Reel as it is (then the phone does what it can) */
  tool: (op: string, args: Record<string, unknown> = {}) => call<Record<string, unknown>>(op, args),
  /** the creator's own beat markers (add at `time`, del the one there, clear): the Reel's clips after the edit is made again */
  mark: async (p: ReelProject, op: "add" | "del" | "clear", time: number) => {
    if (!(await engine.edit(p))) return null;
    const r = await call<{ ok: boolean; state?: { edit?: EngineShot[] } }>("mark", { op, time });
    return r.ok && Array.isArray(r.state?.edit) ? shotsOf(r.state!.edit!, sources) : null;
  },
  addLayer: (uri: string, name: string) => call<Record<string, unknown>>("layerAdd", { path: pathOf(uri), name }),
  set: async (p: ReelProject, box: string, value: string | boolean, attr?: string) => {
    if (!(await engine.edit(p))) return null;
    return shotsOf((await call<EngineReel>("set", { box, value, ...(attr ? { attr } : {}) })).state.edit, sources);
  },
  exportReel: (name: string, o: ExportChoice = {}) => call<{ path: string; size: number; caption?: string }>("exportReel", { name, ...o }).then((r) => ({ uri: `file://${r.path}`, size: r.size, caption: r.caption ?? "" })),
  /** the website's Export sheet with these choices: what the plan and the phone allow, the size, the file name, My Reels */
  exportOptions: (o: ExportChoice = {}) => call<ExportOptions>("exportOptions", o),
  cancelExport: () => call("cancelExport").catch(() => undefined),
  /** the Reel's picture at `t` exactly as the studio makes it (null: it could not) */
  frame: (t: number) => call<{ src: string }>("frame", { t }).then((r) => r.src || null).catch(() => null),
  /** a new Reel: the studio's page is loaded again, so nothing of the Reel before it stays (song, clips, edit, AI, cards);
   * it signs in again and reads the plan and credits anew on its first call */
  fresh: () => restart("A new Reel was started."),
  /** what Shubix AI planned for the Reel the studio holds: its story and a line per shot; null when it did not edit it */
  aiPlan: () => call<AiPlan | null>("aiPlan"),
  /** everything the studio is doing stops (the person left the screen that asked for it): its page starts fresh */
  stop: () => restart(STOPPED),
  /** the clips' smooth copies the studio made (4K / HDR / 60 fps / a changing frame rate), saved on the phone: the
   * phone's preview and export play these, so heavy footage never stutters or stalls (`name`: the clip as sent) */
  copies: () => call<{ name: string; path: string; w: number; h: number }[]>("copies").catch(() => []),
  /** Ask Shubix from the editor: the website's own AI chat on the Reel the studio holds; its plan is applied there and
   * the Reel's clips come back (null: the studio does not hold this Reel) */
  chat: async (p: ReelProject, text: string) => {
    if (!engine.holds(p.id)) return null;
    await engine.edit(p).catch(() => false);
    const r = await call<{ answer: string; applied: boolean; state?: { edit?: EngineShot[]; overlays?: ReelProject["overlays"] } }>("chat", { text });
    return { answer: r.answer, clips: r.applied && Array.isArray(r.state?.edit) ? shotsOf(r.state!.edit!, sources) : null, overlays: textsOf(r.state?.overlays) };
  },
};

// the studio's speeds as the phone plays them (ramps, freezes and curves play at 1× here; the studio's export keeps them)
const SPEED: Record<string, number> = { normal: 1, slow: 0.5, fast: 1.6 };
// each clip the studio made: its shot (engine.edit sends it back changed) and the clip as made (what the studio cannot change)
const made = new Map<string, { shot: EngineShot; clip: ProjectClip }>();
let sources: ProjectClip[] = [];
const KEEP = ["uri", "filter"] as const;
/** The Reel's shots as the phone editor's clips: each shot its part of its clip (from `in`, as long as the shot at its
 * speed), the transition into it and its effect. `list`: the clips the studio kept, in its order (its `src`). */
export function shotsOf(shots: EngineShot[], list: ProjectClip[]): ProjectClip[] {
  made.clear(); sources = list;
  return shots.map((e, i) => {
    const c = list[e.src] ?? list[0], speed = SPEED[e.sp] ?? 1, len = (e.end - e.start) * speed;
    const start = c.kind === "image" ? 0 : Math.min(Math.max(0, e.in), Math.max(0, c.sourceDuration - 0.1));
    const end = c.kind === "image" ? e.end - e.start : Math.min(c.sourceDuration, start + Math.max(0.1, len));
    const clip = { ...c, id: `${c.id}-s${i}`, start, end, duration: end - start, speed: c.kind === "image" ? 1 : speed, transition: e.tr || "hard", effect: e.efx || undefined, keyframes: e.uk, ...(e.cs ? { cs: e.cs } : {}) };
    made.set(clip.id, { shot: e, clip });
    return clip;
  });
}

// the studio's task cards ("studio-task") on the phone's
type TaskEvent = { event: "task"; id: string; kind?: TaskKind; state: "start" | "progress" | "done" | "fail" | "clear"; p: number | null; title?: string; detail?: string };
const shown = new Set<string>(); // the studio's cards on screen now (cleared when it starts again)
function onTask(t: TaskEvent) {
  if (t.state === "start" || t.state === "progress") shown.add(t.id); else shown.delete(t.id);
  if (t.state === "start") tasks.start(t.id, t.kind ?? "ai", t.title ?? "", t.detail ?? "");
  else if (t.state === "progress") tasks.update(t.id, t.p, t.detail, t.title);
  else if (t.state === "done") tasks.done(t.id, t.title);
  else if (t.state === "fail") tasks.fail(t.id, t.title ?? "");
  else tasks.clear(t.id);
}
// the studio's question (Shubix AI's credits: "Shubix AI will edit this Reel", Use 10 credits) asked on the phone, its answer pressed there
type AskEvent = { event: "ask"; title: string; text: string; list: string[]; balance: string; ok: string; no: string };
async function onAsk(q: AskEvent) {
  const v = await askAction({ title: q.title, body: [q.text, q.balance].filter(Boolean).join(" · "), list: q.list, ok: q.ok, ...(q.no ? { cancel: q.no } : {}) });
  void call("answer", { pick: v === 0 ? "ok" : v === 1 && q.no ? "no" : "close" });
}
function onMessage(e: WebViewMessageEvent) {
  const m = JSON.parse(e.nativeEvent.data) as { id: number; ok: boolean; result?: unknown; error?: string } | TaskEvent | AskEvent;
  if ("event" in m) return m.event === "ask" ? void onAsk(m) : onTask(m);
  if (m.id === 0) return ready?.();
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error));
}

/** said when the person left the screen that asked: nobody is there to show it */
export const STOPPED = "Stopped.";
// the studio starts again (the phone stopped its page, out of memory, or the person left): what it was doing fails
function restart(why = "The phone stopped the studio. Please try again.") {
  waiting.forEach((w) => w.reject(new Error(why))); waiting.clear(); shown.forEach((id) => tasks.clear(id)); shown.clear();
  setUp = false; held = ""; isReady = new Promise<void>((r) => { ready = r; }); page?.reload();
}

/** The studio's page, hidden (behind everything, never touched): mounted once at the app's root. Not opacity 0:
 * Android never draws a fully transparent view, and a WebView that is never drawn gets no frames (no animation frames,
 * its videos barely decode): reading clips took minutes in the app and seconds in Chrome. 0.01 is drawn yet unseen. */
export function EngineHost() {
  if (!engineOn) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: 390, height: 844, opacity: 0.01, zIndex: -1 }}>
      <WebView ref={(w: Page | null) => { page = w; }} source={{ uri: `http://127.0.0.1:${files!.port}/engine` }} onMessage={onMessage} javaScriptEnabled domStorageEnabled
        mixedContentMode="always" mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback webviewDebuggingEnabled={__DEV__ || process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === "1"}
        onContentProcessDidTerminate={() => restart()} onRenderProcessGone={() => restart()} />
    </View>
  );
}
