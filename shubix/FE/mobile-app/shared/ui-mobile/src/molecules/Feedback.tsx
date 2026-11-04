import { useEffect, useRef, useSyncExternalStore } from "react";
import { Animated, Easing, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { IconName } from "@mobile/ui-core";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ThemeLayer } from "../theme";

/** The app's messages, callable from anywhere (the website's studio toasts and components/molecules/ConfirmDialog.tsx):
 * - toast("Saved"): a short line above the bottom bar for a few seconds (tone: info, success, danger)
 * - confirmAction({ title, body, ok, danger }): "Are you sure?" from the bottom; true when confirmed
 * - chooseAction({ title, actions }): a list of choices from the bottom (a card's ⋯); the index picked, or -1
 * - askAction({ title, body, list, ok, cancel }): the same question with its two answers apart: 0 ok, 1 cancel, -1 closed
 * The one <FeedbackHost/> in the app's frame shows them. */
export type ToastTone = "info" | "success" | "danger";
export interface ConfirmAsk { title: string; body?: string; list?: string[]; ok?: string; cancel?: string; danger?: boolean }
export interface ChoiceAsk { title: string; body?: string; cancel?: string; actions: { label: string; icon?: IconName; danger?: boolean }[] }
type Ask = (ConfirmAsk & { actions?: ChoiceAsk["actions"] }) & { resolve: (picked: number) => void };
type Toast = { id: number; message: string; tone: ToastTone };

let toasts: Toast[] = [], ask: Ask | null = null, next = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function toast(message: string, tone: ToastTone = "info") {
  const id = ++next;
  toasts = [...toasts.filter((t) => t.message !== message), { id, message, tone }].slice(-3); // the same line once, three at most
  emit();
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); emit(); }, tone === "danger" ? 4800 : 3200);
}
function open(a: Omit<Ask, "resolve">) {
  ask?.resolve(-1); // a newer question replaces an unanswered one
  return new Promise<number>((resolve) => { ask = { ...a, resolve }; emit(); });
}
export const confirmAction = (a: ConfirmAsk) => open(a).then((picked) => picked === 0);
export const chooseAction = (a: ChoiceAsk) => open(a);
export const askAction = (a: ConfirmAsk) => open(a);
const answer = (picked: number) => { const a = ask; ask = null; emit(); a?.resolve(picked); };

const DOT: Record<ToastTone, string> = { info: "bg-accent", success: "bg-success", danger: "bg-danger" };
const RING: Record<ToastTone, string> = { info: "bg-accent/15", success: "bg-success/15", danger: "bg-danger/15" };

/** One toast: it rises in and fades (the studio's .toast). */
function ToastLine({ t }: { t: Toast }) {
  const shown = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(shown, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [shown]);
  return (
    <Animated.View accessibilityLiveRegion="polite" accessibilityRole="alert" style={{ opacity: shown, transform: [{ translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }, { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.985, 1] }) }] }}
      className="flex-row items-center gap-2.5 rounded-2xl border border-accent/20 bg-surface px-4 py-3.5 shadow-lg shadow-black/30">
      <View className={`h-4 w-4 items-center justify-center rounded-full ${RING[t.tone]}`}><View className={`h-2 w-2 rounded-full ${DOT[t.tone]}`} /></View>
      <Text className="flex-1 text-[13px] font-semibold leading-[19px] text-foreground">{t.message}</Text>
    </Animated.View>
  );
}

/** The toasts and the question at the bottom. `ok` / `cancel`: the default button names (CMS texts). */
export function FeedbackHost({ ok, cancel, bottom = 88 }: { ok: string; cancel: string; bottom?: number }) {
  const shownToasts = useSyncExternalStore(subscribe, () => toasts), a = useSyncExternalStore(subscribe, () => ask);
  const insets = useSafeAreaInsets(), rise = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (a) { rise.setValue(0); Animated.spring(rise, { toValue: 1, damping: 20, stiffness: 220, useNativeDriver: true }).start(); } }, [a, rise]);
  return (
    <>
      <View pointerEvents="none" className="absolute inset-x-0 z-[60] items-center px-4" style={{ bottom: bottom + insets.bottom }}>
        <View className="w-full max-w-[420px] gap-2">{shownToasts.map((t) => <ToastLine key={t.id} t={t} />)}</View>
      </View>
      <Modal visible={!!a} transparent animationType="fade" statusBarTranslucent onRequestClose={() => answer(-1)}>
        <ThemeLayer className="justify-end bg-black/55">
          <Pressable className="flex-1" onPress={() => answer(-1)} accessibilityLabel={a?.cancel ?? cancel} />
          {a && (
            <Animated.View accessibilityViewIsModal style={{ paddingBottom: 16 + insets.bottom, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }] }} className="items-center px-4">
              <View accessibilityRole="alert" className="w-full max-w-[420px] gap-3 rounded-2xl border border-border bg-surface p-5">
                {a.danger && <View className="h-11 w-11 items-center justify-center rounded-full bg-danger/15"><Icon name="trash" color="danger" /></View>}
                <Text className="text-[17px] font-bold leading-[23px] text-foreground">{a.title}</Text>
                {a.body ? <Text className="text-[12.5px] leading-[19px] text-muted">{a.body}</Text> : null}
                {a.list?.map((x) => <View key={x} className="flex-row items-center gap-2.5"><View className="h-5 w-5 items-center justify-center rounded-full bg-accent/15"><Icon name="check" size={12} color="accent" /></View><Text className="flex-1 text-[13px] text-foreground">{x}</Text></View>)}
                {a.actions ? (
                  <>
                    <View className="-mx-2">{a.actions.map((x, i) => (
                      <Pressable key={x.label} onPress={() => answer(i)} accessibilityRole="button" className="h-12 flex-row items-center gap-3 rounded-xl px-2 active:bg-surface-2">
                        {x.icon && <Icon name={x.icon} size={19} color={x.danger ? "danger" : "foreground"} />}
                        <Text className={`text-[14px] font-semibold ${x.danger ? "text-danger" : "text-foreground"}`}>{x.label}</Text>
                      </Pressable>
                    ))}</View>
                    <Button full variant="secondary" title={a.cancel ?? cancel} onPress={() => answer(-1)} />
                  </>
                ) : (
                  <View className="mt-1 flex-row gap-2">
                    <Button className="flex-1" variant="secondary" title={a.cancel ?? cancel} onPress={() => answer(1)} />
                    <Button className="flex-1" variant={a.danger ? "destroy" : "primary"} title={a.ok ?? ok} onPress={() => answer(0)} />
                  </View>
                )}
              </View>
            </Animated.View>
          )}
        </ThemeLayer>
      </Modal>
    </>
  );
}
