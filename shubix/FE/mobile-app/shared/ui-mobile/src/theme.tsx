import { createContext, useContext, type ReactNode } from "react";
import { View } from "react-native";
import { vars } from "nativewind";
import { gradients, light, lightGradients, palette, surfaces } from "@mobile/ui-core";

/** The website's two looks (Shared/ui-core): Light (Ivory) and Dark (Noir), or the same as the phone. Classes
 * (bg-surface, text-muted…) follow the look through CSS variables; props that need a colour use useColors(). */
export type Theme = "light" | "dark";
export type ThemePref = Theme | "system";
export const themes = { dark: { ...palette, ...surfaces.dark }, light: { ...light, ...surfaces.light } };
export type ThemeColors = typeof themes.dark;
export type ColorName = keyof ThemeColors;
export const themeGradients = { dark: gradients, light: { ...gradients, ...lightGradients } };

/** A colour's class name (raised is the website's surface-2; accentHover → accent-hover). */
export const colorClassName = (key: string) => (key === "raised" ? "surface-2" : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
/** "#d8bd7b" → "216, 189, 123" (so classes keep their opacity: bg-accent/15, as rgba(…, 0.15)); other colours as they are. */
const channels = (v: string) => (/^#[0-9a-f]{6}$/i.test(v) ? [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).join(", ") : v);
const variables = (Object.keys(themes) as Theme[]).reduce((all, theme) => ({ ...all, [theme]: vars(Object.fromEntries(Object.entries(themes[theme]).map(([k, v]) => [`--c-${colorClassName(k)}`, channels(v)]))) }), {} as Record<Theme, ReturnType<typeof vars>>);

type Ctx = { theme: Theme; pref: ThemePref; setPref: (pref: ThemePref) => void };
const ThemeContext = createContext<Ctx>({ theme: "light", pref: "light", setPref: () => {} });

/** Puts the look on everything inside (the app's root). `theme`: the look in use; `pref`: the person's choice. */
export function ThemeProvider({ theme, pref, setPref, children }: Ctx & { children: ReactNode }) {
  return <ThemeContext.Provider value={{ theme, pref, setPref }}><View style={[{ flex: 1 }, variables[theme]]}>{children}</View></ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
/** The look again, for a window drawn over the page (a Modal is outside the root view, so it needs its own). */
export function ThemeLayer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <View className={`flex-1 ${className}`} style={variables[useTheme().theme]}>{children}</View>;
}
/** The look's colours, for props that cannot take a class (icons, gradients, placeholderTextColor). */
export const useColors = (): ThemeColors => themes[useTheme().theme];
export const useGradients = () => themeGradients[useTheme().theme];
