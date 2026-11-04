import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, Easing, Modal, Text, View } from "react-native";
import type { IconName } from "@mobile/ui-core";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ThemeLayer } from "../theme";
import { tell, useAskOpen } from "./Feedback";

/** What the app is doing right now, in a popup at the centre of the screen; the screen behind it is frozen until the work is
 * over (the website's studio tasks, FE/web-app/components/studio/tasks.ts): one card per process (adding the song, reading
 * the clips, Shubix AI, saving to My Reels) with a small live animation for its kind, the step in plain words, a progress
 * bar and the time left. A failure becomes a message with OK. The export has its own screen. A screen that can stop its
 * work says how (tasks.guard); where nothing can stop it, the popup can be hidden after a while. Callable from anywhere:
 *   tasks.start("song", "music", "Adding your song", "Reading the sound of …") · tasks.update(id, 0.4, step) ·
 *   tasks.done(id, "Song ready") · tasks.fail(id, why) · tasks.clear(id)
 * The one <TaskHost/> in the app's frame shows them. */
export type TaskKind = "music" | "clips" | "ai" | "export" | "cloud" | "voice";
export type TaskGuard = { onCancel: () => void; onCancelReel: () => void };
type Task = { id: string; kind: TaskKind; title: string; detail: string; p: number | null; t0: number; state: "run" | "done" | "fail" };

let list: Task[] = [], guard: TaskGuard | null = null, locked = false;
// what the Create flow's popup lists, in order (a process's id, its line)
const STEPS: [string, string][] = [["song", "Reading your song"], ["beats", "Checking every beat"], ["clips", "Preparing and analysing your clips"], ["ai", "Shubix AI editing your Reel"]];
const doneSteps = new Set<string>();
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
  if (!ok) { put(id, () => null); tell(text, "danger"); return; }
  doneSteps.add(id);
  put(id, (t) => (t ? { ...t, state: "done", detail: text, p: 1 } : null));
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(() => put(id, (t) => (t && t.state !== "run" ? null : t ?? null)), ms));
}
export const tasks = {
  /** A process starts (or starts over): its card appears, or the existing one is reused. */
  start: (id: string, kind: TaskKind, title: string, detail = "") => { clearTimeout(timers.get(id)); doneSteps.delete(id); put(id, () => ({ id, kind, title, detail, p: null, t0: Date.now(), state: "run" })); },
  /** Progress (0..1, or null when unknown) and the step in words. */
  update: (id: string, p: number | null, detail?: string, title?: string) => put(id, (t) => (t ? { ...t, p, detail: detail ?? t.detail, title: title ?? t.title } : null)),
  /** Finished: a tick, then the card slides away. */
  done: (id: string, text = "Done") => finish(id, true, text, 600),
  /** Did not work: its reason, with OK. */
  fail: (id: string, text: string) => finish(id, false, text, 0),
  /** Gone without a word (nothing to report). */
  clear: (id: string) => { doneSteps.delete(id); put(id, () => null); },
  has: (id: string) => list.some((x) => x.id === id),
  /** While a screen is open: how its work can be stopped (the Cancel and Cancel Reel buttons). */
  guard: (g: TaskGuard | null) => { guard = g; emit(); },
  /** The AI has answered, its tokens are spent: nothing can be cancelled until unlock. */
  lock: () => { locked = true; emit(); },
  unlock: () => { locked = false; emit(); },
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
      className="w-full flex-row items-center gap-3">
      <View className={`h-14 w-14 items-center justify-center rounded-full border border-accent/30 ${ic}`}>
        {t.state === "run" ? <LiveSign kind={t.kind} /> : <Icon name={t.state === "done" ? "check" : "close"} size={22} stroke={2.6} color={t.state === "done" ? "success" : "danger"} />}
      </View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-baseline justify-between gap-2"><Text numberOfLines={1} className="flex-1 text-[16px] font-semibold tracking-tight text-foreground">{t.title}</Text><Text className="text-[11.5px] text-muted">{info}</Text></View>
        <Text numberOfLines={3} className="text-[12.5px] text-muted">{t.detail}</Text>
        <View className="mt-2.5 h-1 overflow-hidden rounded-full bg-foreground/10">
          {t.p === null && t.state === "run"
            ? <Animated.View className="h-full w-[40%] rounded-full bg-accent" style={{ transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-40, 190] }) }] }} />
            : <View className={`h-full rounded-full ${t.state === "fail" ? "bg-danger" : "bg-accent"}`} style={{ width: `${(t.state === "done" ? 1 : pc) * 100}%` }} />}
        </View>
      </View>
    </Animated.View>
  );
}

/** The popup. The screen's own step ("flow") shows only while no process of the studio has a card of its own. */
export function TaskHost({ cancel, cancelReel, cantCancel, hide, words = (s) => s }: { cancel: string; cancelReel: string; cantCancel: string; hide: string; words?: (s: string) => string }) {
  const all = useSyncExternalStore(subscribe, () => list), g = useSyncExternalStore(subscribe, () => guard), lock = useSyncExternalStore(subscribe, () => locked), asking = useAskOpen();
  const [hidden, setHidden] = useState<string[]>([]), [late, setLate] = useState(false);
  const running = all.filter((t) => t.kind !== "export" && !hidden.includes(t.id)), own = running.filter((t) => t.id !== "flow"), shown = own.length ? own : running;
  const on = shown.length > 0;
  useEffect(() => { setLate(false); if (!on) { setHidden([]); return; } const t = setTimeout(() => setLate(true), 30_000); return () => clearTimeout(t); }, [on]);
  return (
    <Modal visible={on && !asking} transparent animationType="fade" statusBarTranslucent onRequestClose={() => { if (g && !lock) g.onCancel(); }}>
      <ThemeLayer className="items-center justify-center bg-black/75 px-4">
        <View accessibilityViewIsModal className="w-full max-w-[560px] gap-5 overflow-hidden rounded-[32px] border border-accent/30 bg-surface p-6 shadow-2xl shadow-accent/30">
          <View pointerEvents="none" className="absolute inset-x-10 top-0 h-px bg-accent/80" />
          {g && (
            <View className="items-center gap-1.5">
              <Text className="text-[11px] font-bold uppercase tracking-[2.4px] text-accent">{words("Shubix Studio")}</Text>
              <Text className="text-center text-[24px] font-semibold tracking-tight text-foreground">{words("Crafting your Reel")}</Text>
              <Text className="text-center text-[13px] leading-[20px] text-muted">{words("A lot is happening behind the scenes to make your Reel: every beat, every clip, every moment.")}</Text>
            </View>
          )}
          {shown.slice(-1).map((t) => <TaskCard key={t.id} t={t} />)}
          {g && (
            <View className="gap-2.5 rounded-[20px] border border-border bg-foreground/5 p-4">
              {STEPS.map(([id, line], i) => {
                const running = (key: string) => all.some((t) => t.state === "run" && (t.id === key || (t.id === "flow" && t.kind === ({ song: "music", clips: "clips", ai: "ai" } as Record<string, TaskKind>)[key])));
                const now = running(id), ok = !now && (doneSteps.has(id) || STEPS.slice(i + 1).some(([key]) => running(key))); // a step before the one running is behind us
                return (
                  <View key={id} className="flex-row items-center gap-3">
                    <View className={`h-6 w-6 items-center justify-center rounded-full ${ok ? "bg-success/15" : now ? "bg-accent/15" : "border border-border"}`}>{ok ? <Icon name="check" size={13} stroke={2.8} color="success" /> : now ? <View className="h-2 w-2 rounded-full bg-accent" /> : null}</View>
                    <Text className={`flex-1 text-[13.5px] ${now ? "font-semibold text-foreground" : "text-muted"}`}>{words(line)}</Text>
                  </View>
                );
              })}
            </View>
          )}
          {g && lock ? (
            <>
              <Text className="text-center text-[12.5px] leading-[19px] text-muted">{cantCancel}</Text>
              <Button full variant="secondary" disabled icon="back" title={cancel} onPress={() => {}} />
            </>
          ) : g ? (
            <View className="flex-row gap-2">
              <Button className="flex-1" variant="secondary" icon="back" title={cancel} onPress={g.onCancel} />
              <Button className="flex-1" variant="destroy" title={cancelReel} onPress={g.onCancelReel} />
            </View>
          ) : late ? <Button full variant="secondary" title={hide} onPress={() => setHidden(all.map((t) => t.id))} /> : null}
        </View>
      </ThemeLayer>
    </Modal>
  );
}
