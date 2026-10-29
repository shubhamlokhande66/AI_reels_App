import { useState } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useText } from "@shubix/hooks";
import { Icon, IconButton, ThemeLayer } from "@shubix/ui-mobile";
import { formatRelative } from "@shubix/utils";
import { mobileApi } from "../../lib/api";

/** The top bar's bell (the website's NotificationBell): the administrator's messages, a red dot for what is new;
 * opening it marks them read (on every device). A message's link opens its page. */
export function NotificationBell() {
  const text = useText(), insets = useSafeAreaInsets(), [open, setOpen] = useState(false);
  const notes = useQuery({ queryKey: ["notifications"], queryFn: mobileApi.notifications, staleTime: 60_000, refetchInterval: 5 * 60_000, retry: false });
  const msgs = notes.data?.items ?? [], fresh = notes.data?.unread ?? 0;
  const toggle = () => { setOpen(true); if (fresh) void mobileApi.readNotifications().then(() => notes.refetch()).catch(() => {}); };
  const go = (link: string) => { setOpen(false); if (link.startsWith("/")) router.push(link as never); else void Linking.openURL(link); };
  return (
    <>
      <View>
        <IconButton icon="bell" look="plain" iconSize={22} label={fresh ? text("bell.new", { n: fresh }) : text("bell.title")} onPress={toggle} />
        {fresh > 0 && <View pointerEvents="none" className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-bar bg-[#ff3b5c]" />}
      </View>
      <Modal visible={open} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setOpen(false)}>
        <ThemeLayer className="flex-1">
          <Pressable className="absolute inset-0" onPress={() => setOpen(false)} accessibilityLabel={text("common.close")} />
          <View accessibilityRole="menu" className="absolute right-3 w-[320px] max-w-[92%] rounded-2xl border border-border bg-surface p-2" style={{ top: insets.top + 56, elevation: 12 }}>
            <Text className="px-2.5 pb-1.5 pt-1 text-[13px] font-bold text-foreground">{text("bell.title")}</Text>
            {msgs.length ? <ScrollView className="max-h-[420px]">{msgs.map((m) => (
              <View key={m.id} className={`flex-row gap-2.5 rounded-xl px-2.5 py-2 ${m.unread ? "bg-accent/10" : ""}`}>
                <View className="mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-accent/15"><Icon name="bell" size={15} color="accent" /></View>
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text className="text-[13px] font-semibold text-foreground">{m.title}</Text>
                  <Text numberOfLines={4} className="text-[12px] text-muted">{m.body}</Text>
                  <View className="flex-row items-center gap-2"><Text className="text-[11px] text-muted">{formatRelative(m.at)}</Text>
                    {!!m.link && <Pressable onPress={() => go(m.link)} hitSlop={6}><Text className="text-[11px] font-bold text-accent">{m.button || text("bell.open")}</Text></Pressable>}</View>
                </View>
              </View>
            ))}</ScrollView> : <Text className="px-2.5 pb-2 text-[13px] text-muted">{text("bell.empty")}</Text>}
          </View>
        </ThemeLayer>
      </Modal>
    </>
  );
}
