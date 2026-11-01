// Lists every text the Fast Studio shows (components/studio/*), for Admin → CMS → Reel editor (Studio), sorted the way
// people see the editor: the Create flow's screens, the editor's tools, the chat, Story Maker, the names of effects,
// filters and fonts, and the editor's messages by subject. The studio is plain DOM code, so its words are not looked
// up by key: the app swaps a text the administrator changed wherever it shows (components/studio/textSwap.ts).
// Run after changing studio wording:   node scripts/extract-studio-texts.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "components/studio";
const OUT = "../../Shared/core/src/lib/texts-studio.ts";

// a stable key for a text: the same words always get the same key (FNV-1a)
const hash = (s) => { let h = 0x811c9dc5; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };

const looksLikeUi = (s) => {
  s = s.trim();
  if (s.length < 3 || s.length > 300) return false;
  if (!/[a-z]/.test(s) || !/^[A-Z0-9“"'(·•✓👑+–-]/u.test(s)) return false;          // words people read start like a sentence
  if (/[<>{}=;]|\$\{|https?:|^\/|\\[nu]|\bpx\b|rgba?\(|var\(--/.test(s)) return false; // markup, code, css, urls
  if (!/\s/.test(s) && (/[A-Z].*[A-Z]|\d|[_.\-/]/.test(s.slice(1)) || s.length < 4)) return false; // CamelCase, ids, file names
  if (/&&|\|\||\+$|,$|^\(|^\+ [a-z]|\w\+\w|\w\.\w+\(|^[\d.]+\s*[&|<>!=]|^\d+(\.\d+)?$/.test(s)) return false; // code pieces
  if (/[[\]\\*]|&\w|\w&|\?\s.*\s:\s|^'|'\s*\+|\+\s*'|\)\s*[:*;,]|:\s*[a-z]\w*$|\(\s*\d|\d\)/.test(s)) return false; // more code: indexes, maths, ternaries, joins
  if (/^(Arrow|Key|Digit|Enter$|Escape$|Backspace$|Tab$|Shift|Control|Meta|Alt)/.test(s)) return false; // keyboard keys
  if (/^(Float|Uint|Int)\d|Array$|^(Promise|Error|Object|Math|Date|JSON|Blob|File|Response|Request|Image|Audio|Video)\b/.test(s)) return false;
  return true;
};

// ---- where a text is on screen
const CREATE = "Create flow", TOOLS = "Editor tools", CHAT = "Ask Shubix (chat)", STORY = "Story Maker", NAMES = "Names: effects, filters & fonts", MSG = "Editor messages";
// markup.ts: its screens and panels, by their id / data-panel (the nearest one before a text wins)
const MARKUP = [
  [/id="fintro"/g, CREATE, "Start"], [/id="s0"/g, CREATE, "Choose what to make"], [/id="fref"/g, CREATE, "Copy a Reel: the Reel to copy"],
  [/id="s1"/g, CREATE, "Song & clips"], [/id="s2"/g, CREATE, "Edit options"], [/id="fai"/g, CREATE, "Shubix AI at work"], [/id="fan"/g, CREATE, "Shubix AI at work"],
  [/id="s3"/g, CREATE, "Preview & export"], [/id="playov"/g, TOOLS, "Player & saving"], [/id="panels"/g, TOOLS, "Tool bar"],
  [/data-panel="media"/g, TOOLS, "Media"], [/data-panel="style"/g, TOOLS, "Style"], [/data-panel="music"/g, TOOLS, "Music"], [/data-panel="text"/g, TOOLS, "Text"],
  [/data-panel="captions"/g, TOOLS, "Captions"], [/data-panel="look"/g, TOOLS, "Look"], [/data-panel="bg"/g, TOOLS, "Background"], [/data-panel="layers"/g, TOOLS, "Layers"],
  [/data-panel="voice"/g, TOOLS, "Voice"], [/data-panel="motion"/g, TOOLS, "Motion"], [/data-panel="shots"/g, TOOLS, "Shots"],
  [/id="ctpop"/g, TOOLS, "Clip tools"], [/id="shotsheet"/g, TOOLS, "Shots"], [/id="fexp"/g, CREATE, "Exporting"], [/id="fdone"/g, CREATE, "Your Reel is ready"], [/id="chatbox"/g, CHAT, "The chat"],
];
const FILES = { "flow.ts": [CREATE, "Messages while creating"], "steps.ts": [CREATE, "Messages while creating"], "tasks.ts": [CREATE, "Messages while creating"],
  "views.ts": [TOOLS, "Tool bar"], "clipTools.ts": [TOOLS, "Clip tools"], "auto.ts": [STORY, "Story Maker"], "FastStudio.tsx": [TOOLS, "Player & saving"] };
// the editor's messages, by subject
const SUBJECTS = [
  [/shubix|\bai\b|credit|plan\b|upgrade|chat/i, "Shubix AI & credits"], [/export|sav(e|ing)|download|my reels|share|quality|watermark/i, "Export & saving"],
  [/song|music|beat|sound|audio/i, "Music & beats"], [/voice|narrat|speech|speak/i, "Voice"], [/text|caption|font|word|title/i, "Text & captions"],
  [/clip|photo|video|shot|picture|camera/i, "Clips & photos"],
];
// a name in a picker: a few words, no sentence
const isName = (s) => s.split(/\s+/).length <= 3 && !/[.!?:…]$/.test(s) && !/\b(the|your|a|to|of|is|and|it|this)\b/i.test(s);

let markers = []; // markup.ts: [position, page, section], in order
function placeOf(file, at, text) {
  if (file === "markup.ts") {
    let place = [TOOLS, "Player & saving"];
    for (const [pos, page, section] of markers) { if (pos > at) break; place = [page, section]; }
    return place;
  }
  if (FILES[file]) return FILES[file];
  if (isName(text)) return [NAMES, "Names"];
  for (const [re, section] of SUBJECTS) if (re.test(text)) return [MSG, section];
  return [MSG, "Other"];
}

const found = new Map(); // text -> [page, section]
for (const f of readdirSync(DIR).filter((f) => /\.(ts|tsx)$/.test(f) && !/^(textSwap|i18n)\.ts$/.test(f))) {
  // comments are not on screen: blanked, keeping every position (a text's screen is found by its place)
  const src = readFileSync(join(DIR, f), "utf8")
    .replace(/(^|\s)\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")) // a comment, not "video/*" in an accept list
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "))
    .replace(/([^:"'`])(\/\/[^\n"'`]*)$/gm, (m, a, b) => a + b.replace(/./g, " "));
  if (f === "markup.ts") markers = MARKUP.flatMap(([re, page, section]) => [...src.matchAll(re)].map((m) => [m.index, page, section])).sort((a, b) => a[0] - b[0]);
  const add = (raw, at) => {
    const t = raw.replace(/\s+/g, " ").trim().replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
    if (looksLikeUi(t) && !found.has(t)) found.set(t, placeOf(f, at, t));
  };
  for (const m of src.matchAll(/>([^<>{}`$\n]{3,})</g)) add(m[1], m.index);
  for (const m of src.matchAll(/(?:title|placeholder|aria-label|data-tip)=\\?["']([^"'\\]{3,})\\?["']/g)) add(m[1], m.index);
  for (const m of src.matchAll(/'((?:[^'\\\n]|\\.){3,})'|"((?:[^"\\\n]|\\.){3,})"|`([^`$\\\n]{3,})`/g)) add((m[1] ?? m[2] ?? m[3]).replace(/\\(['"`])/g, "$1"), m.index);
}

// in a section: the titles and buttons, then the lines and messages
const card = (t) => (t.split(/\s+/).length <= 4 && !/[.!?…]$/.test(t) ? "Titles & buttons" : "Lines & messages");
const list = [...found.entries()];
const body = list.map(([t, [page, section]]) => `  [${JSON.stringify("studio." + hash(t))}, ${JSON.stringify(t)}, ${JSON.stringify(page)}, ${JSON.stringify(section)}, ${JSON.stringify(card(t))}],`).join("\n");
writeFileSync(OUT, `// Made by scripts/extract-studio-texts.mjs: every text Fast Studio shows (key, the words, its CMS page, section and
// card). Do not edit by hand.
export const STUDIO_TEXTS: [key: string, text: string, page: string, section: string, card: string][] = [
${body}
];
`);
const pages = {};
for (const [, [p, s]] of list) { pages[p] ??= {}; pages[p][s] = (pages[p][s] ?? 0) + 1; }
console.log(`${list.length} studio texts -> ${OUT}`);
for (const [p, ss] of Object.entries(pages)) console.log(" ", p, JSON.stringify(ss));
