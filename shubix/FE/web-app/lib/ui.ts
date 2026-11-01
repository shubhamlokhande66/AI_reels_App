/** The design's jewel tones (UI/ design: Create Options): one per kind of Reel, used by icon tiles and create cards.
 * Their colours: Shared/ui-core/src/paint.ts (toneBackground). */
export type { Tone } from "@shubix/ui-web";
import type { Tone } from "@shubix/ui-web";

/** the soft glow under a tone's card */
export const TONE_GLOW: Record<Tone, string> = {
  music: "shadow-[0_14px_30px_-16px_rgba(216,189,123,.42)]",
  talk: "shadow-[0_14px_30px_-16px_rgba(80,105,140,.4)]",
  photo: "shadow-[0_14px_30px_-16px_rgba(170,104,70,.4)]",
  story: "shadow-[0_14px_30px_-16px_rgba(66,126,91,.4)]",
  template: "shadow-[0_14px_30px_-16px_rgba(132,83,111,.4)]",
  copy: "shadow-[0_14px_30px_-16px_rgba(72,126,133,.4)]",
  recreate: "shadow-[0_14px_30px_-16px_rgba(95,83,130,.4)]",
  brand: "shadow-[0_14px_30px_-16px_var(--brand-glow)]",
  neutral: "",
};
