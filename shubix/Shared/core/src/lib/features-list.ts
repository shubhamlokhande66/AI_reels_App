// The parts of the app the administrator can show or hide (Administration → Features). Shared by the server (which
// refuses a hidden feature's work) and the browser (which hides its pages, menu items and buttons).

export type FeatureKey = "fastStudio" | "studioAI" | "brands";

export const FEATURE_LIST: { key: FeatureKey; label: string; hint: string; server: boolean; pages: string[] }[] = [
  { key: "fastStudio", label: "Create on the phone", hint: "Music, Talking and Photo Reels and Story Maker, made on the phone itself: free, nothing uploaded.", server: false, pages: ["/create"] },
  { key: "studioAI", label: "AI director", hint: "The AI edits every Reel made on the phone: it looks at the clips, then decides the pace, shots, transitions and camera moves. People never choose; it is on for everyone or off. Uses your AI provider.", server: true, pages: [] },
  { key: "brands", label: "Brands", hint: "Logo, colours and defaults applied to Reels.", server: true, pages: ["/brands"] },
];

export type Features = Record<FeatureKey, boolean>;
export const ALL_ON: Features = Object.fromEntries(FEATURE_LIST.map((f) => [f.key, true])) as Features;
/** Until the administrator decides otherwise: making Reels on the phone is on; the parts that use the server (the AI
 * director, Brands) start off. */
export const DEFAULTS: Features = Object.fromEntries(FEATURE_LIST.map((f) => [f.key, !f.server])) as Features;

/** The feature a page belongs to (null: always shown). */
export function pageFeature(path: string, _f: Features): FeatureKey | null {
  void _f;
  for (const x of FEATURE_LIST) if (x.pages.some((p) => path === p || path.startsWith(`${p}/`))) return x.key;
  return null;
}

/** Is this link shown, with these features? */
export function linkOn(href: string, f: Features): boolean {
  const k = pageFeature(href.split("?")[0], f);
  return k === null || f[k];
}
