const { palette, light, surfaces, radii } = require("../../Shared/ui-core/src/tokens.json");
// the website's colour names (Shared/ui-web/src/tailwind.ts): bg-surface, text-accent, border-border… Each one is a CSS
// variable that the look sets (Shared/ui-mobile/src/theme.tsx: Light or Dark); a colour that is #rrggbb in both looks
// keeps its opacity classes (bg-accent/15)
const kebab = (k) => (k === "raised" ? "surface-2" : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
const hex = (v) => /^#[0-9a-f]{6}$/i.test(v);
const dark = { ...palette, ...surfaces.dark }, ivory = { ...light, ...surfaces.light };
const colors = Object.fromEntries(Object.keys(dark).map((k) => [kebab(k), hex(dark[k]) && hex(ivory[k]) ? `rgb(var(--c-${kebab(k)}) / <alpha-value>)` : `var(--c-${kebab(k)})`]));
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "../../Shared/ui-mobile/src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: { extend: { colors, borderRadius: { luxe: `${radii.card}px`, "3xl": "16px" } } },
  plugins: [],
};
