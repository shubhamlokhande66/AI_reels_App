/** Lists the administrator builds in the CMS (Admin → CMS): cards, tips, questions… A list belongs to a page's section
 * (Home → Create Your Reel), has a few fields per item (title, line, link, icon…), and starts with the items below.
 * In the CMS each item can be added, changed, moved and removed; the app shows the saved list (server/content.ts),
 * else these. Item ids stay the same while it is moved (React keys, and so a change is kept to its item). */

export type FieldType = "text" | "long" | "link" | "icon" | "tone" | "color";
export interface ListField { key: string; label: string; type: FieldType; required?: boolean; hint?: string }
export type ListItem = { id: string } & Record<string, string>;
export interface ListDef { id: string; page: string; section: string; name: string; itemName: string; max: number; fields: ListField[]; items: ListItem[] }

/** the icons an item can show (components/atoms/Icon.tsx) */
export const ICON_CHOICES = ["music", "mic", "image", "copy", "book", "grid", "video", "reels", "star", "bolt", "sparkle", "wand", "bulb", "play", "text", "captions", "layers", "palette", "heart", "crown", "coins", "mail", "chat", "share", "trend", "eye", "bell", "home", "user", "gear", "shield", "scissors", "upload", "download", "check", "send"];
/** the colours a card can have (lib/ui.ts tones) */
export const TONE_CHOICES = ["music", "talk", "photo", "story", "template", "copy", "recreate", "brand", "neutral"];

const card = (id: string, title: string, text: string, link: string, icon: string, tone: string): ListItem => ({ id, title, text, link, icon, tone });

export const LISTS: ListDef[] = [
  {
    id: "home.cards", page: "home", section: "Create Your Reel", name: "Cards", itemName: "card", max: 14,
    fields: [
      { key: "title", label: "Title", type: "text", required: true }, { key: "text", label: "Line", type: "text" },
      { key: "link", label: "Opens", type: "link", required: true, hint: "A page of the app (/create/music, /templates…) or a full link (https://…)" },
      { key: "icon", label: "Icon", type: "icon" }, { key: "tone", label: "Colour", type: "tone" },
    ],
    items: [
      card("music", "Music Reel", "Sync with Music", "/create/music", "music", "music"),
      card("talking", "Talking Reel", "Vlogs & Tutorials", "/create/talking", "mic", "talk"),
      card("photo", "Photo Reel", "Bring Photos to Life", "/create/photo", "image", "photo"),
      card("copy", "Copy a Reel", "Match any Reel", "/create/copy", "copy", "copy"),
      card("story", "Story Maker", "Text to Video", "/create/story", "book", "story"),
      card("templates", "Templates", "Ready-made Styles", "/templates", "grid", "template"),
      card("reels", "My Reels", "Watch & share", "/reels", "video", "recreate"),
    ],
  },
  {
    id: "home.tips", page: "home", section: "Tips for Better Reels", name: "Tips", itemName: "tip", max: 12,
    fields: [{ key: "title", label: "Title", type: "text", required: true }, { key: "text", label: "Line", type: "text" }, { key: "icon", label: "Icon", type: "icon" }, { key: "color", label: "Icon colour", type: "color" }],
    items: [
      { id: "hook", title: "Add a strong hook", text: "First 2 seconds matter the most.", icon: "bulb", color: "#facc15" },
      { id: "music", title: "Use trending music", text: "That matches your vibe.", icon: "music", color: "#e879f9" },
      { id: "short", title: "Keep it short and engaging", text: "15–30 seconds works best.", icon: "play", color: "#c026d3" },
      { id: "text", title: "Add text and captions", text: "So everyone can understand.", icon: "text", color: "#f472b6" },
    ],
  },
  {
    id: "pricing.faq", page: "pricing", section: "Questions", name: "Questions", itemName: "question", max: 30,
    fields: [{ key: "q", label: "Question", type: "text", required: true }, { key: "a", label: "Answer", type: "long", required: true }],
    items: [
      { id: "credit", q: "What does a credit buy?", a: "Credits measure what you make. A Reel from your own clips uses 1 credit; a narrated Story Reel uses a few credits plus 1 for each Shubix picture. Classical paintings and library pictures are free. Previews are free." },
      { id: "crown", q: "What does the 👑 mean?", a: "Most of the editor is free, keyframes, green screen and sound effects included. Some effects, transitions, filters and fonts, and a few advanced tools, carry a crown: you can try them in your Reel for free, and exporting with them needs the plan shown. You can also take them out and export for free." },
      { id: "gst", q: "Are prices including GST?", a: "Yes. The price you see is the price you pay." },
      { id: "unused", q: "What happens to unused credits?", a: "Plan credits renew every month and do not carry over. Starter and top-up credits never expire." },
      { id: "cancel", q: "Can I cancel any time?", a: "Yes. You pay for a month or a year at a time and nothing renews by itself, so there is nothing to cancel." },
      { id: "fails", q: "What if a Reel fails?", a: "Its credits come back to you automatically." },
      { id: "own", q: "Do I own my Reels?", a: "Yes. Download them, post them anywhere, use them for your business." },
      { id: "footage", q: "Is my footage kept?", a: "Uploaded clips are deleted automatically after a short time for your privacy. Download your Reel before then." },
    ],
  },
  {
    id: "contact.ways", page: "contact", section: "Ways to reach us", name: "More ways to reach us", itemName: "way", max: 8,
    fields: [
      { key: "title", label: "Title", type: "text", required: true }, { key: "text", label: "Line", type: "text" },
      { key: "link", label: "Opens", type: "link", required: true, hint: "https://instagram.com/…, mailto:…, tel:…" },
      { key: "icon", label: "Icon", type: "icon" }, { key: "tone", label: "Colour", type: "tone" },
    ],
    items: [], // email and WhatsApp come from the server's details (SUPPORT_EMAIL, SUPPORT_PHONE); these are more
  },
];

export type Content = Record<string, ListItem[]>;
export const listDef = (id: string) => LISTS.find((l) => l.id === id)!;
/** a new, empty item for a list */
export const newItem = (l: ListDef): ListItem => ({ id: Math.random().toString(36).slice(2, 10), ...Object.fromEntries(l.fields.map((f) => [f.key, f.type === "icon" ? "sparkle" : f.type === "tone" ? "brand" : f.type === "color" ? "#b05cff" : ""])) } as ListItem);
