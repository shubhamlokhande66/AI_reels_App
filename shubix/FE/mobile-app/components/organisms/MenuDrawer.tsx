import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useApi, useSignOut, useText } from "@shubix/hooks";
import { Avatar, Hairline, Icon, IconButton, Sidebar, colors } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";
import { GROUPS, isActive, type NavItem } from "@shubix/core/lib/nav";
import { Logo } from "../atoms/Logo";
import { ThemeToggle } from "../molecules/ThemeToggle";

/** The website's phone menu (AppShell's Drawer): the logo, the person's email, every page by group, sign out. It
 * slides in from the left over a dark veil; 88% of the screen, at most 360px. */
// Google Play: the app has no pricing page, only your credits
const CREDITS: NavItem = { href: "/credits", label: "Your credits", tk: "pricing.yourCredits", icon: "coins" };

export function MenuDrawer({ open, onClose, pathname }: { open: boolean; onClose: () => void; pathname: string }) {
  const text = useText(), { me } = useApi(), insets = useSafeAreaInsets();
  const signOut = useSignOut(() => { onClose(); router.replace("/login"); });
  const width = Math.min(useWindowDimensions().width * 0.88, 360);
  const shown = useRef(new Animated.Value(0)).current, [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(shown, { toValue: open ? 1 : 0, duration: 300, useNativeDriver: true }).start(() => !open && setMounted(false));
  }, [open, shown]);
  if (!mounted) return null;
  const email = me?.user?.email;
  const go = (item: NavItem) => { onClose(); router.navigate(item.href as never); };
  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    return (
      <Pressable key={item.href} onPress={() => go(item)} accessibilityRole="link" accessibilityState={{ selected: active }}
        className={`min-h-[44px] flex-row items-center gap-2.5 rounded-[13px] border px-2 ${active ? "border-accent/25 bg-accent/10" : "border-transparent active:bg-accent/5"}`}>
        <View className={`h-8 w-8 items-center justify-center rounded-[10px] ${active ? "bg-accent/[0.12]" : ""}`}>
          <Icon name={item.icon as IconName} size={17} color={active ? "accent" : "muted"} />
        </View>
        <Text numberOfLines={1} className={`min-w-0 flex-1 text-[12.5px] ${active ? "font-bold text-foreground" : "text-muted"}`}>{item.tk ? text(item.tk) : item.label}</Text>
      </Pressable>
    );
  };
  return (
    <View className="absolute inset-0 z-50">
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: shown }]}><Pressable className="flex-1 bg-black/55" onPress={onClose} accessibilityLabel={text("common.closeMenu")} /></Animated.View>
      <Animated.View accessibilityViewIsModal style={{ position: "absolute", top: 0, bottom: 0, left: 0, width, transform: [{ translateX: shown.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }) }] }}
        className="overflow-hidden border-r border-accent/20">
        <Sidebar />
        <View className="flex-row items-center gap-2 border-b border-accent/15 bg-bar/90 px-4 pb-3" style={{ paddingTop: Math.max(12, insets.top) }}>
          <Hairline strength={0.5} />
          <View className="min-w-0 flex-1"><Logo height={72} /></View>
          <IconButton icon="close" look="plain" label={text("common.closeMenu")} onPress={onClose} />
        </View>
        <ScrollView className="flex-1" contentContainerClassName="gap-2 p-4 pt-3.5" contentContainerStyle={{ flexGrow: 1, paddingBottom: 16 + insets.bottom }}>
          {email && (
            <View className="flex-row items-center gap-3 rounded-[15px] border border-accent/15 bg-surface/60 px-3 py-2.5">
              <Avatar email={email} />
              <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] font-medium text-foreground">{email}</Text>
              <Text className="rounded-full border border-accent/20 bg-accent/10 px-2 py-1 text-[8px] font-extrabold tracking-[1.1px] text-accent">{text("nav.studioTag")}</Text>
            </View>
          )}
          <View className="border-t border-accent/10 pt-1">
            {GROUPS.filter((group) => !group.admin).map((group, index) => (
              <View key={group.title} className="gap-1">
                <Text className={`px-2.5 pb-1 text-[9px] font-extrabold uppercase tracking-[1.6px] text-muted/75 ${index ? "pt-4" : "pt-2"}`}>{group.tk ? text(group.tk) : group.title}</Text>
                {group.items.map((item) => link(item.href === "/pricing" ? CREDITS : item))}
              </View>
            ))}
          </View>
          <View className="flex-1" />
          <View className="border-t border-accent/10 pt-3"><ThemeToggle /></View>
          {email && (
            <Pressable onPress={() => void signOut()} accessibilityRole="button" className="min-h-[44px] flex-row items-center gap-3 rounded-[12px] border border-transparent px-2.5 active:bg-danger/5">
              <Icon name="signout" size={18} color="muted" />
              <Text className="text-[12px] text-muted">{text("nav.signOut")}</Text>
            </Pressable>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}
