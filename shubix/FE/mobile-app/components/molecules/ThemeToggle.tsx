import { useEffect, useRef } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import { useText } from "@mobile/hooks";
import { Card, Chip, Heading, Icon, useTheme, type ThemePref } from "@mobile/ui-mobile";
import type { IconName } from "@mobile/ui-core";

/** The quick switch in the menu: Light <-> Dark (the website's ThemeToggle; kept on this phone). */
export function ThemeToggle() {
  const text = useText(), { theme, setPref } = useTheme(), dark = theme === "dark", knob = useRef(new Animated.Value(dark ? 1 : 0)).current;
  useEffect(() => { Animated.spring(knob, { toValue: dark ? 1 : 0, damping: 18, stiffness: 260, useNativeDriver: false }).start(); }, [dark, knob]);
  return (
    <Pressable onPress={() => setPref(dark ? "light" : "dark")} accessibilityRole="switch" accessibilityState={{ checked: dark }} accessibilityLabel={text(dark ? "look.toLight" : "look.toDark")}
      className="min-h-[44px] w-full flex-row items-center justify-between gap-2 rounded-xl px-1">
      <View className="flex-row items-center gap-2"><Icon name={dark ? "moon" : "sun"} size={18} /><Text className="text-[12.5px] text-foreground">{text(dark ? "look.dark" : "look.light")}</Text></View>
      <View className={`h-6 w-11 rounded-full border border-border ${dark ? "bg-accent" : "bg-surface-2"}`}>
        <Animated.View style={{ position: "absolute", top: 2, left: knob.interpolate({ inputRange: [0, 1], outputRange: [2, 22] }) }}>
          <View className="h-[18px] w-[18px] rounded-full bg-surface" style={{ elevation: 2, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} />
        </Animated.View>
      </View>
    </Pressable>
  );
}

const CHOICES: [ThemePref, string, IconName][] = [["light", "look.choiceLight", "sun"], ["dark", "look.choiceDark", "moon"], ["system", "look.choiceSystem", "gear"]];
/** The full choice (My account): Light, Dark, or the same as the phone. */
export function ThemeChoice() {
  const text = useText(), { pref, setPref } = useTheme();
  return (
    <Card className="gap-2.5">
      <Heading size="section">{text("look.title")}</Heading>
      <Text className="text-[12.5px] text-muted">{text("look.text")}</Text>
      <View className="flex-row flex-wrap gap-2">
        {CHOICES.map(([value, key, icon]) => <Chip key={value} on={pref === value} onPress={() => setPref(value)} label={text(key)} icon={<Icon name={icon} size={14} />} />)}
      </View>
    </Card>
  );
}
