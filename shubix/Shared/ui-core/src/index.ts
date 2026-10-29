import tokens from "./tokens.json";

/** Design tokens + theme: one source for Tailwind (web), NativeWind (mobile) and inline styles. */
export const { palette, radii, typography, spacing } = tokens;
export const theme = tokens;
export type Palette = typeof palette;
