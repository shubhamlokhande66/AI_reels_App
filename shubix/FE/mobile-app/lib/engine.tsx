import { useRef } from "react";
import { Platform, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { askAction, tasks, type TaskKind } from "@shubix/ui-mobile";
import { ShubixVideo } from "../modules/shubix-video";
import { clipDuration, type ProjectClip, type ReelProject } from "@shubix/validations";
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

type Waiting = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type Page = { injectJavaScript: (js: string) => void; reload: () => void };
const waiting = new Map<number, Waiting>();
let page: Page | null = null, held = "", next = 1, ready: (() => void) | null = null, isReady = new Promise<void>((r) => { ready = r; }), setUp = false;
const files = ShubixVideo ? ShubixVideo.fileServer() : null;

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
      const len = clipDuration(c), sp = (SPEED[from.shot.sp] ?? 1) === c.speed ? from.shot.sp : Object.keys(SPEED).find((k) => SPEED[k] === c.speed);
      if (!sp) return false; // a speed the studio has not (it has slow, normal, fast)
      const base = from.shot;
      const cs = { ...(base.cs ?? {}) };
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
  /** a choice in one of the editor's tools, made in the studio as on the website (its button `attr`=`value` in `box`,
   * or its input `box` set to `value`), the editor's changes sent first: the Reel's clips after it; null when the studio
   * does not hold this Reel as it is (then the phone does what it can) */
  tool: (op: string, args: Record<string, unknown> = {}) => call<Record<string, unknown>>(op, args),
  addLayer: (uri: string, name: string) => call<Record<string, unknown>>("layerAdd", { path: pathOf(uri), name }),
  set: async (p: ReelProject, box: string, value: string | boolean, attr?: string) => {
    if (!(await engine.edit(p))) return null;
    return shotsOf((await call<EngineReel>("set", { box, value, ...(attr ? { attr } : {}) })).state.edit, sources);
  },
  exportReel: (name: string) => call<{ path: string; size: number }>("exportReel", { name }).then((r) => ({ uri: `file://${r.path}`, size: r.size })),
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

/** The studio's page, hidden (behind everything, never touched): mounted once at the app's root. */
export function EngineHost() {
  const ref = useRef<Page | null>(null);
  // the page was stopped by the phone (out of memory): what it was doing fails, and it starts again
  const restart = () => {
    waiting.forEach((w) => w.reject(new Error("The phone stopped the studio. Please try again."))); waiting.clear();
    setUp = false; held = ""; isReady = new Promise<void>((r) => { ready = r; }); ref.current?.reload();
  };
  if (!engineOn) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, width: 390, height: 844, opacity: 0, zIndex: -1 }}>
      <WebView ref={(w: Page | null) => { ref.current = w; page = w; }} source={{ uri: `${SITE_URL}/engine` }} onMessage={onMessage} javaScriptEnabled domStorageEnabled
        mixedContentMode="always" mediaPlaybackRequiresUserAction={false} allowsInlineMediaPlayback webviewDebuggingEnabled={__DEV__}
        onContentProcessDidTerminate={restart} onRenderProcessGone={restart} />
    </View>
  );
}
