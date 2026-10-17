export const THEME_KEY = "reel-theme";

/** The look of each page, as designed: the dashboard and the editor workspace are Noir (dark), every other page is
 * Ivory (light). Fast Studio has its own Ivory / Noir / Auto choice in its menu. */
export function pageTheme(path: string): "dark" | "light" {
  return path === "/" || path.startsWith("/editor/") ? "dark" : "light";
}

/** Runs before the page paints (inlined in the layout), so a page never flashes the other look: the page's own look;
 * in Fast Studio the saved choice, else the system setting. */
export const THEME_SCRIPT = `(function(){var p=location.pathname.replace(/\\/$/,"")||"/";try{var t;if(p==="/studio"){t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}}else{t=(p==="/"||p.indexOf("/editor/")===0)?"dark":"light"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;

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
