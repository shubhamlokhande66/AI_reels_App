/** The look of each page, as designed: the dashboard and the editor workspace are Noir (dark), every other page is
 * Ivory (light), Fast Studio included. */
export function pageTheme(path: string): "dark" | "light" {
  return path === "/" || path.startsWith("/editor/") ? "dark" : "light";
}

/** Runs before the page paints (inlined in the layout), so a page never flashes the other look. */
export const THEME_SCRIPT = `(function(){var p=location.pathname.replace(/\\/$/,"")||"/";document.documentElement.dataset.theme=(p==="/"||p.indexOf("/editor/")===0)?"dark":"light"})();`;
