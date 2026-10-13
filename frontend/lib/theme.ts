export const THEME_KEY = "reel-theme";

/** Runs before the page paints (inlined in the layout), so the chosen theme never flashes the other one: the saved
 * choice, else the system setting, else dark. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark"){t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}})();`;
