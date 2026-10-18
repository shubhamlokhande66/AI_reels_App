// The parts of the app the administrator can show or hide (Administration → Features). Shared by the server (which
// refuses a hidden feature's work) and the browser (which hides its pages, menu items and buttons).

export type FeatureKey = "aiReel" | "productReel" | "story" | "editor" | "fastStudio" | "studioAI" | "library" | "songs" | "templates" | "brands";

export const FEATURE_LIST: { key: FeatureKey; label: string; hint: string; server: boolean; pages: string[] }[] = [
  { key: "fastStudio", label: "Fast Studio", hint: "Edit on the phone itself: free, nothing uploaded.", server: false, pages: ["/studio"] },
  { key: "studioAI", label: "Fast Studio AI", hint: "The AI edits every Fast Studio Reel: it looks at the clips, then decides the pace, shots, transitions and camera moves. People never choose; it is on for everyone or off. Uses your AI provider.", server: true, pages: [] },
  { key: "aiReel", label: "Create Reel (AI edit)", hint: "Clips and a song, cut to the beat by the AI on the server.", server: true, pages: [] },
  { key: "productReel", label: "Product Reel", hint: "A Reel directed from product photos, made on the server.", server: true, pages: [] },
  { key: "story", label: "Story → Reel", hint: "A narrated Reel from text: AI scenes, voice and pictures on the server.", server: true, pages: ["/story/new"] },
  { key: "editor", label: "Editor", hint: "The editor that saves and exports on the server.", server: true, pages: ["/editor"] },
  { key: "library", label: "Footage library", hint: "Every uploaded clip, searchable; stored on the server.", server: true, pages: ["/library"] },
  { key: "songs", label: "Songs", hint: "The song library, stored on the server.", server: true, pages: ["/songs"] },
  { key: "templates", label: "Templates", hint: "Saved ways of working; the AI writes drafts on the server.", server: true, pages: ["/templates"] },
  { key: "brands", label: "Brands", hint: "Logo, colours and defaults applied to Reels.", server: true, pages: ["/brands"] },
];

export type Features = Record<FeatureKey, boolean>;
export const ALL_ON: Features = Object.fromEntries(FEATURE_LIST.map((f) => [f.key, true])) as Features;
/** Until the administrator decides otherwise: only Fast Studio (made on the phone) is on; every part that works on the
 * server starts off, so the app is fast and puts no load on the server. */
export const DEFAULTS: Features = Object.fromEntries(FEATURE_LIST.map((f) => [f.key, !f.server])) as Features;

/** The feature a page belongs to (null: always shown). Create Reel is hidden only when both of its kinds are off. */
export function pageFeature(path: string, f: Features): FeatureKey | null {
  if (path === "/projects/new") return !f.aiReel && !f.productReel ? "aiReel" : null;
  // the server's projects: shown while any part that makes Reels on the server is on (Fast Studio's are in My Reels)
  if (path === "/projects" || path.startsWith("/projects/")) return !f.aiReel && !f.productReel && !f.story && !f.editor ? "aiReel" : null;
  for (const x of FEATURE_LIST) if (x.pages.some((p) => path === p || path.startsWith(`${p}/`))) return x.key;
  return null;
}

/** Is this link shown, with these features? */
export function linkOn(href: string, f: Features): boolean {
  const path = href.split("?")[0];
  if (href.includes("kind=product")) return f.productReel;
  const k = pageFeature(path, f);
  return k === null || f[k];
}
