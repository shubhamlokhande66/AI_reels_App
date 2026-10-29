import { Pressable, Text, View } from "react-native";
import { useText } from "@shubix/hooks";
import { Card, Chip, Heading, Icon, useTheme, type ThemePref } from "@shubix/ui-mobile";
import type { IconName } from "@shubix/ui-core";

/** The quick switch in the menu: Light <-> Dark (the website's ThemeToggle; kept on this phone). */
export function ThemeToggle() {
  const text = useText(), { theme, setPref } = useTheme(), dark = theme === "dark";
  return (
    <Pressable onPress={() => setPref(dark ? "light" : "dark")} accessibilityRole="switch" accessibilityState={{ checked: dark }} accessibilityLabel={text(dark ? "look.toLight" : "look.toDark")}
      className="min-h-[44px] w-full flex-row items-center justify-between gap-2 rounded-xl px-1">
      <View className="flex-row items-center gap-2"><Icon name={dark ? "moon" : "sun"} size={18} /><Text className="text-[12.5px] text-foreground">{text(dark ? "look.dark" : "look.light")}</Text></View>
      <View className={`h-6 w-11 rounded-full border border-border ${dark ? "bg-accent" : "bg-surface-2"}`}>
        <View className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-surface ${dark ? "left-[22px]" : "left-0.5"}`} />
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
