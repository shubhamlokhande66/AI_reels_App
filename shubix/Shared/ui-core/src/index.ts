import tokens from "./tokens.json";

/** The design both apps share (web: Shared/ui-web builds on it; phone: FE/mobile-app/tailwind.config.js): the brand
 * colours of the dark look, corners, type and spacing. Web-only looks (Light, gradients, glows) are in Shared/ui-web. */
export const { palette, light, surfaces, gradients, lightGradients, radii, typography, spacing } = tokens;
export const theme = tokens;
export type Palette = typeof palette;
export * from "./icons";
export * from "./paint";
