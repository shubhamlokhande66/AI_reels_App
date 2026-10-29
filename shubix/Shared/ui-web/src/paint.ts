import { tones, type Paint, type Tone } from "@shubix/ui-core";

/** A shared Paint (Shared/ui-core/src/paint.ts) as a CSS background: its glows over its straight gradient. */
export function paintCss({ angle, stops, glows = [] }: Paint): string {
  const glow = ([x, y, end, color, w, h]: (typeof glows)[number]) => `radial-gradient(${w === undefined ? "circle" : `${w}% ${h}%`} at ${x}% ${y}%, ${color}, transparent ${end}%)`;
  const line = `linear-gradient(${angle}deg, ${stops.map((s) => (typeof s === "string" ? s : `${s[0]} ${s[1]}%`)).join(", ")})`;
  return [...glows.map(glow), line].join(", ");
}

/** A tone's background (a create card, an icon tile): its gradient; brand is the gold, neutral the raised surface. */
export const toneBackground = (tone: Tone): string =>
  tone === "brand" ? "var(--gold-gradient)" : tone === "neutral" ? "var(--surface-2)" : paintCss(tones[tone]);
export { gradients } from "@shubix/ui-core";
export { heroArt, posterShade, templateArt, templateArtFallback, tones, type Paint, type Tone } from "@shubix/ui-core";
