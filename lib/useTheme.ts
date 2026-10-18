"use client";

import { useSyncExternalStore } from "react";
import { applyTheme, DEFAULT_PREF, listeners, readPref, resolveTheme, setThemePref, THEME_KEY, type ThemePref } from "@/lib/theme";

function subscribe(fn: () => void) {
  listeners.add(fn);
  // "same as my phone": follow the system when it switches (e.g. at sunset)
  const mq = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const onSys = () => { if (readPref() === "system") { applyTheme("system"); fn(); } };
  mq?.addEventListener("change", onSys);
  const onStore = (e: StorageEvent) => { if (e.key === THEME_KEY) { applyTheme(); fn(); } };   // another tab changed it
  window.addEventListener("storage", onStore);
  return () => { listeners.delete(fn); mq?.removeEventListener("change", onSys); window.removeEventListener("storage", onStore); };
}
/** the person's choice and the look it gives now */
export function useTheme(): { pref: ThemePref; theme: "light" | "dark"; setPref: (p: ThemePref) => void } {
  const pref = useSyncExternalStore(subscribe, readPref, () => DEFAULT_PREF);
  const theme = useSyncExternalStore(subscribe, () => resolveTheme(readPref()), () => resolveTheme(DEFAULT_PREF));
  return { pref, theme, setPref: setThemePref };
}

