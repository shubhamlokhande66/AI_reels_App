import { useRef } from "react";
import { Platform, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { askAction, tasks, type TaskKind } from "@shubix/ui-mobile";
import { ShubixVideo } from "../modules/shubix-video";
import { clipDuration, type ProjectClip, type ReelProject } from "@shubix/validations";
import { buildSpeedRampSegments } from "@shubix/video-engine";
import { tokenStore } from "./device";

/** The website's own Fast Studio makes the phone's Reels: its page /engine (FE/web-app app/engine, worked through
 * components/studio/bridge.ts) runs hidden in the phone's browser engine, so the song's analysis, the beat check, the
 * clips' reading, the cuts on the beat, the transitions, the effects and the MP4 are the website's, exactly. The phone's
 * screens stay its own; the studio's task cards come over to the phone's (tasks). The studio reads the phone's files
 * through the app's little server (modules/shubix-video FileServer.kt), so this needs the app's own build (not Expo Go).
 * EXPO_PUBLIC_SITE_URL: the website; while developing the computer's (adb reverse tcp:3001 tcp:3001: on the phone
 * "localhost", which the browser engine trusts for making videos).
 * TODO (later): the same engine in Kotlin, without the hidden page (docs/roadmap.md). */
export const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL || "http://localhost:3001").replace(/\/$/, "");
export type SongAnalysis = { duration: number; bpm: number; beats: number; drops: number; breaks: number };
/** a shot of the Reel as the studio made it (its state(): the clip, where in it, the transition into it, its effect, its speed) */
export type EngineShot = { start: number; end: number; type: string; tr?: string; efx?: string; sp: string; src: number; in: number; cs?: Record<string, unknown>; uk?: NonNullable<ProjectClip["keyframes"]> };
export type EngineReel = { work: { clips: number; shots: number }; state: { edit: EngineShot[]; mode?: string } & Record<string, unknown> };

type Waiting = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Page = { injectJavaScript: (js: string) => void; reload: () => void };
const waiting = new Map<number, Waiting>();
const ENGINE_READY_TIMEOUT_MS = 45_000;
const ENGINE_CALL_TIMEOUT_MS = 12 * 60_000;
let page: Page | null = null, held = "", next = 1, ready: (() => void) | null = null;
let isReady = new Promise<void>((r) => { ready = r; });
let setUp = false, setupPromise: Promise<void> | null = null, generation = 0;
const files = ShubixVideo ? ShubixVideo.fileServer() : null;

/** whether this phone can make Reels with the studio (the app's own build, not Expo Go or the web) */
export const engineOn = Platform.OS !== "web" && !!files;

function resetReady() {
  isReady = new Promise<void>((resolve) => { ready = resolve; });
}
function rejectPending(message: string) {
  waiting.forEach((entry) => {
    clearTimeout(entry.timer);
    entry.reject(new Error(message));
  });
  waiting.clear();
}
async function waitUntilReady() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      isReady,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Shubix Studio is taking too long to start. Check your connection and try again.")), ENGINE_READY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function ensureSetup() {
  if (setUp) return;
  if (!setupPromise) {
    const startedAt = generation;
    const pending = (async () => {
      await call("setup", { files: `http://127.0.0.1:${files!.port}`, key: files!.key, token: await tokenStore.get() });
      if (startedAt !== generation) throw new Error("Shubix Studio restarted during setup. Please try again.");
      setUp = true;
    })();
    setupPromise = pending;
  }
  const pending = setupPromise;
  try { await pending; }
  finally { if (setupPromise === pending) setupPromise = null; }
}
async function call<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!engineOn) throw new Error("Making Reels needs the Shubix app (not Expo Go).");
  await waitUntilReady();
  if (!page) throw new Error("Shubix Studio is not connected to the Android app. Reopen the screen and try again.");
  if (!setUp && op !== "setup") await ensureSetup();
  const id = next++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("Shubix Studio did not respond in time. Your draft is still on this phone; try the action again."));
    }, ENGINE_CALL_TIMEOUT_MS);
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    try {
      if (!page) throw new Error("Shubix Studio disconnected before the request was sent.");
      page.injectJavaScript(`window.engine.call(${id}, ${JSON.stringify(op)}, ${JSON.stringify(args)}); true;`);
    } catch (error) {
      clearTimeout(timer);
      waiting.delete(id);
      reject(error instanceof Error ? error : new Error("Shubix Studio could not receive the request."));
    }
  });
}
const pathOf = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ""));

export const engine = {
  /** the song: the website analyses it (beats, drops, breaks) and checks its beats */
  song: async (uri: string, name: string) => {
    const result = await call<SongAnalysis>("song", { path: pathOf(uri), name });
    if (!result || !Number.isFinite(result.duration) || result.duration <= 0 ||
        !Number.isFinite(result.bpm) || result.bpm <= 0 ||
        !Number.isFinite(result.beats) || result.beats < 0 ||
        !Number.isFinite(result.drops) || result.drops < 0 ||
        !Number.isFinite(result.breaks) || result.breaks < 0) {
      throw new Error("Shubix could not analyse this song reliably. Choose another audio file and try again.");
    }
    return result;
  },
  /** the Reel's choices, as the website's buttons: length (0 = the whole song), clip order, format, style */
  choose: (c: { length?: number; order?: "mix" | "order"; aspect?: string; mode?: "auto" | "smooth" | "fast" }) => call<{ start: number }>("choose", c),
  /** the song's part moved on the waves: the Reel uses the song from `start` */
  part: (start: number) => call<{ start: number }>("part", { start }),
  /** the clips: the website reads them (motion, scenes, faces) and makes the Reel on the beats */
  clips: (list: { uri: string; name: string }[]) => call<{ clips: number; names: string[] }>("clips", { paths: list.map((c) => ({ path: pathOf(c.uri), name: c.name })) }),
  /** once the Reel is made: its shots (`id`: the phone's draft, which the studio now holds) */
  ready: async (id: string) => {
    const result = await call<EngineReel>("ready");
    if (!result || !Array.isArray(result.state?.edit) || result.state.edit.length < 2 ||
        !Number.isFinite(result.work?.clips) || result.work.clips < 1 ||
        !Number.isFinite(result.work?.shots) || result.work.shots < 2) {
      held = "";
      throw new Error("Shubix AI could not build a complete Reel from these clips. Add more usable footage and try again.");
    }
    held = id;
    return result;
  },
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
    return { ok: true as const, clips: shotsOf(result.state.edit, sources), overlays: result.state.overlays };
  },
  redo: async () => {
    if (!held) return { ok: false as const };
    const result = await call<{ ok: boolean; state?: { edit?: EngineShot[]; overlays?: ReelProject["overlays"] } }>("redo");
    if (!result.ok || !Array.isArray(result.state?.edit)) return { ok: false as const };
    return { ok: true as const, clips: shotsOf(result.state.edit, sources), overlays: result.state.overlays };
  },
  /** Ask Studio for another locally generated edit, then map its shots back to the native clip model. */
  remix: async () => {
    if (!held) return { ok: false as const };
    const result = await call<{ ok: boolean; state?: { edit?: EngineShot[]; overlays?: ReelProject["overlays"] } }>("remix");
    if (!result.ok || !Array.isArray(result.state?.edit)) return { ok: false as const };
    return { ok: true as const, clips: shotsOf(result.state.edit, sources), overlays: result.state.overlays };
  },
  /** a choice in one of the editor's tools, made in the studio as on the website (its button `attr`=`value` in `box`,
   * or its input `box` set to `value`), the editor's changes sent first: the Reel's clips after it; null when the studio
   * does not hold this Reel as it is (then the phone does what it can) */
  tool: (op: string, args: Record<string, unknown> = {}) => call<Record<string, unknown>>(op, args),
  addLayer: (uri: string, name: string) => call<Record<string, unknown>>("layerAdd", { path: pathOf(uri), name }),
  set: async (p: ReelProject, box: string, value: string | boolean, attr?: string) => {
    if (!(await engine.edit(p))) return null;
    return shotsOf((await call<EngineReel>("set", { box, value, ...(attr ? { attr } : {}) })).state.edit, sources);
  },
  exportReel: async (name: string) => {
    const result = await call<{ path: string; size: number }>("exportReel", { name });
    if (!result || typeof result.path !== "string" || !result.path.startsWith("/") ||
        !Number.isFinite(result.size) || result.size <= 0) {
      throw new Error("Android Studio returned an invalid MP4. Your editable draft is still saved; please retry export.");
    }
    return { uri: `file://${result.path}`, size: result.size };
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
    const clip = { ...c, id: `${c.id}-s${i}`, start, end, duration: end - start, speed: c.kind === "image" ? 1 : speed, transition: e.tr || "hard", effect: e.efx || undefined, keyframes: e.uk };
    made.set(clip.id, { shot: e, clip });
    return clip;
  });
}

// the studio's task cards ("studio-task") on the phone's
type TaskEvent = { event: "task"; id: string; kind?: TaskKind; state: "start" | "progress" | "done" | "fail" | "clear"; p: number | null; title?: string; detail?: string };
function onTask(t: TaskEvent) {
  if (t.state === "start") tasks.start(t.id, t.kind ?? "ai", t.title ?? "", t.detail ?? "");
  else if (t.state === "progress") tasks.update(t.id, t.p, t.detail, t.title);
  else if (t.state === "done") tasks.done(t.id, t.title);
  else if (t.state === "fail") tasks.fail(t.id, t.title ?? "");
  else tasks.clear(t.id);
}
// the studio's question (Shubix AI's credits: "Shubix AI will edit this Reel", Use 10 credits) asked on the phone, its answer pressed there
type AskEvent = { event: "ask"; title: string; text: string; list: string[]; balance: string; ok: string; no: string };
async function onAsk(q: AskEvent) {
  let pick: "ok" | "no" | "close" = "close";
  try {
    const value = await askAction({ title: q.title, body: [q.text, q.balance].filter(Boolean).join(" · "), list: q.list, ok: q.ok, ...(q.no ? { cancel: q.no } : {}) });
    pick = value === 0 ? "ok" : value === 1 && q.no ? "no" : "close";
  } catch {
    // Always release the hidden Studio confirmation if the native dialog cannot be shown.
  }
  await call("answer", { pick }).catch(() => {});
}
function onMessage(e: WebViewMessageEvent) {
  let m: { id: number; ok: boolean; result?: unknown; error?: string } | TaskEvent | AskEvent;
  try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
  if (!m || typeof m !== "object") return;
  if ("event" in m) return m.event === "ask" ? void onAsk(m).catch(() => {}) : onTask(m);
  if (m.id === 0) return ready?.();
  const w = waiting.get(m.id);
  if (!w) return;
  waiting.delete(m.id);
  clearTimeout(w.timer);
  if (m.ok) w.resolve(m.result); else w.reject(new Error(m.error || "Shubix Studio could not complete this action."));
}

/** The studio's page, hidden (behind everything, never touched): mounted once at the app's root. */
export function EngineHost() {
  const ref = useRef<Page | null>(null);
  // the page was stopped by the phone (out of memory): what it was doing fails, and it starts again
  const restart = () => {
    generation += 1;
    rejectPending("Android restarted Shubix Studio. Your saved draft is safe; please retry the interrupted action.");
    setUp = false; setupPromise = null; held = "";
    resetReady();
    ref.current?.reload();
  };
  if (!engineOn) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: 390, height: 844, opacity: 0, zIndex: -1 }}>
      <WebView ref={(w: Page | null) => { ref.current = w; page = w; }} source={{ uri: `${SITE_URL}/engine` }} onMessage={onMessage} javaScriptEnabled domStorageEnabled
        mixedContentMode="always" mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback webviewDebuggingEnabled={__DEV__}
        onContentProcessDidTerminate={restart} onRenderProcessGone={restart}
        onError={() => {
          generation += 1;
          rejectPending("Shubix Studio could not load on this phone. Check the app connection and try again.");
          setUp = false; setupPromise = null; held = "";
          resetReady();
        }} />
    </View>
  );
}
