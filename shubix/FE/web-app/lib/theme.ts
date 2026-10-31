/** One look for the whole app, chosen by the person: Light (Ivory), Dark (Noir), or the same as their phone / computer.
 * Every page follows it (the menu and the sidebar too); a few panels keep their own look on purpose (the editors'
 * timeline follows the selected theme too). Kept on this device (localStorage). */
export type ThemePref = "light" | "dark" | "system";
export const THEME_KEY = "shubix-theme";
export const DEFAULT_PREF: ThemePref = "light";
/** the browser / installed app bar colour for each look */
export const BAR_COLOR = { light: "#f7f3ec", dark: "#0a0908" } as const;

export const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode: the default */
  }
  return DEFAULT_PREF;
}
const systemDark = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
export function resolveTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemDark() ? "dark" : "light") : pref;
}
/** puts the look on the page (and the phone's status bar colour) */
export function applyTheme(pref: ThemePref = readPref()) {
  if (typeof document === "undefined") return;
  const t = resolveTheme(pref);
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", BAR_COLOR[t]));
}
export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, pref);
  } catch {
    /* kept for this visit only */
  }
  applyTheme(pref);
  emit();
}

/** Runs before the page paints (inlined in the layout), so a page never flashes the other look. */
export const THEME_SCRIPT = `(function(){var p="${DEFAULT_PREF}";try{var v=localStorage.getItem("${THEME_KEY}");if(v==="light"||v==="dark"||v==="system")p=v}catch(e){}var t=p==="system"?(window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.dataset.theme=t;var c=t==="dark"?"${BAR_COLOR.dark}":"${BAR_COLOR.light}";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c)})})();`;
