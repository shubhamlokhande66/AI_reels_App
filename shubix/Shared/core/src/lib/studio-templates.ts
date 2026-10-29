/** Fast Studio's ready-made templates. The administrator manages them (Admin → Templates: add, change, hide, order, the
 * times of their texts and the dates they show); these are the defaults until something is saved. Each is plain data,
 * so it can be stored on the server and read by the Home and Templates pages and by the studio
 * (components/studio/engine.ts turns `edit` into the Reel's settings). A template opens Fast Studio at /create/edit?tpl=<id>. */

/** When a text shows: `p` of the Reel's length plus `s` seconds (L/3 = {p: 1/3}, three seconds before the end = {p: 1, s: -3}). */
export interface TplEdge { p: number; s: number }
export interface TplText {
  text: string;
  style: TplTextStyle;
  color: string;
  anim?: TplAnim;
  /** 0 top .. 1 bottom (the centre of the text) */
  y: number;
  /** 1 = the normal size */
  size?: number;
  /** on for the whole Reel (from/to are not used then) */
  all?: boolean;
  from?: TplEdge;
  to?: TplEdge;
}
export interface TplEdit {
  look: TplLook;
  /** music Reels: how the clips are cut */
  mode?: TplMode;
  /** talking Reels: how much of the pauses is cut, and the music under the voice */
  pace?: TplPace;
  music?: number;
  caps?: boolean;
  /** the captions' style */
  style?: TplCapStyle;
  bg?: TplBg;
  /** the opener's hook text */
  hook?: string;
  texts?: TplText[];
}
export interface StudioTemplate {
  id: string;
  name: string;
  /** what you add: clips with a song, clips of you talking, or photos with a song */
  kind: TplKind;
  /** seconds of the song (talking Reels follow the speech) */
  len?: number;
  /** what it does, in a line */
  text: string;
  group: string;
  /** a cover picture (a URL, or /templates/<id>.webp); without one the card draws its own poster */
  cover?: string;
  /** shown to people (off = hidden, kept for later) */
  on: boolean;
  /** shown only between these days (YYYY-MM-DD, both included); empty = always. For festivals. */
  showFrom?: string;
  showTo?: string;
  /** a "New" badge on the card */
  isNew?: boolean;
  /** the plan that opens it (Admin → Templates); none = free for everyone. A lower plan sees the Upgrade tag. */
  plan?: "free" | "creator" | "pro" | "business";
  edit: TplEdit;
}

export type TplKind = "music" | "talk" | "photo";
export const TPL_KINDS: Record<TplKind, string> = { music: "Music (clips + a song)", talk: "Talking (clips of you speaking)", photo: "Photos (photos + a song)" };
export const TPL_LOOKS = { natural: "Natural", vivid: "Vivid", cine: "Cinematic", mono: "B&W" } as const;
export const TPL_MODES = { auto: "Auto", smooth: "Smooth", fast: "Fast" } as const;
export const TPL_PACES = { tight: "Tight", natural: "Natural", relaxed: "Relaxed", off: "Keep all" } as const;
export const TPL_MUSIC = [0, 0.05, 0.09, 0.16] as const;
export const TPL_CAP_STYLES = { pop: "Pop", karaoke: "Karaoke", box: "Box", clean: "Clean" } as const;
export const TPL_BGS = { none: "Original", blur: "Blur", color: "Colour" } as const;
export const TPL_TEXT_STYLES = { bold: "Bold", box: "Box", neon: "Neon", clean: "Clean", tag: "Tag", outline: "Outline only", shadow: "Hard shadow", bubble: "Speech bubble", glow: "Soft glow", stack: "Double outline" } as const;
export const TPL_ANIMS = { pop: "Pop", fade: "Fade", slide: "Slide up", type: "Typewriter", none: "None" } as const;
export type TplLook = keyof typeof TPL_LOOKS;
export type TplMode = keyof typeof TPL_MODES;
export type TplPace = keyof typeof TPL_PACES;
export type TplCapStyle = keyof typeof TPL_CAP_STYLES;
export type TplBg = keyof typeof TPL_BGS;
export type TplTextStyle = keyof typeof TPL_TEXT_STYLES;
export type TplAnim = keyof typeof TPL_ANIMS;
export const TPL_LIMITS = { templates: 200, texts: 8, name: 40, text: 160, line: 80 } as const;

const at = (p: number, s = 0): TplEdge => ({ p, s });
const T = (text: string, style: TplTextStyle, color: string, y: number, from?: TplEdge, to?: TplEdge, size?: number): TplText =>
  ({ text, style, color, y, ...(from ? { from } : {}), ...(to ? { to } : {}), ...(size ? { size } : {}) });
const ALL = (text: string, style: TplTextStyle, color: string, y: number): TplText => ({ text, style, color, y, all: true });
const SAVE = (text: string, color: string) => T(text, "box", color, 0.66, at(1, -3), at(1), 0.85);

export const DEFAULT_TEMPLATES: StudioTemplate[] = [
  { id: "montage", name: "Beat montage", kind: "music", len: 15, group: "Everyday", on: true, text: "A cut on every beat, fast transitions, a hook that says wait for the drop.",
    edit: { look: "cine", mode: "fast", style: "pop", hook: "WAIT FOR THE DROP" } },
  { id: "beforeafter", name: "Before / After", kind: "music", len: 15, group: "Everyday", on: true, text: "The first half is before, the second after: makeovers, rooms, edits.",
    edit: { look: "vivid", mode: "auto", style: "pop", texts: [T("BEFORE", "box", "#111111", 0.2, at(0), at(0.5)), T("AFTER", "box", "#3DDC84", 0.2, at(0.5), at(1))] } },
  { id: "talking", name: "Talking head", kind: "talk", group: "Everyday", on: true, text: "You on camera: pauses cut, big karaoke captions, soft music under the voice.",
    edit: { look: "natural", pace: "natural", music: 0.05, caps: true, style: "karaoke", bg: "none" } },
  { id: "tutorial", name: "Tutorial", kind: "talk", group: "Everyday", on: true, text: "Step 1, 2, 3 on screen while you explain, and a save reminder at the end.",
    edit: { look: "natural", pace: "tight", music: 0.05, caps: true, style: "box", texts: [T("Step 1", "box", "#FFD54A", 0.2, at(0), at(1 / 3)), T("Step 2", "box", "#FFD54A", 0.2, at(1 / 3), at(2 / 3)), T("Step 3", "box", "#FFD54A", 0.2, at(2 / 3), at(1)), SAVE("Save this for later 📌", "#4DA3FF")] } },
  { id: "pov", name: "POV", kind: "music", len: 15, group: "Everyday", on: true, isNew: true, text: "A POV line on top for the whole Reel, smooth cuts under it.",
    edit: { look: "cine", mode: "smooth", style: "pop", texts: [ALL("POV: you finally did it", "bold", "#FFFFFF", 0.2)] } },
  { id: "dayinlife", name: "Day in my life", kind: "music", len: 30, group: "Everyday", on: true, isNew: true, text: "Morning to night in quick cuts, with the time of day on screen.",
    edit: { look: "natural", mode: "auto", style: "clean", texts: [T("☀️ Morning", "tag", "#FFD54A", 0.18, at(0), at(1 / 3)), T("🌤️ Afternoon", "tag", "#FF9F43", 0.18, at(1 / 3), at(2 / 3)), T("🌙 Night", "tag", "#7C5CFF", 0.18, at(2 / 3), at(1))] } },
  { id: "quote", name: "Quote", kind: "music", len: 15, group: "Everyday", on: true, isNew: true, text: "One line of words over slow, moody clips.",
    edit: { look: "mono", mode: "smooth", style: "clean", texts: [ALL("Your words here", "clean", "#FFFFFF", 0.5)] } },
  { id: "slideshow", name: "Photo slideshow", kind: "photo", len: 15, group: "Everyday", on: true, isNew: true, text: "Your photos gently moving to the music, one on every beat.",
    edit: { look: "natural", mode: "smooth", style: "clean" } },
  { id: "memories", name: "Memories", kind: "photo", len: 30, group: "Occasions", on: true, isNew: true, text: "Old photos, soft cinematic moves, a warm title and a last line.",
    edit: { look: "cine", mode: "smooth", style: "clean", texts: [T("Memories ❤️", "glow", "#FFD54A", 0.24, at(0), at(0, 3)), T("Forever in our hearts", "clean", "#FFFFFF", 0.7, at(1, -3), at(1))] } },
  { id: "bdayphotos", name: "Birthday photos", kind: "photo", len: 15, group: "Occasions", on: true, isNew: true, text: "Their photos on a party beat with Happy Birthday on top.",
    edit: { look: "vivid", mode: "fast", style: "pop", texts: [T("Happy Birthday 🎂", "neon", "#FF6FD8", 0.24, at(0), at(1, -3)), T("Love you ❤️", "box", "#FF4D4D", 0.66, at(1, -3), at(1), 0.9)] } },
  { id: "birthday", name: "Birthday", kind: "music", len: 15, group: "Occasions", on: true, isNew: true, text: "Happy birthday in big letters, bright colours, a beat for the party.",
    edit: { look: "vivid", mode: "fast", style: "pop", texts: [T("Happy Birthday 🎂", "neon", "#FF6FD8", 0.24, at(0), at(1, -3)), T("Love you always ❤️", "box", "#FF4D4D", 0.66, at(1, -3), at(1), 0.9)] } },
  { id: "wedding", name: "Wedding", kind: "music", len: 30, group: "Occasions", on: true, isNew: true, text: "Slow cinematic cuts and the couple's names in gold.",
    edit: { look: "cine", mode: "smooth", style: "clean", texts: [T("Name ❤️ Name", "glow", "#FFD54A", 0.24, at(0), at(0, 4)), T("Forever begins 💍", "clean", "#FFFFFF", 0.7, at(1, -3), at(1))] } },
  { id: "cardelivery", name: "Car delivery", kind: "music", len: 30, group: "Occasions", on: true, isNew: true, text: "A cut on every hit, a flicker before the drop and the new ride's name.",
    edit: { look: "vivid", mode: "fast", style: "pop", texts: [T("New ride 🔑", "shadow", "#FFFFFF", 0.22, at(0), at(0, 2.4))] } },
  { id: "opening", name: "Shop opening", kind: "music", len: 30, group: "Business", on: true, isNew: true, text: "The ribbon, the crowd and the shop: quick cuts and the shop's name.",
    edit: { look: "vivid", mode: "auto", style: "pop", texts: [T("Grand opening ✨", "neon", "#FFD54A", 0.22, at(0), at(0, 3)), SAVE("Visit us 📍", "#FF4D4D")] } },
  { id: "party", name: "Party / Event", kind: "music", len: 30, group: "Occasions", on: true, isNew: true, text: "Lights, crowd and the DJ: fast cuts on the beat and a big title.",
    edit: { look: "cine", mode: "fast", style: "pop", texts: [T("Last night 🔥", "glow", "#FF6FD8", 0.22, at(0), at(0, 2.6))] } },
  { id: "product", name: "Product", kind: "music", len: 15, group: "Business", on: true, text: "New arrival, the price tag and DM to order: made to sell.",
    edit: { look: "vivid", mode: "auto", style: "pop", texts: [T("New arrival ✨", "neon", "#FFD54A", 0.22, at(0), at(0, 2.4)), T("₹999 only", "tag", "#FFD54A", 0.62, at(0.35), at(1, -3)), SAVE("DM to order 👉", "#FF4D4D")] } },
  { id: "sale", name: "Sale / Offer", kind: "music", len: 15, group: "Business", on: true, isNew: true, text: "A big offer, the last day and where to buy, on a fast beat.",
    edit: { look: "vivid", mode: "fast", style: "pop", texts: [T("FLAT 50% OFF 🔥", "box", "#FF4D4D", 0.22, at(0), at(0.6)), T("Last day today", "tag", "#FFD54A", 0.62, at(0.3), at(1, -3)), SAVE("Shop now 👉", "#3DDC84")] } },
  { id: "gym", name: "Gym / Fitness", kind: "music", len: 15, group: "Business", on: true, isNew: true, text: "Hard cuts on the beat, a strong look and a join-now card.",
    edit: { look: "mono", mode: "fast", style: "pop", texts: [T("NO EXCUSES 💪", "shadow", "#FFFFFF", 0.22, at(0), at(0, 3)), SAVE("Join now 👉", "#FF4D4D")] } },
  { id: "recipe", name: "Recipe", kind: "music", len: 30, group: "Travel & food", on: true, text: "Smooth cuts, an easy-recipe title and a save reminder.",
    edit: { look: "vivid", mode: "smooth", style: "box", texts: [T("Easy recipe in 30 seconds", "box", "#FFD54A", 0.22, at(0), at(0, 2.6)), SAVE("Save this recipe 📌", "#FF4D4D")] } },
  { id: "travel", name: "Travel", kind: "music", len: 30, group: "Travel & food", on: true, text: "Slow, cinematic cuts and the name of the place.",
    edit: { look: "cine", mode: "smooth", style: "clean", texts: [T("📍 Your place", "clean", "#FFFFFF", 0.25, at(0), at(0, 3))] } },
  { id: "tripphotos", name: "Trip photos", kind: "photo", len: 30, group: "Travel & food", on: true, isNew: true, text: "Your trip in photos: slow cinematic moves and the place's name.",
    edit: { look: "cine", mode: "smooth", style: "clean", texts: [T("📍 Our trip", "clean", "#FFFFFF", 0.25, at(0), at(0, 3))] } },
  { id: "ganpati", name: "Ganpati", kind: "music", len: 30, group: "Festivals", on: true, text: "Ganpati Bappa Morya in gold, warm colours, cut to the aarti or your song.",
    edit: { look: "vivid", mode: "auto", style: "pop", texts: [ALL("गणपती बाप्पा मोरया 🌺", "neon", "#FFD54A", 0.26)] } },
  { id: "diwali", name: "Diwali", kind: "music", len: 30, group: "Festivals", on: true, text: "Shubh Deepavali in gold over smooth, cinematic cuts.",
    edit: { look: "cine", mode: "smooth", style: "pop", texts: [ALL("शुभ दीपावली 🪔", "neon", "#FFD54A", 0.26)] } },
  { id: "navratri", name: "Navratri", kind: "music", len: 30, group: "Festivals", on: true, isNew: true, text: "Garba beats, bright colours and Happy Navratri.",
    edit: { look: "vivid", mode: "fast", style: "pop", texts: [ALL("Happy Navratri 🪷", "neon", "#FF6FD8", 0.24)] } },
  { id: "holi", name: "Holi", kind: "music", len: 15, group: "Festivals", on: true, isNew: true, text: "Colour everywhere, fast cuts and Happy Holi.",
    edit: { look: "vivid", mode: "fast", style: "pop", texts: [ALL("Happy Holi 🎨", "stack", "#3DDC84", 0.24)] } },
  { id: "padwa", name: "Gudi Padwa", kind: "music", len: 30, group: "Festivals", on: true, isNew: true, text: "गुढीपाडव्याच्या शुभेच्छा over warm, smooth cuts.",
    edit: { look: "vivid", mode: "smooth", style: "pop", texts: [ALL("गुढीपाडव्याच्या हार्दिक शुभेच्छा 🚩", "neon", "#FF9F43", 0.24)] } },
  { id: "eid", name: "Eid", kind: "music", len: 30, group: "Festivals", on: true, isNew: true, text: "Eid Mubarak in gold over calm, cinematic cuts.",
    edit: { look: "cine", mode: "smooth", style: "clean", texts: [ALL("Eid Mubarak 🌙", "glow", "#FFD54A", 0.24)] } },
  { id: "christmas", name: "Christmas", kind: "music", len: 15, group: "Festivals", on: true, isNew: true, text: "Merry Christmas, warm lights and a happy beat.",
    edit: { look: "cine", mode: "auto", style: "pop", texts: [ALL("Merry Christmas 🎄", "neon", "#3DDC84", 0.24)] } },
  { id: "newyear", name: "New Year", kind: "music", len: 15, group: "Festivals", on: true, isNew: true, text: "A countdown feel, fast cuts and Happy New Year.",
    edit: { look: "vivid", mode: "fast", style: "pop", hook: "3… 2… 1…", texts: [T("Happy New Year 🎉", "neon", "#FFD54A", 0.26, at(0, 2), at(1))] } },
];

/** the edge in seconds of a Reel `L` long */
export const edgeAt = (e: TplEdge | undefined, L: number, d: number) => (e ? Math.max(0, Math.min(L, e.p * L + e.s)) : d);
/** the day as YYYY-MM-DD in India (where the festivals are) */
export const todayIST = (now = Date.now()) => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);
/** shown to people today: on, and inside its days when it has them */
export const isLive = (t: StudioTemplate, day = todayIST()) => t.on && (!t.showFrom || day >= t.showFrom) && (!t.showTo || day <= t.showTo);
export const liveTemplates = (list: StudioTemplate[], day?: string) => list.filter((t) => isLive(t, day));
/** the groups in the order they first appear */
export const groupsOf = (list: StudioTemplate[]) => [...new Set(list.map((t) => t.group))];

export const templateHref = (t: StudioTemplate) => `/create/edit?tpl=${encodeURIComponent(t.id)}`;
export const lookName = (t: StudioTemplate) => TPL_LOOKS[t.edit.look] ?? "Natural";
export const templateMeta = (t: StudioTemplate) => `${t.kind === "talk" ? "Talking" : t.kind === "photo" ? "Photos" : "Music"}${t.len ? ` · ${t.len} s` : ""} · ${lookName(t)}`;
/** a sample of the text the template puts on the Reel (the card's poster) */
export const sampleOf = (t: StudioTemplate) => t.edit.texts?.[0]?.text || t.edit.hook || t.name;
