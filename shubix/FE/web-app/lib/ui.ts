/** The design's jewel tones (UI/ design: Create Options). One tone per kind of Reel, used by icon tiles and
 * create cards so actions are easy to scan while sharing the studio's quieter premium palette. */
export type Tone = "music" | "talk" | "photo" | "story" | "template" | "copy" | "recreate" | "brand" | "neutral";

export const TONE_BG: Record<Tone, string> = {
  music: "bg-[linear-gradient(135deg,#d8bd7b,#80683a)]",
  talk: "bg-[linear-gradient(135deg,#7187a1,#33445a)]",
  photo: "bg-[linear-gradient(135deg,#c2845f,#704535)]",
  story: "bg-[linear-gradient(135deg,#65977c,#315d49)]",
  template: "bg-[linear-gradient(135deg,#aa7d91,#624657)]",
  copy: "bg-[linear-gradient(135deg,#65949a,#345b60)]",
  recreate: "bg-[linear-gradient(135deg,#82799f,#4c4567)]",
  brand: "bg-gold",
  neutral: "bg-surface-2",
};

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
