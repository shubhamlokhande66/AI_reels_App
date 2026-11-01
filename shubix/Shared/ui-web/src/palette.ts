import { gradients, light as lightPalette, lightGradients, palette, surfaces } from "@shubix/ui-core";
import web from "./tokens.json";

/** The website's looks: both looks' colours from Shared/ui-core (the phone app uses the same), with the web's own effects. */
const [g1, g2, g3] = gradients.gold, [s1, s2] = gradients.sidebar, [l1, l2, l3] = lightGradients.gold, [m1, m2] = lightGradients.sidebar;
export const dark = { ...palette, ...surfaces.dark, ...web.dark, goldGradient: `linear-gradient(110deg, ${g1} 0%, ${g2} 50%, ${g3} 100%)`, sidebar: `linear-gradient(180deg, ${s1}, ${s2} 78%)` };
export const light: WebPalette = { ...lightPalette, ...surfaces.light, ...web.light, goldGradient: `linear-gradient(110deg, ${l1} 0%, ${l2} 52%, ${l3} 100%)`, sidebar: `linear-gradient(180deg, ${m1}, ${m2})` };
export type WebPalette = typeof dark;

/** A palette as CSS variables (accentHover → --accent-hover; raised is the web's --surface-2). */
export const cssVars = (p: WebPalette): Record<string, string> =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [`--${k === "raised" ? "surface-2" : k.replace(/[A-Z0-9]/g, (c) => "-" + c.toLowerCase())}`, v]));
