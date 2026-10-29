import { palette } from "@shubix/ui-core";
import web from "./tokens.json";

/** The website's looks: Dark = the shared brand colours (Shared/ui-core) + the web's effects; Light is web-only. */
export const dark = { ...palette, ...web.dark };
export const light = web.light;
export type WebPalette = typeof dark;

/** A palette as CSS variables (accentHover → --accent-hover; raised is the web's --surface-2). */
export const cssVars = (p: WebPalette): Record<string, string> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [`--${k === "raised" ? "surface-2" : k.replace(/[A-Z0-9]/g, (c) => "-" + c.toLowerCase())}`, v]));
