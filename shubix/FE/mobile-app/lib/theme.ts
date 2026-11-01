import { useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Theme, ThemePref } from "@shubix/ui-mobile";

/** The person's look, kept on this phone (the website's lib/theme.ts: the same key and the same default, Light). */
const KEY = "shubix-theme";
export const DEFAULT_PREF: ThemePref = "light";

export function useThemePref(): { theme: Theme; pref: ThemePref; setPref: (pref: ThemePref) => void } {
  const [pref, setPrefState] = useState<ThemePref>(DEFAULT_PREF), system = useColorScheme();
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v === "light" || v === "dark" || v === "system") setPrefState(v); }).catch(() => {}); }, []);
  const setPref = (next: ThemePref) => { setPrefState(next); void AsyncStorage.setItem(KEY, next).catch(() => {}); };
  return { pref, setPref, theme: pref === "system" ? (system === "dark" ? "dark" : "light") : pref };
}
