/** Fast Studio's ready-made templates, as people see them (Templates page, Home). Each opens Fast Studio with that
 * template picked (/studio?tpl=<id>); what a template does to the edit (style, look, length, texts) lives in the studio
 * itself (components/studio/engine.ts TEMPLATES): keep the ids the same. */
export interface StudioTemplate {
  id: string;
  name: string;
  /** what you add: clips with a song, or clips of you talking */
  kind: "music" | "talk";
  /** seconds (talking Reels follow the speech) */
  len?: number;
  text: string;
  /** a sample of the text the template puts on the Reel, in its style */
  sample: { text: string; style: "box" | "neon" | "tag" | "clean" | "pop"; color: string; y: number };
  look: string;
  /** a cover picture (public/templates/<id>.webp); without one the card draws its own poster */
  cover?: string;
  group: "Everyday" | "Business" | "Festivals" | "Travel & food";
}

export const STUDIO_TEMPLATES: StudioTemplate[] = [
  { id: "montage", name: "Beat montage", kind: "music", len: 15, text: "A cut on every beat, fast transitions, a hook that says wait for the drop.", sample: { text: "WAIT FOR THE DROP", style: "pop", color: "#FFFFFF", y: 0.3 }, look: "Cinematic", group: "Everyday" },
  { id: "beforeafter", name: "Before / After", kind: "music", len: 15, text: "The first half is before, the second after: makeovers, rooms, edits.", sample: { text: "BEFORE", style: "box", color: "#111111", y: 0.2 }, look: "Vivid", group: "Everyday" },
  { id: "talking", name: "Talking head", kind: "talk", text: "You on camera: pauses cut, big karaoke captions, soft music under the voice.", sample: { text: "your words, as you speak", style: "pop", color: "#FFD54A", y: 0.7 }, look: "Natural", group: "Everyday" },
  { id: "tutorial", name: "Tutorial", kind: "talk", text: "Step 1, 2, 3 on screen while you explain, and a save reminder at the end.", sample: { text: "Step 1", style: "box", color: "#FFD54A", y: 0.2 }, look: "Natural", group: "Everyday" },
  { id: "product", name: "Product", kind: "music", len: 15, text: "New arrival, the price tag and DM to order: made to sell.", sample: { text: "₹999 only", style: "tag", color: "#FFD54A", y: 0.62 }, look: "Vivid", group: "Business" },
  { id: "recipe", name: "Recipe", kind: "music", len: 30, text: "Smooth cuts, an easy-recipe title and a save reminder.", sample: { text: "Easy recipe in 30 seconds", style: "box", color: "#FFD54A", y: 0.22 }, look: "Vivid", group: "Travel & food" },
  { id: "travel", name: "Travel", kind: "music", len: 30, text: "Slow, cinematic cuts and the name of the place.", sample: { text: "📍 Your place", style: "clean", color: "#FFFFFF", y: 0.25 }, look: "Cinematic", group: "Travel & food" },
  { id: "ganpati", name: "Ganpati", kind: "music", len: 30, text: "Ganpati Bappa Morya in gold, warm colours, cut to the aarti or your song.", sample: { text: "गणपती बाप्पा मोरया 🌺", style: "neon", color: "#FFD54A", y: 0.26 }, look: "Vivid", group: "Festivals" },
  { id: "diwali", name: "Diwali", kind: "music", len: 30, text: "Shubh Deepavali in gold over smooth, cinematic cuts.", sample: { text: "शुभ दीपावली 🪔", style: "neon", color: "#FFD54A", y: 0.26 }, look: "Cinematic", group: "Festivals" },
];

export const templateHref = (t: StudioTemplate) => `/studio?tpl=${t.id}`;
export const templateMeta = (t: StudioTemplate) => `${t.kind === "talk" ? "Talking" : "Music"}${t.len ? ` · ${t.len} s` : ""} · ${t.look}`;
