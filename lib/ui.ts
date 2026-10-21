/** The design's colour tones (UI/ design: Create Options). One tone per kind of Reel, used by icon tiles and
 * create cards, so a Music Reel is the same magenta-violet everywhere. Tailwind classes, kept whole so the build sees them. */
export type Tone = "music" | "talk" | "photo" | "story" | "template" | "copy" | "recreate" | "brand" | "neutral";

export const TONE_BG: Record<Tone, string> = {
  music: "bg-[linear-gradient(135deg,#e040fb,#7c3aed)]",
  talk: "bg-[linear-gradient(135deg,#3b8bff,#1d4ed8)]",
  photo: "bg-[linear-gradient(135deg,#ff9a3d,#ff4f6d)]",
  story: "bg-[linear-gradient(135deg,#12c79a,#0f766e)]",
  template: "bg-[linear-gradient(135deg,#ff4fb4,#d61f7a)]",
  copy: "bg-[linear-gradient(135deg,#22d3ee,#0369a1)]",
  recreate: "bg-[linear-gradient(135deg,#5146e5,#2e2a8a)]",
  brand: "bg-[image:var(--gold-gradient)]",
  neutral: "bg-surface-2",
};

/** the soft glow under a tone's card */
export const TONE_GLOW: Record<Tone, string> = {
  music: "shadow-[0_14px_30px_-16px_rgba(224,64,251,.8)]",
  talk: "shadow-[0_14px_30px_-16px_rgba(59,139,255,.8)]",
  photo: "shadow-[0_14px_30px_-16px_rgba(255,111,80,.8)]",
  story: "shadow-[0_14px_30px_-16px_rgba(18,199,154,.7)]",
  template: "shadow-[0_14px_30px_-16px_rgba(255,79,180,.8)]",
  copy: "shadow-[0_14px_30px_-16px_rgba(34,211,238,.7)]",
  recreate: "shadow-[0_14px_30px_-16px_rgba(81,70,229,.8)]",
  brand: "shadow-[0_14px_30px_-16px_var(--brand-glow)]",
  neutral: "",
};
