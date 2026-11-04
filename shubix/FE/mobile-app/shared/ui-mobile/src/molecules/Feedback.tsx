import { useSyncExternalStore } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import type { IconName } from "@mobile/ui-core";
import { Button } from "../atoms/Button";
import { Icon } from "../atoms/Icon";
import { ThemeLayer } from "../theme";

/** The app's messages, callable from anywhere. All in one popup at the centre of the screen; the screen behind it is
 * frozen and it closes only by its buttons (or the phone's back, which answers -1):
 * - tell("Why it failed", "danger"): a message with OK. A success says nothing: its result is on the screen.
 * - confirmAction({ title, body, ok, danger }): "Are you sure?"; true when confirmed
 * - chooseAction({ title, actions }): a list of choices (a card's ⋯); the index picked, or -1
 * - askAction({ title, body, list, ok, cancel, extra }): its answers apart: 0 ok, 1 cancel, 2 extra, -1 closed
 * The one <FeedbackHost/> in the app's frame shows them. */
export type TellTone = "info" | "success" | "danger";
export interface ConfirmAsk { title: string; body?: string; list?: string[]; ok?: string; cancel?: string; extra?: string; danger?: boolean }
export interface ChoiceAsk { title: string; body?: string; cancel?: string; actions: { label: string; icon?: IconName; danger?: boolean }[] }
type Ask = (ConfirmAsk & { actions?: ChoiceAsk["actions"]; single?: boolean }) & { resolve: (picked: number) => void };

let ask: Ask | null = null, waiting: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

const showNext = () => { const title = waiting.shift(); if (title) { ask = { title, single: true, resolve: () => {} }; } emit(); };
export function tell(message: string, tone: TellTone = "info") {
  if (tone === "success" || ask?.title === message || waiting.includes(message)) return;
  waiting.push(message);
  if (!ask) showNext(); // an open question is never replaced by a message: it waits for its turn
}
function open(a: Omit<Ask, "resolve">) {
  ask?.resolve(-1); // a newer question replaces an unanswered one
  return new Promise<number>((resolve) => { ask = { ...a, resolve }; emit(); });
}
export const confirmAction = (a: ConfirmAsk) => open(a).then((picked) => picked === 0);
export const chooseAction = (a: ChoiceAsk) => open(a);
export const askAction = (a: ConfirmAsk) => open(a);
const answer = (picked: number) => { const a = ask; ask = null; showNext(); a?.resolve(picked); };
/** a popup of this file is open (the task popup steps aside for it: only one shows) */
export const useAskOpen = () => useSyncExternalStore(subscribe, () => !!ask);

/** The popup. `ok` / `cancel`: the default button names (CMS texts). */
export function FeedbackHost({ ok, cancel }: { ok: string; cancel: string }) {
  const a = useSyncExternalStore(subscribe, () => ask);
  return (
    <Modal visible={!!a} transparent animationType="fade" statusBarTranslucent onRequestClose={() => answer(-1)}>
      <ThemeLayer className="items-center justify-center bg-black/60 px-4">
        {a && (
          <View accessibilityViewIsModal accessibilityRole="alert" className="w-full max-w-[420px] gap-3 rounded-2xl border border-border bg-surface p-5">
            {a.danger && <View className="h-11 w-11 items-center justify-center rounded-full bg-danger/15"><Icon name="trash" color="danger" /></View>}
            <Text className="text-[17px] font-bold leading-[23px] text-foreground">{a.title}</Text>
            {a.body ? <Text className="text-[12.5px] leading-[19px] text-muted">{a.body}</Text> : null}
            {a.list?.map((x) => <View key={x} className="flex-row items-center gap-2.5"><View className="h-5 w-5 items-center justify-center rounded-full bg-accent/15"><Icon name="check" size={12} color="accent" /></View><Text className="flex-1 text-[13px] text-foreground">{x}</Text></View>)}
            {a.single ? <Button full title={ok} onPress={() => answer(0)} />
              : a.actions ? (
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
                <>
                  <View className="mt-1 flex-row gap-2">
                    <Button className="flex-1" variant="secondary" icon="back" title={a.cancel ?? cancel} onPress={() => answer(1)} />
                    <Button className="flex-1" variant={a.danger ? "destroy" : "primary"} title={a.ok ?? ok} onPress={() => answer(0)} />
                  </View>
                  {a.extra ? <Button full variant="destroy" title={a.extra} onPress={() => answer(2)} /> : null}
                </>
              )}
          </View>
        )}
      </ThemeLayer>
    </Modal>
  );
}
