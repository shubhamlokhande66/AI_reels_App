import { palette } from "@mobile/ui-core";
/** The Dark look's colours, for code that has no look yet; components use useColors() (theme.tsx). */
export const colors = palette;

/** CSS color-mix(in srgb, `a` p%, `b`) for two #rrggbb colours (the website's accent-tinted surfaces). */
export function mix(a: string, b: string, p: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v * p + y[i] * (1 - p)).toString(16).padStart(2, "0")).join("");
}

/** The website's gold-tinted banner ground: color-mix(accent 18%, surface) → color-mix(accent 5%, surface). */
export const accentWash = (angle: number, look: { accent: string; surface: string }) => ({ angle, stops: [mix(look.accent, look.surface, 0.18), mix(look.accent, look.surface, 0.05)] });
