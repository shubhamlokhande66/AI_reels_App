export const THEME_KEY = "reel-theme";

/** Runs before the page paints (inlined in the layout), so the chosen theme never flashes the other one: the saved
 * choice, else the system setting, else dark. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;

export type ThemeChoice = "light" | "dark" | "auto";

/** The saved choice: light (Ivory), dark (Noir) or auto (follows the phone's setting). */
export function themeChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

/** Apply and remember a theme choice; auto forgets the saved one and follows the system. */
export function applyTheme(choice: ThemeChoice) {
  const sys = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = choice === "auto" ? sys : choice;
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
}
