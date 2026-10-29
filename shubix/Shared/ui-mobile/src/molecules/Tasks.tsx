import { useEffect, useRef, useSyncExternalStore } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "@shubix/ui-core";
import { Icon } from "../atoms/Icon";

/** What the app is doing right now, always in view (the website's studio tasks, FE/web-app/components/studio/tasks.ts):
 * one floating card per process (adding the song, reading the clips, Shubix AI, export, saving to My Reels) with a small
 * live animation for its kind, the step in plain words, a progress bar and the time left. When it finishes the card turns
 * into a tick and slides away; a failure stays a little longer, in red. Callable from anywhere:
 *   tasks.start("song", "music", "Adding your song", "Reading the sound of …") · tasks.update(id, 0.4, step) ·
 *   tasks.done(id, "Song ready") · tasks.fail(id, why) · tasks.clear(id)
 * The one <TaskHost/> in the app's frame shows them. */
export type TaskKind = "music" | "clips" | "ai" | "export" | "cloud" | "voice";
type Task = { id: string; kind: TaskKind; title: string; detail: string; p: number | null; t0: number; state: "run" | "done" | "fail" };

let list: Task[] = [];
const listeners = new Set<() => void>(), timers = new Map<string, ReturnType<typeof setTimeout>>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const put = (id: string, change: (t: Task | undefined) => Task | null) => {
  const t = change(list.find((x) => x.id === id));
  list = t ? (list.some((x) => x.id === id) ? list.map((x) => (x.id === id ? t : x)) : [...list, t]) : list.filter((x) => x.id !== id);
  emit();
};
function finish(id: string, ok: boolean, text: string, ms: number) {
  if (!list.some((x) => x.id === id)) return;
  put(id, (t) => (t ? { ...t, state: ok ? "done" : "fail", detail: text, p: ok ? 1 : t.p } : null));
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => put(id, (t) => (t && t.state !== "run" ? null : t ?? null)), ms));
}
export const tasks = {
  /** A process starts (or starts over): its card appears, or the existing one is reused. */
  start: (id: string, kind: TaskKind, title: string, detail = "") => { clearTimeout(timers.get(id)); put(id, () => ({ id, kind, title, detail, p: null, t0: Date.now(), state: "run" })); },
  /** Progress (0..1, or null when unknown) and the step in words. */
  update: (id: string, p: number | null, detail?: string, title?: string) => put(id, (t) => (t ? { ...t, p, detail: detail ?? t.detail, title: title ?? t.title } : null)),
  /** Finished: a tick, then the card slides away. */
  done: (id: string, text = "Done") => finish(id, true, text, 1600),
  /** Did not work: shown in red a little longer. */
  fail: (id: string, text: string) => finish(id, false, text, 5000),
  /** Gone without a word (nothing to report). */
  clear: (id: string) => put(id, () => null),
  has: (id: string) => list.some((x) => x.id === id),
};

const left = (s: number) => (s < 1.5 ? "almost done" : s < 60 ? `about ${Math.ceil(s)} s left` : `about ${Math.ceil(s / 60)} min left`);
const SIGN: Record<TaskKind, IconName> = { music: "music", clips: "video", ai: "sparkle", export: "download", cloud: "upload", voice: "mic" };

/** A loop from 0 to 1 and back, for the cards' live signs (equaliser bars, the sign breathing, the bar sliding). */
function useLoop(ms: number, on = true) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) return;
    const a = Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    a.start();
    return () => a.stop();
  }, [v, ms, on]);
  return v;
}

/** The kind's live sign: music its equaliser bars moving; the others their sign breathing. */
function LiveSign({ kind }: { kind: TaskKind }) {
  const beat = useLoop(380), breathe = useLoop(700);
  if (kind === "music") return (
    <View className="h-5 flex-row items-end gap-[3px]">
      {[0, 0.35, 0.15, 0.55].map((d, i) => <Animated.View key={i} className="h-5 w-[3px] rounded-full bg-accent" style={{ transform: [{ scaleY: beat.interpolate({ inputRange: [0, 1], outputRange: i % 2 ? [1 - d, 0.3 + d / 2] : [0.3 + d, 1 - d / 3] }) }] }} />)}
    </View>
  );
  return <Animated.View style={{ opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }), transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] }) }] }}><Icon name={SIGN[kind]} size={21} color="accent" /></Animated.View>;
}

function TaskCard({ t }: { t: Task }) {
  const shown = useRef(new Animated.Value(0)).current, slide = useLoop(650, t.p === null && t.state === "run");
  useEffect(() => { Animated.timing(shown, { toValue: 1, duration: 260, easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }).start(); }, [shown]);
  const pc = Math.max(0, Math.min(1, t.p ?? 0)), el = (Date.now() - t.t0) / 1000;
  const info = t.state !== "run" || t.p === null ? "" : `${Math.round(pc * 100)}%` + (pc > 0.04 && pc < 1 && el > 2 ? ` · ${left(el / pc - el)}` : "");
  const ic = t.state === "done" ? "bg-success/15" : t.state === "fail" ? "bg-danger/15" : "bg-accent/15";
  return (
    <Animated.View accessibilityRole="progressbar" accessibilityLiveRegion="polite" accessibilityLabel={`${t.title}. ${t.detail}`} style={{ opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }}
      className={`w-full flex-row items-center gap-3 rounded-2xl border bg-surface px-3.5 py-3 shadow-lg shadow-black/40 ${t.state === "fail" ? "border-danger/60" : "border-border"}`}>
      <View className={`h-11 w-11 items-center justify-center rounded-xl ${ic}`}>
        {t.state === "run" ? <LiveSign kind={t.kind} /> : <Icon name={t.state === "done" ? "check" : "close"} size={22} stroke={2.6} color={t.state === "done" ? "success" : "danger"} />}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2"><Text numberOfLines={1} className="flex-1 text-[14px] font-semibold text-foreground">{t.title}</Text><Text className="text-[11.5px] text-muted">{info}</Text></View>
        <Text numberOfLines={1} className="text-[12.5px] text-muted">{t.detail}</Text>
        <View className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-foreground/10">
          {t.p === null && t.state === "run"
            ? <Animated.View className="h-full w-[40%] rounded-full bg-accent" style={{ transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-40, 190] }) }] }} />
            : <View className={`h-full rounded-full ${t.state === "fail" ? "bg-danger" : "bg-accent"}`} style={{ width: `${(t.state === "done" ? 1 : pc) * 100}%` }} />}
        </View>
      </View>
    </Animated.View>
  );
}

/** The cards above the bottom bar (`bottom`: how far up), the newest last. */
export function TaskHost({ bottom = 96 }: { bottom?: number }) {
  const shown = useSyncExternalStore(subscribe, () => list), insets = useSafeAreaInsets();
  return (
    <View pointerEvents="none" className="absolute inset-x-0 z-[82] items-center px-3" style={{ bottom: bottom + insets.bottom }}>
      <View className="w-full max-w-[380px] gap-2">{shown.map((t) => <TaskCard key={t.id} t={t} />)}</View>
    </View>
  );
}
