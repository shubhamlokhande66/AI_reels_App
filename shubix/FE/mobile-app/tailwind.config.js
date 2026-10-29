const { palette, radii } = require("../../Shared/ui-core/src/tokens.json");
const web = require("../../Shared/ui-web/src/tokens.json").dark;
// the website's colour names (Shared/ui-web/src/tailwind.ts): bg-surface, text-accent, border-border…
const kebab = (k) => (k === "raised" ? "surface-2" : k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()));
const colors = Object.fromEntries(Object.entries({ ...palette, chipOn: web.chipOn, bar: web.bar, overlay: web.overlay, track: web.track }).map(([k, v]) => [kebab(k), v]));
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "../../Shared/ui-mobile/src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  // the app is always dark (app.json userInterfaceStyle); "class" lets Expo web set it (NativeWind's web runtime refuses "media")
  darkMode: "class",
  theme: { extend: { colors, borderRadius: { luxe: `${radii.card}px`, "3xl": "16px" } } },
  plugins: [],
};
