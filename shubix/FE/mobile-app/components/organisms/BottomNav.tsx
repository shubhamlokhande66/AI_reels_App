import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useText } from "@shubix/hooks";
import { Gold, Icon, colors } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import { TABS, isActive } from "@shubix/core/lib/nav";

/** The website's phone bottom bar (components/molecules/BottomNav.tsx): Home, Templates, the raised gold Create
 * button, My Reels and Account. The open tab is gold with a line under its name. */
export function BottomNav({ pathname }: { pathname: string }) {
  const text = useText(), insets = useSafeAreaInsets();
  const item = (label: string, on: boolean, icon: IconName, onPress: () => void) => (
    <Pressable key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} className="min-h-[52px] flex-1 items-center justify-end gap-1 pb-1">
      <Icon name={icon} size={23} stroke={on ? 2.2 : 1.8} color={on ? "accent" : "muted"} />
      <Text className={`text-[11px] font-semibold ${on ? "text-accent" : "text-muted"}`}>{label}</Text>
      {on && <View className="absolute -bottom-0.5 h-[3px] w-7 rounded-full bg-accent" />}
    </Pressable>
  );
  return (
    <View className="flex-row items-end rounded-t-[22px] border-t border-border bg-bar px-1 pt-2" style={{ paddingBottom: Math.max(6, insets.bottom) }}>
      {TABS.map((tab) => tab.primary ? (
        <Pressable key={tab.href} onPress={() => router.push(tab.href as never)} accessibilityRole="button" accessibilityLabel={text(tab.tk)} className="min-h-[52px] flex-1 items-center justify-end gap-1 pb-1">
          <View className="-mt-8 h-[60px] w-[60px] items-center justify-center overflow-hidden rounded-full border-4 border-background">
            <Gold />
            <Icon name="plus" size={26} stroke={2.4} color="onAccent" />
          </View>
          <Text className="text-[11px] font-semibold text-foreground">{text(tab.tk)}</Text>
        </Pressable>
      ) : item(text(tab.tk), isActive(pathname, tab.href), tab.icon as IconName, () => router.navigate(tab.href as never)))}
    </View>
  );
}
