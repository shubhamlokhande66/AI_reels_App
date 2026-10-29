const tokens = require("../../Shared/ui-core/src/tokens.json");
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "../../Shared/ui-mobile/src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: { extend: { colors: { ink: tokens.palette.background, panel: tokens.palette.surface, raised: tokens.palette.raised, line: tokens.palette.border, ivory: tokens.palette.foreground, muted: tokens.palette.muted, champagne: tokens.palette.accent, bronze: tokens.palette.accentDeep, danger: tokens.palette.danger, success: tokens.palette.success }, borderRadius: { luxe: `${tokens.radii.card}px` } } },
  plugins: [],
};
