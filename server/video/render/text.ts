import fs from "node:fs";
import path from "node:path";
import { fontFor, needsShaping } from "@/server/core/fonts";
import { fixed, g, round } from "@/server/core/py";
import type { Caption, TextOverlay, Timeline } from "@/server/models/timeline";
import { cleanText, normalize } from "@/server/video/overlays";
import { getTransition } from "./parts";

/** Everything that puts text or names into a render: the effect registry and free-form name resolvers (was
 * video/effects.py), caption cues and their ASS file (captions/cues.py, ass.py), and the animated text overlays
 * (video/overlays.py layout + product/textass.py). Text always goes into a file, never into a filter string. */

// ------------------------------------------------------------------ effects
export const EFFECTS: [string, string, string, string][] = [
  ["none", "none", "No movement", "static, calm, lets the footage speak"], ["zoom_in", "zoom", "Slow push in", "builds attention; hero and reveal shots"],
  ["zoom_out", "zoom", "Slow pull out", "reveals context; endings and payoffs"], ["punch", "zoom", "Punch in on the cut", "a hit on a strong beat or drop"],
  ["punch_out", "zoom", "Punch building to the cut", "tension right before the next cut"],
  ["zoom_pulse", "zoom", "Beat pulse", "a small zoom pulse on every strong hit of the song inside the shot; energetic, beat-driven sections"],
  ["beat_stutter", "zoom", "Stutter punches", "a quick punch on every fast hit inside the shot (a roll or hi-hats into a drop); each hit is seen"],
  ["beat_punch", "zoom", "Punch on every hit", "a clear zoom punch on every strong hit inside the shot; a longer shot in loud, fast music still feels on the beat"],
  ["pan_left", "pan", "Pan left", "smooth travel across a wide or detailed frame"], ["pan_right", "pan", "Pan right", "smooth travel across a wide or detailed frame"],
  ["pan_up", "pan", "Tilt up", "reveal from bottom to top (products, buildings, outfits)"], ["pan_down", "pan", "Tilt down", "reveal from top to bottom"],
  ["ken_burns", "zoom", "Ken Burns", "slow push in with a diagonal drift; elegant, photos and still moments"], ["crash_zoom", "zoom", "Crash zoom", "fast snap in onto the subject; hooks, drops and reveals"],
  ["shake", "motion", "Camera shake", "handheld energy on a hit or drop; use sparingly"], ["roll", "motion", "Roll sway", "a gentle rotation sway; dreamy, fashion, dance"],
  ["flash", "look", "Flash", "a bright white pop at the start of the shot; lands a hard beat"], ["black_white", "look", "Black & white", "a monochrome moment for contrast, memories, drama"],
  ["beat_flash", "look", "Flash on every hit", "a short light pop on every strong hit inside the shot; drops and very energetic parts, use sparingly"],
  ["freeze", "time", "Freeze frame", "holds the first frame for a beat before the shot plays; reveals, hero moments, a dramatic stop on a hit"],
  ["vignette", "look", "Vignette", "darkens the edges to pull the eye to the centre; cinematic, moody, luxury"], ["glow", "look", "Soft glow", "a dreamy bloom on the highlights; beauty, jewellery, golden-hour shots"],
  ["sharpen", "look", "Sharpen", "crisper detail; product close-ups, textures, slightly soft footage"],
];
const EFFECT_NAMES = new Set(EFFECTS.map(([n]) => n));
export const effectCatalogue = () => Object.fromEntries(EFFECTS.map(([n, , , hint]) => [n, hint]));
const EFFECT_ALIASES: Record<string, string> = Object.fromEntries(Object.entries({
  zoom_in: "slow_zoom_in zoom push_in push dolly_in slow_zoom zoom_in_slow scale_up", ken_burns: "kenburns", zoom_out: "slow_zoom_out pull_out pull_back dolly_out scale_down",
  punch: "punch_in impact hit", shake: "camera_shake handheld earthquake", zoom_pulse: "bounce pulse beat_pulse zoom_beat", crash_zoom: "crash snap_zoom whip_zoom fast_zoom",
  roll: "rotate rotation dutch_angle sway spin", flash: "white_flash flash_frame", beat_flash: "strobe flash_on_beat flash_on_hits flash_on_every_hit beat_strobe",
  black_white: "bw b_w black_and_white monochrome grayscale greyscale desaturate noir", beat_punch: "punch_on_beat punch_on_hits punch_on_every_hit beat_zoom",
  pan_right: "pan slide_right track_right truck_right", pan_left: "slide_left track_left truck_left", pan_up: "tilt_up pan_upward", pan_down: "tilt_down pan_downward", none: "static hold still",
}).flatMap(([target, names]) => names.split(" ").map((n) => [n, target])));
EFFECT_ALIASES[""] = "none";
const TRANSITION_ALIASES: Record<string, string> = Object.fromEntries(Object.entries({
  dissolve: "crossfade cross_dissolve cross_fade mix fade_in fade_out fadein fadeout soft_fade", fade: "fade_black fade_to_black dip_to_black fade_through_black", flash: "fade_white white_flash dip_to_white light_leak flash_cut",
  cut: "hard_cut jump_cut match_cut none", zoom: "zoom_in zoom_out zoom_transition punch_in", radial: "spin spin_transition", circle_open: "iris iris_open", slide_left: "whip whip_pan swipe push_left", slide: "slide_up push", wipe_left: "wipe", pixelize: "glitch",
  blur: "blur_transition focus_pull", speed_ramp: "ramp speedramp",
}).flatMap(([target, names]) => names.split(" ").map((n) => [n, target])));
TRANSITION_ALIASES[""] = "cut";
const norm = (name: string) => String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** (registered effect, whether it had to be mapped). Never fails. */
export function resolveEffect(name: string): [string, boolean] {
  const n = norm(name);
  if (EFFECT_NAMES.has(n)) return [n, false];
  if (n in EFFECT_ALIASES) return [EFFECT_ALIASES[n], true];
  const has = (...xs: string[]) => xs.some((x) => n.includes(x));
  if (has("crash", "snap", "fast", "quick") && n.includes("zoom")) return ["crash_zoom", true];
  if (has("zoom", "push", "scale")) return [has("out", "back") ? "zoom_out" : "zoom_in", true];
  for (const d of ["left", "right", "up", "down"]) if (n.includes(d) && has("pan", "tilt", "slide", "track")) return [`pan_${d}`, true];
  if (has("pulse", "beat", "bounce")) return ["zoom_pulse", true];
  if (has("shake", "shaky", "handheld")) return ["shake", true];
  if ((n.includes("black") && n.includes("white")) || has("mono", "gray", "grey")) return ["black_white", true];
  if (has("flash", "strobe")) return ["flash", true];
  if (has("roll", "rotat", "sway")) return ["roll", true];
  if (has("punch", "hit")) return ["punch", true];
  return ["none", true];
}

/** (registered transition, whether it had to be mapped). Unknown -> cut (ensureTransitions in video/transitions.ts then
 * picks a real one for it). */
export function resolveTransition(name: string): [string, boolean] {
  const n = norm(name);
  if (getTransition(n).name === n) return [n, false];
  if (n in TRANSITION_ALIASES) return [TRANSITION_ALIASES[n], true];
  for (const [key, target] of [["dissolve", "dissolve"], ["fade", "fade"], ["flash", "flash"], ["zoom", "zoom"], ["blur", "blur"], ["slide", "slide"], ["wipe", "wipe_left"], ["ramp", "speed_ramp"]]) if (n.includes(key)) return [target, true];
  return ["cut", true];
}

// ------------------------------------------------------------------ caption cues
export interface Word { text: string; start: number; end: number }
export interface Cue { start: number; end: number; words: Word[] }
export const cueText = (c: Cue) => c.words.map((w) => w.text).join(" ");
const MAX_WORDS = 4, MAX_CUE_SECONDS = 2.6, PAUSE_BREAK = 0.6, MIN_WORD_SECONDS = 0.08;

/** Cues of a few words each, clamped to [0, duration] and never overlapping. */
export function groupWords(words: Word[], duration: number, maxWords = MAX_WORDS): Cue[] {
  const clean = [...words].sort((a, b) => a.start - b.start).flatMap((w) => {
    const start = Math.max(w.start, 0), end = Math.min(w.end, duration);
    return start >= duration || end <= 0 ? [] : [{ text: w.text, start, end: Math.max(end, start + MIN_WORD_SECONDS) }];
  });
  const cues: Cue[] = [];
  let cur: Word[] = [];
  for (const w of clean) {
    if (cur.length) {
      const gap = w.start - cur[cur.length - 1].end, tooLong = w.end - cur[0].start > MAX_CUE_SECONDS, ends = /[.!?]$/.test(cur[cur.length - 1].text);
      if (cur.length >= maxWords || gap > PAUSE_BREAK || tooLong || ends) { cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) cues.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
  return cues.map((c, i) => ({ ...c, end: Math.min(Math.max(c.end + 0.25, c.start + 0.4), i + 1 < cues.length ? cues[i + 1].start : duration, duration) }));
}
export const cuesToCaptions = (cues: Cue[]): Caption[] => cues.map((c) => ({ id: Math.random().toString(16).slice(2, 14), start: round(c.start, 3), end: round(c.end, 3), text: cueText(c),
  words: c.words.map((w) => ({ text: w.text, start: round(w.start, 3), end: round(w.end, 3) })) }));
export const captionsToCues = (caps: Caption[]): Cue[] => caps.map((c) => ({ start: c.start, end: c.end, words: c.words.length ? c.words.map((w) => ({ ...w })) : [{ text: c.text, start: c.start, end: c.end }] }));

// ------------------------------------------------------------------ caption ASS
export const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];
interface CaptionStyle { font: string; size: number; primary: string; secondary: string; outlineColour: string; bold: number; outline: number; shadow: number; spacing: number; marginV: number; uppercase: boolean; mode: string; highlight: string; fadeMs: number }
const cs = (font: string, size: number, primary: string, secondary: string, o: Partial<CaptionStyle> = {}): CaptionStyle =>
  ({ font, size, primary, secondary, outlineColour: "&H00000000", bold: 0, outline: 3, shadow: 1, spacing: 0, marginV: 380, uppercase: false, mode: "static", highlight: "&H0000E5FF", fadeMs: 0, ...o });
const STYLES: Record<string, CaptionStyle> = {
  minimal: cs("Arial", 56, "&H00FFFFFF", "&H00FFFFFF", { outline: 3, shadow: 0 }),
  bold: cs("Arial", 92, "&H00FFFFFF", "&H00FFFFFF", { bold: 1, outline: 7, shadow: 2, uppercase: true, marginV: 420 }),
  karaoke: cs("Arial", 84, "&H0000E5FF", "&H00FFFFFF", { bold: 1, outline: 6, shadow: 2, uppercase: true, mode: "karaoke", marginV: 420 }),
  highlight: cs("Arial", 84, "&H00FFFFFF", "&H00FFFFFF", { bold: 1, outline: 6, shadow: 2, uppercase: true, mode: "highlight", marginV: 420 }),
  luxury: cs("Georgia", 54, "&H00B5D9E8", "&H00B5D9E8", { outline: 1, shadow: 0, spacing: 7, uppercase: true, marginV: 440, fadeMs: 350 }),
};
function ts(t: number): string {
  const c = round(Math.max(t, 0) * 100);
  return `${Math.floor(c / 360000)}:${String(Math.floor(c / 6000) % 60).padStart(2, "0")}:${String(Math.floor(c / 100) % 60).padStart(2, "0")}.${String(c % 100).padStart(2, "0")}`;
}
const escapeText = (t: string) => t.replace(/\\/g, "／").replace(/\{/g, "(").replace(/\}/g, ")").replace(/[\r\n]/g, " ");
const assColour = (hex: string) => { const h = hex.replace(/^#/, ""); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };

export function buildAss(cues: Cue[], styleName: string, width = 1080, height = 1920, font: string | null = null, color: string | null = null): string {
  let st = STYLES[styleName] ?? STYLES.minimal;
  if (font) { const safe = font.replace(/[^A-Za-z0-9 \-_.]/g, "").trim().slice(0, 60); if (safe) st = { ...st, font: safe }; }
  if (color) st = { ...st, primary: assColour(color), secondary: st.mode !== "karaoke" ? assColour(color) : st.secondary, highlight: st.mode === "highlight" ? assColour(color) : st.highlight };
  const sample = cues.flatMap((c) => c.words.map((w) => w.text)).join(" ");
  if (needsShaping(sample)) st = { ...st, font: fontFor(sample, st.font), spacing: 0 }; // Hindi/Marathi lyrics or voice-over: a font with the letters, and no spacing (it breaks shaping)
  const word = (t: string) => (st.uppercase ? escapeText(t).toUpperCase() : escapeText(t));
  const side = Math.trunc(width * 0.08);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\n` +
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n" +
    `Style: Default,${st.font},${st.size},${st.primary},${st.secondary},${st.outlineColour},&H64000000,${st.bold},0,0,0,100,100,${g(st.spacing)},0,1,${g(st.outline)},${g(st.shadow)},2,${side},${side},${st.marginV},1\n\n` +
    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
  const fade = st.fadeMs ? `{\\fad(${st.fadeMs},${st.fadeMs})}` : "";
  const ev = (a: number, b: number, t: string) => `Dialogue: 0,${ts(a)},${ts(b)},Default,,0,0,0,,${t}`;
  const lines: string[] = [];
  for (const cue of cues) {
    if (st.mode === "karaoke") {
      lines.push(ev(cue.start, cue.end, fade + cue.words.map((w, i) => `{\\kf${Math.max(round(((i + 1 < cue.words.length ? cue.words[i + 1].start : cue.end) - w.start) * 100), 1)}}${word(w.text)}`).join(" ")));
    } else if (st.mode === "highlight") {
      cue.words.forEach((w, i) => {
        const end = i + 1 < cue.words.length ? cue.words[i + 1].start : cue.end;
        lines.push(ev(i === 0 ? cue.start : w.start, end, cue.words.map((x, j) => (j === i ? `{\\c${st.highlight}}${word(x.text)}{\\c${st.primary}}` : word(x.text))).join(" ")));
      });
    } else lines.push(ev(cue.start, cue.end, fade + cue.words.map((w) => word(w.text)).join(" ")));
  }
  return header + lines.join("\n") + "\n";
}

export function writeAss(cues: Cue[], styleName: string, file: string, width = 1080, height = 1920, font: string | null = null, color: string | null = null): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buildAss(cues, styleName, width, height, font, color), "utf8");
  return file;
}
/** The filter that burns a subtitle file in (path escaped for filtergraph syntax). */
export const assFilter = (file: string) => `ass=filename='${path.resolve(file).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'")}'`;

// ------------------------------------------------------------------ text overlays (video/overlays.py + product/textass.py)
export const SAFE_TOP = 0.14, SAFE_BOTTOM = 0.22;
const MAX_WIDTH = 0.8, CHAR_WIDTH = 0.55;
const SIZES: Record<string, number> = { small: 0.034, medium: 0.044, large: 0.056 };
const Y: Record<string, number> = { top: 0.21, center: 0.44, bottom: 0.7 };
const Y_BOTTOM_WITH_CAPTIONS = 0.6;
export interface TextLayer { id: string; text: string; start: number; end: number; x: number; y: number; size: number; animationIn: string; animationOut: string; role: string }
export interface TextLook { font: string; textColor: string; textOutline: string; bold: boolean }

export function lookFor(tl: Timeline): TextLook {
  const luxury = tl.style === "luxury" || tl.colorGrade === "luxury" || tl.captionStyle === "luxury";
  const base: TextLook = luxury ? { font: "Georgia", textColor: "#F6E7C8", textOutline: "#000000", bold: false } : { font: "Arial", textColor: "#FFFFFF", textOutline: "#000000", bold: true };
  return { ...base, font: tl.captionFont || base.font, textColor: tl.captionColor && /^#[0-9A-Fa-f]{6}$/.test(tl.captionColor) ? tl.captionColor : base.textColor };
}
const fitSize = (text: string, requested: number, w: number, h: number) => round(Math.min(requested, (MAX_WIDTH * w) / (Math.max(text.length, 1) * CHAR_WIDTH) / h), 4);

const WRAP_AT = 22; // characters: a longer text is set on two or three balanced lines
/** One line when it fits, else 2-3 lines of about equal length, split between words: a long text on one line would be
 * shrunk until it fits the width; on several lines it stays big enough to read on a phone. */
export function wrapLines(text: string, maxLine = WRAP_AT, maxLines = 3): string[] {
  const words = text.split(" ").filter(Boolean), n = Math.min(Math.max(Math.ceil(text.length / maxLine), 1), maxLines, words.length);
  if (n <= 1) return [text];
  let best: string[] = [text];
  const longest = (ls: string[]) => Math.max(...ls.map((l) => l.length));
  const tryCuts = (cuts: number[]) => {
    const edges = [0, ...cuts, words.length], lines = edges.slice(1).map((b, i) => words.slice(edges[i], b).join(" "));
    if (best.length === 1 || longest(lines) < longest(best)) best = lines;
  };
  for (let a = 1; a < words.length; a++) {
    if (n === 2) tryCuts([a]);
    else for (let b = a + 1; b < words.length; b++) tryCuts([a, b]);
  }
  return best;
}
export const toLayers = (overlays: TextOverlay[], hasCaptions: boolean, w: number, h: number): TextLayer[] => overlays.map((o) => {
  const lines = wrapLines(o.text), size = fitSize(lines.reduce((m, l) => (l.length > m.length ? l : m), ""), SIZES[o.size], w, h);
  const half = size * (0.75 + 0.6 * (lines.length - 1)); // half the text block's height (see textBox)
  const y0 = o.position === "bottom" && hasCaptions ? Y_BOTTOM_WITH_CAPTIONS : Y[o.position];
  const y = Math.min(Math.max(y0, SAFE_TOP + half), (hasCaptions ? Y_BOTTOM_WITH_CAPTIONS + 0.1 : 1 - SAFE_BOTTOM) - half); // more lines: keep the block inside
  return { id: o.id, text: lines.join("\n"), start: o.start, end: o.end, x: 0.5, y, size, animationIn: o.animation, animationOut: "fade", role: o.role === "cta" ? "cta" : o.role === "hook" ? "hook" : "tagline" };
});
/** (left, top, right, bottom) fractions of the frame the text covers. */
export function textBox(l: TextLayer, w: number, h: number): [number, number, number, number] {
  const lines = l.text.split("\n"), halfW = (Math.max(...lines.map((x) => x.length)) * CHAR_WIDTH * l.size * h) / w / 2, halfH = l.size * (0.75 + 0.6 * (lines.length - 1));
  return [l.x - halfW, l.y - halfH, l.x + halfW, l.y + halfH];
}

const bgr = (hex: string) => { let h = hex.replace(/^#/, ""); if (!/^[0-9A-Fa-f]{6}$/.test(h)) h = "FFFFFF"; return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`; };
const INDIC = /[\u0900-\u0DFF]/;

const LINE_BREAK = "\\N"; // an ASS hard line break
const BOX_COLOUR = "&H50000000&"; // the box behind boxed text: black, about 70% opaque
export function layerEvents(t: TextLayer, w: number, h: number): [number, number, string][] {
  const text = t.text.split("\n").map((x) => cleanText(x)).filter(Boolean).join(LINE_BREAK); // a newline becomes a real line break
  if (!text) return [];
  const x = t.x * w, y = t.y * h, size = t.size * h, fadeOut = t.animationOut === "fade" ? 250 : 0, dur = t.end - t.start;
  const pos = `\\an5\\pos(${fixed(x, 0)},${fixed(y, 0)})\\fs${fixed(size, 0)}`, outTag = fadeOut ? `\\fad(0,${fadeOut})` : "";
  // typing letter by letter would split joined letters (or a line break) in half
  const anim = t.animationIn === "type_on" && (needsShaping(text) || text.includes(LINE_BREAK)) ? "fade" : t.animationIn;
  switch (anim) {
    case "fade": return [[t.start, t.end, `{${pos}\\fad(350,${fadeOut})}${text}`]];
    case "slide_up": return [[t.start, t.end, `{\\an5\\fs${fixed(size, 0)}\\move(${fixed(x, 0)},${fixed(y + 0.03 * h, 0)},${fixed(x, 0)},${fixed(y, 0)},0,380)\\fad(300,${fadeOut})}${text}`]];
    case "scale": return [[t.start, t.end, `{${pos}\\fscx72\\fscy72\\t(0,320,\\fscx100\\fscy100)\\fad(200,${fadeOut})}${text}`]];
    case "blur_sharp": return [[t.start, t.end, `{${pos}\\blur14\\alpha&HFF&\\t(0,520,\\blur0\\alpha&H00&)${outTag}}${text}`]];
    case "mask_reveal": {
      const bw = Math.max(Math.max(...text.split(LINE_BREAK).map((x) => x.length)), 3) * size * 0.62 * 1.15, x0 = fixed(x - bw / 2, 0), x1 = fixed(x + bw / 2, 0), y0 = fixed(y - size, 0), y1 = fixed(y + size, 0);
      return [[t.start, t.end, `{${pos}\\clip(${x0},${y0},${x0},${y1})\\t(0,520,\\clip(${x0},${y0},${x1},${y1}))${outTag}}${text}`]];
    }
  }
  const n = text.length, steps = Math.min(n, 24), total = Math.min(0.7, Math.max(dur * 0.4, 0.3));
  return Array.from({ length: steps }, (_, i) => {
    const s = i + 1, k = round((n * s) / steps);
    return [t.start + (total * (s - 1)) / steps, s < steps ? t.start + (total * s) / steps : t.end, `{${pos}${s === steps ? outTag : ""}}${text.slice(0, k)}{\\alpha&HFF&}${text.slice(k)}`] as [number, number, string];
  });
}

/** The animated text file, or null when there is no text. boxed: the text sits on a soft dark box, readable over busy
 * video. Text in a complex script (Marathi, Hindi ...) gets a font that has its letters and no letter spacing. */
export function writeTextAss(layers: TextLayer[], look: TextLook, file: string, w: number, h: number, boxed = false): string | null {
  const font = look.font.replace(/[^A-Za-z0-9 \-_.]/g, "").slice(0, 40) || "Arial";
  const events = layers.flatMap((l) => {
    const tags = needsShaping(l.text) ? `\\fn${fontFor(l.text, font).replace(/[^A-Za-z0-9 \-_.]/g, "")}\\fsp0` : "";
    return layerEvents(l, w, h).map(([a, b, body]) => [a, b, body.startsWith("{") ? `{${tags}${body.slice(1)}` : `{${tags}}${body}`] as [number, number, string]);
  });
  if (!events.length) return null;
  const spacing = layers.some((l) => INDIC.test(l.text)) ? "0" : "1.5";
  const look2 = boxed ? `0,3,${Math.max(8, Math.floor(h / 110))},0` : `0,1,${Math.max(2, Math.floor(h / 640))},${Math.max(1, Math.floor(h / 960))}`; // BorderStyle 3: an opaque box padded by Outline
  const lines = ["[Script Info]", "ScriptType: v4.00+", `PlayResX: ${w}`, `PlayResY: ${h}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${font},${Math.trunc(0.065 * h)},${bgr(look.textColor)},${bgr(look.textColor)},${boxed ? BOX_COLOUR : bgr(look.textOutline)},&H64000000&,${look.bold ? -1 : 0},0,0,0,100,100,${spacing},${look2},5,20,20,20,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events.map((e, i) => [e, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map(([[a, b, body]]) => `Dialogue: 0,${ts(a)},${ts(b)},Default,,0,0,0,,${body}`)];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return file;
}

export function writeOverlaysAss(tl: Timeline, file: string, w: number, h: number): string | null {
  const [overlays] = normalize(tl.overlays, tl.duration);
  return overlays.length ? writeTextAss(toLayers(overlays, tl.captions.length > 0, w, h), lookFor(tl), file, w, h, true) : null;
}
