import { TEXT_DEFAULTS, TEXT_GROUPS, type TextDef, type TextGroup } from "./texts";
import { STUDIO_TEXTS } from "./texts-studio";

/** Every text the administrator can change, the studio's too. Kept apart from lib/texts.ts: the studio's ~1000 texts
 * are loaded only by the CMS, the server's check and the studio itself, not by every page. */

/** where the studio's texts sit in the CMS: "Reel editor (Studio)", its pages and their sections in the order people
 * meet them (scripts/extract-studio-texts.mjs finds each text's screen). A changed text is swapped wherever it shows
 * in the studio (components/studio/textSwap.ts). */
export const STUDIO_AREA = "Reel editor (Studio)";
const STUDIO_PAGES: [id: string, name: string, sections: string[]][] = [
  ["studio-create", "Create flow", ["Start", "Choose what to make", "Match a Reel's Style: the Reel to match", "Song & clips", "Edit options", "Shubix AI at work", "Preview & export", "Exporting", "Your Reel is ready", "Messages while creating"]],
  ["studio-tools", "Editor tools", ["Tool bar", "Style", "Shots", "Music", "Text", "Captions", "Look", "Background", "Layers", "Voice", "Motion", "Media", "Clip tools", "Player & saving"]],
  ["studio-chat", "Ask Shubix (chat)", ["The chat"]],
  ["studio-story", "Story Maker", ["Story Maker"]],
  ["studio-names", "Names: effects, filters & fonts", ["Names"]],
  ["studio-messages", "Editor messages", ["Shubix AI & credits", "Export & saving", "Music & beats", "Clips & photos", "Text & captions", "Voice", "Other"]],
];
const CARDS = ["Titles & buttons", "Lines & messages"];

const studioGroups = (): TextGroup[] =>
  STUDIO_PAGES.map(([id, name, sections]) => {
    const rows = STUDIO_TEXTS.filter(([, , page]) => page === name);
    // in the order of the screen's sections, then titles and buttons before lines and messages
    rows.sort((a, b) => sections.indexOf(a[3]) - sections.indexOf(b[3]) || CARDS.indexOf(a[4]) - CARDS.indexOf(b[4]));
    const items: TextDef[] = rows.map(([key, text, , section, card]) => ({
      key, value: text, section, card, label: text.length > 48 ? `${text.slice(0, 45)}…` : text, ...(text.length > 70 ? { long: true } : {}),
    }));
    return { id, name, area: STUDIO_AREA, items };
  }).filter((g) => g.items.length);

export const ALL_TEXT_GROUPS: TextGroup[] = [...TEXT_GROUPS, ...studioGroups()];
export const ALL_TEXT_DEFAULTS: Record<string, string> = { ...TEXT_DEFAULTS, ...Object.fromEntries(STUDIO_TEXTS.map(([key, text]) => [key, text])) };
/** the studio's texts: its words → their key (the studio swaps a changed text by its words) */
export const STUDIO_KEYS = new Map(STUDIO_TEXTS.map(([key, text]) => [text, key]));
