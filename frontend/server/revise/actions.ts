import "server-only";
import { z } from "zod";
import type { ManagedProvider } from "@/server/ai";
import { AppError } from "@/server/core/errors";
import { CropSpec, EFFECT_TYPES, GRADES, TextOverlay, TRANSITION_TYPES, type Timeline } from "@/server/models/timeline";
import { MAX_DURATION, MIN_DURATION } from "@/server/projects/settings";
import { listStyles } from "@/server/styles";
import { MAX_SPEED, MIN_SPEED, type Operation } from "@/server/timeline/ops";
import { tidyText } from "@/server/video/overlays";

/** From words to edits (was revise/actions.py): a phrase parser, plus the AI for what it did not understand; edit
 * actions become ordinary timeline operations, rebuild actions become settings for a fresh edit. */

export const REBUILD_KINDS = new Set(["style", "pace", "reshuffle", "captions_on"]);
export const GLOBAL_KINDS = new Set(["speed", "effect", "transition", "music_volume", "music_fade", "caption_style", "framing", "watermark_off", "mute_music", "grade", "text_off", "text_less", "cta", "hook_text"]);
export const DIRECTOR_KINDS = new Set(["replace_hook", "drop_reveal", "product_earlier"]);
const KINDS = new Set([...REBUILD_KINDS, ...GLOBAL_KINDS, ...DIRECTOR_KINDS, "delete", "move", "duration", "captions_off", "voice_off", "voice_volume"]);
export const DESTRUCTIVE_KINDS = new Set(["delete", "text_off", "captions_off", "voice_off", "mute_music"]);
const GRADE_WORDS: [string, string][] = [
  [String.raw`\bwarm(?:er)?\b|\bgolden\b|\bcosy\b|\bcozy\b`, "warm"], [String.raw`\bcinematic (?:colou?rs?|grade|look)\b|\bteal\b|\bfilm(?:ic)? (?:colou?rs?|look)\b`, "cinematic"],
  [String.raw`\bluxur(?:y|ious) (?:colou?rs?|grade|look)\b|\bpremium (?:colou?rs?|grade)\b`, "luxury"], [String.raw`\bclean(?:er)? (?:colou?rs?|look)\b|\bbright(?:er)?\b`, "clean"],
  [String.raw`\b(?:more )?contrast\b|\bpunchy colou?rs?\b|\bvivid\b|\bvibrant\b`, "high_contrast"], [String.raw`\bsoft(?:er)? (?:colou?rs?|look)\b|\bpastel\b`, "soft"],
  [String.raw`\bnatural (?:colou?rs?|look)\b|\bno (?:colou?r )?grad(?:e|ing)\b`, "natural"],
];
const STYLE_WORDS: Record<string, string[]> = { fast_trending: ["fast trending", "trending", "viral"], cinematic: ["cinematic", "filmic", "movie"], luxury: ["luxury", "premium", "elegant", "classy"],
  food: ["food", "foodie"], travel: ["travel", "adventure"], minimal: ["minimal", "clean", "simple"], storytelling: ["storytelling", "story"] };
const CAPTION_STYLES = ["minimal", "bold", "karaoke", "highlight", "luxury"];
export const EXAMPLES = ["make it calmer with longer shots", "faster cuts, more energy", "remove the first clip", "make it 20 seconds", "add captions", "smoother transitions", "louder music",
  "use the luxury style", "show a different order", "make the first 3 seconds stronger", "use the drop for the product reveal", "show the product earlier"];

export interface Action { kind: string; scope: string; shot: number | null; value: unknown; factor: number | null; delta: number | null; to: string | number | null; text: string; source: string }
export const act = (kind: string, o: Partial<Action> = {}): Action => ({ kind, scope: "all", shot: null, value: null, factor: null, delta: null, to: null, text: "", source: "rules", ...o });
export const isRebuild = (a: Action) => REBUILD_KINDS.has(a.kind);
export interface Plan { actions: Action[]; notUnderstood: string[]; usedAi: boolean; aiNote: string | null }

const has = (c: string, p: string) => new RegExp(p).test(c);
const ORD: Record<string, number> = { first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6, seventh: 7, "7th": 7, eighth: 8, "8th": 8 };
const NOUN = "(?:shot|clip|scene|part|video|footage)";
const REF = new RegExp(String.raw`\b(?:(?<ord>${Object.keys(ORD).join("|")}|last|final|opening|ending)\s+(?:${NOUN})s?|(?:${NOUN})\s*(?:no\.?\s*|number\s*|#)?(?<num>\d{1,2})|#(?<hash>\d{1,2}))\b`);
function shotRef(c: string): [string, number | null] | null {
  const m = REF.exec(c);
  if (!m) return null;
  const g = m.groups ?? {};
  if (g.num || g.hash) return ["shot", Number(g.num || g.hash)];
  if (["last", "final", "ending"].includes(g.ord)) return ["last", null];
  if (g.ord === "opening") return ["first", null];
  return ["shot", ORD[g.ord]];
}
function scope(c: string): Partial<Action> {
  const r = shotRef(c);
  if (!r) return { scope: "all", shot: null };
  if (r[0] === "shot" && r[1] === 1) return { scope: "first", shot: null };
  return { scope: r[0], shot: r[1] };
}
const CAPTION = "(?:caption|subtitle|lyrics? text)s?";
const NEG = "(?:remove|delete|no|without|hide|turn off|disable|drop|get rid of|don'?t (?:want|need|show|add))";
const POS = "(?:add|turn on|enable|show|with|include|need|want|put|use|give me|generate)";
type Rule = (c: string) => Action[] | null;
const rWatermark: Rule = (c) => (has(c, String.raw`${NEG}\b.*\b(?:watermark|logo)`) || has(c, String.raw`\b(?:watermark|logo)\b.*\b(?:off|away|remove)`) ? [act("watermark_off")] : null);
const rVoice: Rule = (c) => {
  if (!has(c, String.raw`\b(?:voice|voice-?over|voiceover|narration|narrator)\b`)) return null;
  if (has(c, `${NEG}|mute|silence`)) return [act("voice_off")];
  if (has(c, String.raw`\b(?:louder|higher|increase|up|clearer|stronger|boost)\b`)) return [act("voice_volume", { delta: 0.25 })];
  if (has(c, String.raw`\b(?:quieter|lower|softer|reduce|decrease|down|less)\b`)) return [act("voice_volume", { delta: -0.25 })];
  return null;
};
const rCaptions: Rule = (c) => {
  if (!has(c, CAPTION)) return null;
  if (has(c, String.raw`${NEG}\b.*${CAPTION}`)) return [act("captions_off")];
  for (const st of CAPTION_STYLES) if (has(c, String.raw`\b${st}\b`)) return [act("caption_style", { value: st })];
  if (has(c, String.raw`${POS}\b.*${CAPTION}`) || has(c, String.raw`${CAPTION}\b.*\b(?:on|please)\b`) || has(c, `^${CAPTION}$`)) return [act("captions_on")];
  return null;
};
const rMusic: Rule = (c) => {
  const music = String.raw`\b(?:music|song|track|audio|background|bgm|beat)\b`;
  if (has(c, String.raw`\bfade\b`) && has(c, music + String.raw`|\bout\b|\bending\b`)) return [act("music_fade", { value: 2.0 })];
  if (!has(c, music)) return null;
  if (has(c, String.raw`\b(?:mute|silence)\b|${NEG}\b.*${music}|\bno music\b`)) return [act("mute_music")];
  if (has(c, String.raw`\b(?:louder|increase|higher|up|more|boost|stronger|raise)\b`)) return [act("music_volume", { delta: 0.2 })];
  if (has(c, String.raw`\b(?:quieter|lower|softer|reduce|decrease|down|less|reduce|tone down|turn down)\b`)) return [act("music_volume", { delta: -0.25 })];
  return null;
};
const NUM_SEC = /(\d{1,3}(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/;
const rDuration: Rule = (c) => {
  const m = NUM_SEC.exec(c);
  if (m && has(c, String.raw`\b(?:make|keep|reduce|trim|length|duration|cut|shorten|extend|lengthen|total|only|around|about|exactly|be|should|bring)\b`)) return [act("duration", { value: Number(m[1]) })];
  if (m && has(c, String.raw`\b(?:long|longer|shorter)\b`)) return [act("duration", { value: Number(m[1]) })];
  const part = shotRef(c) !== null || has(c, String.raw`\b(?:ending|end|intro|opening|start|beginning|middle|part|section|shot|clip|scene)\b`), whole = "(?:reel|video|it|overall|whole thing|everything)";
  if (!part && (has(c, String.raw`\b(?:shorter (?:reel|video|overall)|shorten (?:it|the reel|the video)|make it shorter|reduce (?:the )?length)\b`) || has(c, String.raw`\b${whole}\b.*\btoo long\b|^too long$`))) return [act("duration", { factor: 0.75 })];
  if (!part && (has(c, String.raw`\b(?:longer (?:reel|video|overall)|make it longer|extend (?:it|the reel|the video)|lengthen)\b`) || has(c, String.raw`\b${whole}\b.*\btoo short\b|^too short$`))) return [act("duration", { factor: 1.3 })];
  return null;
};
const rFraming: Rule = (c) => {
  if (has(c, String.raw`\b(?:fill the (?:screen|frame)|full[- ]?screen|crop to fill|no (?:blur|blurred|black bars|bars)|remove (?:the )?(?:blur|blurred|bars)|zoom to fill|fill)\b`)) return [act("framing", { value: "fill" })];
  if (has(c, String.raw`\b(?:whole|entire|full) (?:picture|frame|video|image)\b|\b(?:don'?t|do not|no) crop|\bno cropping\b|\bfit (?:the )?(?:whole|video|frame|screen)\b`)) return [act("framing", { value: "fit" })];
  return null;
};
const rGrade: Rule = (c) => {
  if (!has(c, String.raw`\bcolou?rs?\b|\bgrad(?:e|ing)\b|\blook\b|\btones?\b|\bwarm|\bcontrast\b|\bvivid\b|\bvibrant\b|\bbright|\bpastel\b|\bteal\b`)) return null;
  for (const [p, g] of GRADE_WORDS) if (has(c, p)) return [act("grade", { value: g })];
  return null;
};
const TEXT = "(?:text|texts|titles?|words on screen|on-?screen text|overlays?|writing)";
const CTA_RE = new RegExp(String.raw`\b(?:cta|call to action)\b[^a-z0-9]*(?:to|:|=|says?|reads?|with)?\s*["']?(?<t>[^"']{2,60})["']?$`);
const HOOK_RE = new RegExp(String.raw`\bhook(?: text)?\b[^a-z0-9]*(?:to|:|=|says?|reads?)\s*["']?(?<t>[^"']{2,60})["']?$`);
const rText: Rule = (c) => {
  let m = CTA_RE.exec(c);
  if (m && has(c, String.raw`\b(?:change|set|make|use|update|replace|cta|call to action)\b`) && !["", "the", "it"].includes(m.groups!.t.trim())) return [act("cta", { value: m.groups!.t.trim().replace(/^\.+|\.+$/g, "").slice(0, 42) })];
  m = HOOK_RE.exec(c);
  if (m) return [act("hook_text", { value: m.groups!.t.trim().replace(/^\.+|\.+$/g, "").slice(0, 42) })];
  if (!has(c, String.raw`\b${TEXT}\b`)) return null;
  if (has(c, String.raw`${NEG}\b.*\b${TEXT}\b|\bno ${TEXT}\b|\b${TEXT}\b.*\b(?:off|away)\b`)) return [act("text_off")];
  if (has(c, String.raw`\b(?:less|fewer|reduce|minimal|too much|too many|cleaner)\b.*\b${TEXT}\b|\b${TEXT}\b.*\b(?:less|fewer|too much)\b`)) return [act("text_less")];
  return null;
};
const TRANSITION_WORDS: [string, string][] = [
  [String.raw`\b(?:no|without|hard|straight|plain|simple) (?:transitions?|cuts?)\b|\bcut only\b|\b(?:remove|drop|fewer|less|unnecessary|extra|too many) (?:\w+ )?transitions?\b`, "cut"],
  [String.raw`\bspeed[- ]?ramp\b`, "speed_ramp"], [String.raw`\b(?:dissolve|crossfade|cross[- ]fade|smooth(?:er)?|softer|gentle|gentler)\b`, "dissolve"],
  [String.raw`\bfade\b`, "fade"], [String.raw`\bslide\b`, "slide"], [String.raw`\bblur\b`, "blur"], [String.raw`\bflash\b`, "flash"], [String.raw`\bzoom\b`, "zoom"],
];
const rTransition: Rule = (c) => {
  if (!has(c, String.raw`\btransitions?\b|\bhard cuts?\b|\bstraight cuts?\b|\bcut only\b`)) return null;
  for (const [p, name] of TRANSITION_WORDS) if (has(c, p)) return [act("transition", { value: name, ...scope(c) })];
  return null;
};
const rEffect: Rule = (c) => {
  const e = (value: string) => [act("effect", { value, ...scope(c) })], trans = has(c, String.raw`\btransition`);
  if (has(c, String.raw`\b(?:no|without|remove|drop|less|fewer|turn off) (?:the )?(?:\w+ )?effects?\b`) || has(c, String.raw`\bplain shots?\b`)) return e("none");
  for (const [p, name] of [[String.raw`\bken[- ]?burns\b`, "ken_burns"], [String.raw`\b(?:crash|snap|fast|quick)[- ]?zoom\b`, "crash_zoom"], [String.raw`\b(?:camera )?shak(?:e|y|ing)\b|\bhandheld\b`, "shake"],
    [String.raw`\b(?:roll|rotat\w*|sway|dutch angle)\b`, "roll"], [String.raw`\bblack (?:and|&) white\b|\bb ?& ?w\b|\bmonochrome\b|\bgr[ae]yscale\b`, "black_white"],
    [String.raw`\bflash(?:es)? (?:effect|on (?:the )?(?:beat|cuts?))\b|\bwhite flash\b`, "flash"]]) if (has(c, p) && !trans) return e(name);
  if (has(c, String.raw`\bzoom[- ]?out\b`)) return e("zoom_out");
  if (has(c, String.raw`\bpunch(?:[- ]?in)?\b`)) return e("punch");
  if (has(c, String.raw`\bzoom(?:[- ]?in| effect|s)?\b|\bpush[- ]?in\b|\bslow zoom\b`) && !trans) return e("zoom_in");
  if (has(c, String.raw`\b(?:tilt|pan)[- ]?up\b`)) return e("pan_up");
  if (has(c, String.raw`\b(?:tilt|pan)[- ]?down\b`)) return e("pan_down");
  if (has(c, String.raw`\bpan(?:s|ning)?\b|\bslider\b|\bcamera (?:movement|moves|motion)\b`) && !trans) return e("pan");
  return null;
};
const rDelete: Rule = (c) => (has(c, String.raw`\b(?:remove|delete|drop|cut out|get rid of|skip|take out|without|discard)\b`) && shotRef(c) ? [act("delete", scope(c))] : null);
const rMove: Rule = (c) => {
  if (!has(c, String.raw`\b(?:move|put|place|swap|bring|send)\b`) || !shotRef(c)) return null;
  let to: string | number | null = null;
  if (has(c, String.raw`\b(?:start|beginning|front|top|first|opening|open)\b`) && !has(c, String.raw`^\s*(?:put|move)\s+(?:the\s+)?first`)) to = "start";
  else if (has(c, String.raw`\b(?:end|back|last|final|ending|close)\b`) && !has(c, String.raw`^\s*(?:put|move)\s+(?:the\s+)?last`)) to = "end";
  const m = /\b(?:to|at|in) (?:position|place|spot|#)?\s*(\d{1,2})\b/.exec(c);
  if (m) to = Number(m[1]);
  if (to === null && has(c, String.raw`^\s*(?:put|move|bring)\s+(?:the\s+)?last\b.*\b(?:first|start|beginning)\b`)) to = "start";
  return to === null ? null : [act("move", { ...scope(c), to })];
};
const PACE_CALM = String.raw`\b(?:longer (?:shots?|clips?|takes?)|fewer cuts|less cuts|not so many cuts|calm(?:er)?|relax(?:ed|ing)?|smooth(?:er)? (?:pace|edit|cuts?)|slow(?:er)? (?:cuts?|pace|pacing|edit|rhythm|tempo)|too (?:fast|quick|busy|rushed|choppy|many cuts)|less busy|breathe|more room)\b`;
const PACE_FAST = String.raw`\b(?:more cuts|cuts? (?:faster|quicker)|faster (?:cuts?|pace|pacing|edit|rhythm)|shorter (?:shots?|clips?)|quick(?:er)? cuts?|every beat|more energ(?:y|etic)|energetic|punchy|dynamic|snappy|snappier|upbeat|too slow|boring|more exciting|hype|lively)\b`;
const rPace: Rule = (c) => {
  const bare = "^(?:please |can you |make it |a bit |a little |bit |much |little |just |it is |it's |its |too )*";
  if (has(c, bare + String.raw`(?:slower|slow|slow down|calmer|smoother)\s*(?:please|a bit|a little)?$`)) return [act("pace", { value: "calm" })];
  if (has(c, bare + String.raw`(?:faster|quicker|speed up|snappier|livelier)\s*(?:please|a bit|a little)?$`)) return [act("pace", { value: "fast" })];
  if (has(c, PACE_CALM)) return [act("pace", { value: "calm" })];
  if (has(c, PACE_FAST)) return [act("pace", { value: "fast" })];
  if (has(c, String.raw`\b(?:balanced|normal|default|medium) (?:pace|pacing|cuts)\b`)) return [act("pace", { value: "balanced" })];
  return null;
};
const rSpeed: Rule = (c) => {
  const tgt = "(?:playback|footage|video|videos|clips?|shots?|motion|speed)", s = scope(c);
  if (has(c, String.raw`\bslow[- ]?(?:mo|motion)\b|\bhalf[- ]speed\b`)) return [act("speed", { value: 0.5, ...s })];
  if (has(c, String.raw`\b(?:double|2x|twice) (?:the )?speed\b`)) return [act("speed", { value: 2.0, ...s })];
  if (has(c, String.raw`\b(?:normal|real|regular|original)[- ](?:speed|time)\b|\breset (?:the )?speed\b`)) return [act("speed", { value: 1.0, ...s })];
  if (has(c, String.raw`\b(?:slow down|slower|slow)\b.*\b${tgt}\b`) || has(c, String.raw`\b${tgt}\b.*\b(?:slower|slow down)\b`)) return [act("speed", { factor: 0.75, ...s })];
  if (has(c, String.raw`\b(?:speed up|faster|quicker)\b.*\b${tgt}\b`) || has(c, String.raw`\b${tgt}\b.*\b(?:faster|speed up)\b`) || has(c, String.raw`\btime[- ]?lapse\b`)) return [act("speed", { factor: 1.5, ...s })];
  return null;
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const rStyle: Rule = (c) => {
  if (!has(c, String.raw`\b(?:style|look|feel|vibe|mode|mood|theme|make it|more|change|switch|convert|turn|use|go|try|want)\b`)) return null;
  for (const [sid, words] of Object.entries(STYLE_WORDS)) for (const w of words) if (has(c, String.raw`\b${esc(w)}\b`)) return [act("style", { value: sid })];
  return null;
};
const rReshuffle: Rule = (c) => (has(c, String.raw`\b(?:different|other|new|another) (?:clips?|order|shots?|edit|version|selection|arrangement|take|cut|sequence)\b|\bre-?shuffle\b|\bshuffle\b|\bmix (?:it )?up\b|\btry again\b|\bsurprise me\b|\bregenerate\b|\bredo (?:it|the edit)\b`) ? [act("reshuffle")] : null);
/** The creative requests the Director carries out on the current edit (was director_patch.parse_director). */
const rDirector: Rule = (c) => {
  if ((has(c, String.raw`\b(?:change|replace|swap|new|different|better|stronger|improve)\b.*\b(?:hook|opening|intro|start)\b(?!\s*text)`) ||
    has(c, String.raw`\b(?:first|opening)\s+(?:\d|one|two|three|few)?\s*(?:seconds?|secs?|moments?|shot)\b.*\b(?:stronger|better|punchier|more (?:engaging|exciting))\b`) ||
    has(c, String.raw`\b(?:hook|opening|intro|start)\b.*\b(?:stronger|better|punchier|weak|boring)\b`)) && !has(c, String.raw`\bhook text\b|\bhook\s*(?::|=|says?|reads?|to\s*["'])`)) return [act("replace_hook", { scope: "first" })];
  if (has(c, String.raw`\bdrop\b`) && has(c, String.raw`\b(?:reveal|best|hero|strongest|product|highlight)\b`)) return [act("drop_reveal")];
  if (has(c, String.raw`\b(?:product|item|it|ring|dress|dish|bag|shoe|watch)\b.*\b(?:earlier|sooner|first|at the start|right away|upfront)\b`) && has(c, String.raw`\b(?:show|reveal|bring|see|put)\b`)) return [act("product_earlier")];
  return null;
};
const RULES: Rule[] = [rDirector, rWatermark, rVoice, rCaptions, rText, rMusic, rDuration, rFraming, rGrade, rTransition, rEffect, rDelete, rMove, rPace, rSpeed, rStyle, rReshuffle];
const SPLIT = /[.;!\n]+|,|\bplus\b|\balso\b|\bthen\b|\band\b|\bbut\b|\bafter that\b|\bmake sure\b|\bplease\b|\bwith\b|&/i;
const clauses = (text: string) => text.toLowerCase().replace(/\bblack\s*(?:and|&)\s*white\b/g, "monochrome").split(SPLIT).map((p) => p.replace(/^[ \-–—:]+|[ \-–—:]+$/g, "")).filter((p) => p.length > 1);

export function parseRules(text: string): [Action[], string[]] {
  const actions: Action[] = [], unknown: string[] = [];
  for (const clause of clauses(text)) {
    let found: Action[] | null = null;
    for (const rule of RULES) if ((found = rule(clause))) break;
    if (found) { for (const a of found) a.text = clause; actions.push(...found); } else unknown.push(clause);
  }
  for (const a of actions) if ((a.kind === "cta" || a.kind === "hook_text") && typeof a.value === "string") { const at = text.toLowerCase().indexOf(a.value.toLowerCase()); if (at >= 0) a.value = text.slice(at, at + a.value.length); }
  const seen = new Set<string>(), unique: Action[] = [];
  for (const a of actions) {
    const key = JSON.stringify([a.kind, isRebuild(a) ? a.value : null, a.scope, a.shot]);
    if (isRebuild(a) && seen.has(key)) continue;
    seen.add(key); unique.push(a);
  }
  return [unique, unknown];
}

const SYSTEM = "You translate a video editor's change request into a JSON list of actions. Reply with JSON only. You never write code. Use ONLY these actions and fields:\n" +
  '{"action":"speed","scope":"all|first|last|shot","shot":2,"factor":0.75}   (factor <1 slows, >1 speeds up)\n{"action":"delete","scope":"first|last|shot","shot":2}\n' +
  '{"action":"move","scope":"first|last|shot","shot":2,"to":"start|end|3"}\n{"action":"effect","scope":"all|first|last|shot","shot":2,"value":"none|zoom_in|zoom_out|punch"}\n' +
  '{"action":"transition","scope":"all|first|last|shot","shot":2,"value":"cut|fade|dissolve|zoom|slide|blur|flash|speed_ramp"}\n{"action":"music_volume","factor":1.3}   {"action":"mute_music"}   {"action":"music_fade","value":2}\n' +
  '{"action":"duration","value":20}   (seconds)\n{"action":"captions_on"}   {"action":"captions_off"}   {"action":"caption_style","value":"minimal|bold|karaoke|highlight|luxury"}\n' +
  '{"action":"framing","value":"fit|fill"}   {"action":"watermark_off"}   {"action":"voice_off"}   {"action":"voice_volume","factor":1.2}\n{"action":"pace","value":"calm|balanced|fast"}   {"action":"style","value":"<style id>"}   {"action":"reshuffle"}\n' +
  'Answer as {"actions":[...],"unclear":"<the part you could not map, or an empty string>"}. Shots are numbered from 1. Return ONLY actions the request clearly asks for, usually one or two. Never add actions that were not requested. ' +
  "If a request is vague or cannot be expressed with these actions, return an empty actions list and put it in unclear.";
function systemPrompt() {
  const featured = ["cut", "fade", "dissolve", "zoom", "slide", "blur", "flash", "speed_ramp", "wipe_left", "circle_open"].filter((t) => TRANSITION_TYPES.includes(t));
  return SYSTEM.replace("none|zoom_in|zoom_out|punch", EFFECT_TYPES.join("|")).replace("cut|fade|dissolve|zoom|slide|blur|flash|speed_ramp", featured.join("|")).replace('Answer as {"actions"',
    `{"action":"grade","value":"${GRADES.join("|")}"}   {"action":"text_off"}   {"action":"text_less"}\n{"action":"cta","value":"<new call to action, max 6 words>"}   {"action":"hook_text","value":"<opening text, max 6 words>"}\nShots may carry "shows": what the clip shows. Use it to find a shot the user describes (e.g. "the product"). Answer as {"actions"`);
}
const num = (v: unknown, lo: number, hi: number) => { const f = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isNaN(f) ? null : Math.min(Math.max(f, lo), hi); };
const REMOVAL = String.raw`\b(?:remove|delete|drop|cut out|cut|skip|get rid of|take out|without|discard|trim out)\b`, FIRST = String.raw`\b(?:first|opening|intro|start|beginning|1st)\b`, LAST = String.raw`\b(?:last|end|ending|final|outro|closing|finish)\b`;
function grounded(kind: string, sc: string, shot: number | null, text: string): string | null {
  const t = text.toLowerCase();
  if (sc === "shot" && shot !== null) {
    const words = Object.entries(ORD).filter(([, n]) => n === shot).map(([w]) => w);
    if (!(new RegExp(String.raw`(?<!\d)${shot}(?!\d)`).test(t) || words.some((w) => has(t, String.raw`\b${w}\b`)))) return `the AI picked shot ${shot}, which you did not mention`;
  } else if (sc === "first" && !has(t, FIRST)) return "the AI picked the first shot, which you did not mention";
  else if (sc === "last" && !has(t, LAST)) return "the AI picked the last shot, which you did not mention";
  if (kind === "delete" && !has(t, REMOVAL)) return "the AI wanted to remove a shot, but you did not ask for that";
  return null;
}
/** Strictly validate the model's answer; anything unknown, out of range or not in the person's own words is dropped. */
export function parseAiActions(data: Record<string, unknown>, shots: number, styleIds: Set<string>, requestText: string | null = null): [Action[], string[]] {
  const out: Action[] = [], dropped: string[] = [], raw = data.actions;
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>, kind = String(it.action ?? "").trim().toLowerCase();
    if (!KINDS.has(kind)) { dropped.push(`unknown action '${kind.slice(0, 30)}'`); continue; }
    let sc = String(it.scope || "all").toLowerCase();
    if (!["all", "first", "last", "shot"].includes(sc)) sc = "all";
    const shot = typeof it.shot === "number" && Math.trunc(it.shot) >= 1 && Math.trunc(it.shot) <= Math.max(shots, 1) ? Math.trunc(it.shot) : null;
    if (sc === "shot" && shot === null) { dropped.push(`${kind}: no such shot`); continue; }
    if (requestText !== null) { const why = grounded(kind, sc, shot, requestText); if (why) { dropped.push(why); continue; } }
    const value = it.value, a = act(kind, { scope: sc, shot, source: "ai", text: `${kind} ${value ?? ""}`.trim() });
    if ((kind === "delete" || kind === "move") && sc === "all") { dropped.push(`${kind}: which shot?`); continue; }
    const str = (v: unknown) => typeof v === "string";
    if (kind === "speed") { a.factor = num(it.factor, 0.25, 4); a.value = a.factor === null ? num(value, 0.25, 4) : null; if (a.factor === null && a.value === null) continue; }
    else if (kind === "effect" && str(value) && (EFFECT_TYPES.includes(value as string) || value === "pan")) a.value = value;
    else if (kind === "transition" && str(value) && TRANSITION_TYPES.includes(value as string)) a.value = value;
    else if (kind === "music_volume" || kind === "voice_volume") { a.factor = num(it.factor, 0, 3); a.delta = num(it.delta, -1.5, 1.5); if (a.factor === null && a.delta === null) continue; }
    else if (kind === "music_fade") a.value = num(value, 0.5, 10) || 2.0;
    else if (kind === "duration") { a.value = num(value, MIN_DURATION, MAX_DURATION); a.factor = a.value === null ? num(it.factor, 0.3, 3) : null; if (a.value === null && a.factor === null) continue; }
    else if (kind === "grade" && str(value) && GRADES.includes(value as string)) a.value = value;
    else if ((kind === "cta" || kind === "hook_text") && str(value) && (value as string).trim()) a.value = (value as string).trim().slice(0, 42);
    else if (kind === "text_off" || kind === "text_less") { /* no value */ }
    else if (["grade", "cta", "hook_text"].includes(kind)) { dropped.push(`${kind}: unsupported value '${String(value).slice(0, 20)}'`); continue; }
    else if (kind === "caption_style" && CAPTION_STYLES.includes(value as string)) a.value = value;
    else if (kind === "framing" && (value === "fit" || value === "fill")) a.value = value;
    else if (kind === "pace" && ["calm", "balanced", "fast"].includes(value as string)) a.value = value;
    else if (kind === "style" && styleIds.has(value as string)) a.value = value;
    else if (kind === "move") {
      const to = it.to;
      a.to = to === "start" || to === "end" ? to : typeof to === "number" && Math.trunc(to) >= 1 && Math.trunc(to) <= shots ? Math.trunc(to) : null;
      if (a.to === null) continue;
    } else if (["effect", "transition", "caption_style", "framing", "pace", "style"].includes(kind)) { dropped.push(`${kind}: unsupported value '${String(value).slice(0, 20)}'`); continue; }
    out.push(a);
  }
  const unclear = data.unclear;
  if (typeof unclear === "string" && !["", "none", "n/a", "nothing", "anything you could not map"].includes(unclear.trim().toLowerCase().replace(/\.+$/, ""))) dropped.push(unclear.trim().slice(0, 120));
  return [out, dropped];
}
function summaryForAi(tl: Timeline, settings: Record<string, unknown>, shows: Record<string, string>) {
  return {
    shots: tl.segments.map((s, i) => ({ n: i + 1, clip: s.video.slice(0, 40), seconds: Math.round((s.timelineEnd - s.timelineStart) * 10) / 10, speed: s.speed, effect: s.effect, transition: s.transitionIn.type, ...(shows[s.clipId] ? { shows: shows[s.clipId].slice(0, 120) } : {}) })),
    texts: tl.overlays.map((o) => ({ text: o.text, role: o.role })), grade: tl.colorGrade, duration: Math.round(tl.duration * 10) / 10, style: tl.style, pace: settings.pace ?? null, captions: tl.captions.length > 0, has_voice: tl.voice !== null,
  };
}
const RevisionAnswer = z.object({ actions: z.array(z.record(z.string(), z.unknown())).default([]), unclear: z.string().nullish() });
export async function planRevision(text: string, tl: Timeline, settings: Record<string, unknown>, provider: ManagedProvider | null, shows: Record<string, string> = {}): Promise<Plan> {
  const [actions, unknown] = parseRules(text), plan: Plan = { actions, notUnderstood: [...unknown], usedAi: false, aiNote: null };
  if (unknown.length && provider) {
    const styleIds = new Set(listStyles().map((s) => s.id));
    try {
      const data = await provider.structured(systemPrompt(), JSON.stringify({ request: unknown.join(" , "), reel: summaryForAi(tl, settings, shows), styles: [...styleIds].sort() }), RevisionAnswer, { task: "revision", temperature: 0.2 });
      const [extra, dropped] = parseAiActions(data as Record<string, unknown>, tl.segments.length, styleIds, unknown.join(" , "));
      plan.usedAi = true;
      if (dropped.length && !extra.length) plan.aiNote = `The AI model's suggestion did not match what you asked, so it was ignored: ${dropped.slice(0, 2).join("; ")}.`;
      plan.actions.push(...extra);
      plan.notUnderstood = extra.length ? dropped : [...unknown];
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      plan.aiNote = `The AI model could not help with the unclear part (${e.message}).`;
    }
  } else if (unknown.length) plan.aiNote = "AI assist is not available, so only the phrases I know were applied.";
  return plan;
}

function targets(a: Action, tl: Timeline, notes: string[]): number[] {
  const n = tl.segments.length;
  if (a.scope === "all") return Array.from({ length: n }, (_, i) => i);
  if (a.scope === "first") return [0];
  if (a.scope === "last") return [n - 1];
  if (a.shot !== null && a.shot >= 1 && a.shot <= n) return [a.shot - 1];
  notes.push(`There is no shot ${a.shot}; the Reel has ${n}.`);
  return [];
}
const DIRECTOR_DESC: Record<string, string> = { replace_hook: "A stronger opening: the best unused hook moment in your footage", drop_reveal: "The strongest moment lands on the music's drop", product_earlier: "The clearest product shot comes earlier (shot 2)" };
const g = (v: number) => String(Number(v.toPrecision(6)));
export function describe(a: Action): string {
  const where = ({ all: "every shot", first: "the first shot", last: "the last shot" } as Record<string, string>)[a.scope] ?? `shot ${a.shot}`, k = a.kind, v = a.value;
  const up = (a.delta ?? 0) > 0 || (a.factor ?? 1) > 1;
  switch (k) {
    case "speed": return `Playback speed of ${where}: ${v !== null ? `${v}x` : `${(a.factor ?? 1) < 1 ? "slower" : "faster"} (x${a.factor})`}`;
    case "delete": return `Remove ${where}`;
    case "move": return typeof a.to === "string" ? `Move ${where} to the ${a.to}` : `Move ${where} to position ${a.to}`;
    case "effect": return v === "pan" ? `Camera pans on ${where} (left and right in turn)` : `Effect on ${where}: ${v}`;
    case "transition": return `Transition into ${where}: ${v}`;
    case "music_volume": return up ? "Music louder" : "Music quieter";
    case "mute_music": return "Mute the music";
    case "music_fade": return "Fade the music out at the end";
    case "voice_volume": return up ? "Voice louder" : "Voice quieter";
    case "voice_off": return "Remove the voice-over";
    case "duration": return v !== null ? `Length: ${g(v as number)} seconds` : `Length: ${(a.factor ?? 1) < 1 ? "shorter" : "longer"}`;
    case "captions_off": return "Remove captions";
    case "captions_on": return "Add captions (rebuilds the edit)";
    case "caption_style": return `Caption look: ${v}`;
    case "framing": return v === "fill" ? "Fill the whole screen (crops the picture)" : "Show the whole picture (blurred backdrop)";
    case "watermark_off": return "Remove the watermark";
    case "pace": return `${({ calm: "Calmer pace: longer shots, fewer cuts", fast: "Faster pace: more cuts", balanced: "Balanced pace" } as Record<string, string>)[String(v)]} (rebuilds the edit)`;
    case "style": return `Style: ${v} (rebuilds the edit)`;
    case "grade": return `Colour grade: ${v}`;
    case "text_off": return "Remove all on-screen text";
    case "text_less": return "Less text: keep only the hook and the call to action";
    case "cta": return `Call to action: "${v}"`;
    case "hook_text": return `Opening text: "${v}"`;
  }
  return DIRECTOR_DESC[k] ?? "Different clip selection and order (rebuilds the edit)";
}

function textsAfter(a: Action, tl: Timeline, current: TextOverlay[]): TextOverlay[] | null {
  if (a.kind === "text_off") return current.length ? [] : null;
  if (a.kind === "text_less") { const keep = current.filter((o) => o.role === "hook" || o.role === "cta"); const k = keep.length ? keep : current.slice(0, 1); return k.length < current.length ? k : null; }
  const text = tidyText(String(a.value ?? ""));
  if (!text) return null;
  const role = a.kind === "cta" ? "cta" : "hook", others = current.filter((o) => o.role !== role);
  const nw = role === "cta" ? TextOverlay.parse({ text, start: Math.max(tl.duration - 2.2, 0), end: tl.duration, role: "cta", position: "center", animation: "scale" })
    : TextOverlay.parse({ text, start: 0.3, end: Math.min(2.3, tl.duration), role: "hook", animation: "slide_up" });
  return [...others, nw].sort((x, y) => x.start - y.start);
}
/** (operations, notes, actions that produced something). Pure. */
export function actionsToOps(actions: Action[], tl: Timeline, audioDuration: number | null = null): [Operation[], string[], Action[]] {
  const out: Operation[] = [], notes: string[] = [], applied: Action[] = [], doomed = new Set<number>();
  let curMusic = tl.musicVolume, overlays = [...tl.overlays];
  const rnd = (x: number) => Math.round(x * 1000) / 1000;
  for (const a of actions) {
    if (isRebuild(a)) continue;
    const before = out.length, k = a.kind;
    if (k === "speed") for (const i of targets(a, tl, notes)) { const s = tl.segments[i], nw = a.value !== null ? Number(a.value) : s.speed * (a.factor ?? 1); out.push({ type: "set_speed", segmentId: s.id, speed: rnd(Math.min(Math.max(nw, MIN_SPEED), MAX_SPEED)) }); }
    else if (k === "delete") for (const i of targets(a, tl, notes)) doomed.add(i);
    else if (k === "move") {
      const idx = targets(a, tl, notes);
      if (idx.length) { const n = tl.segments.length, to = a.to === "start" ? 0 : a.to === "end" ? n - 1 : Math.min(Math.max(Math.trunc(Number(a.to || 1)) - 1, 0), n - 1); out.push({ type: "move", segmentId: tl.segments[idx[0]].id, toIndex: to }); }
    } else if (k === "effect") targets(a, tl, notes).forEach((i, n) => out.push({ type: "set_effect", segmentId: tl.segments[i].id, effect: a.value === "pan" ? (n % 2 === 0 ? "pan_left" : "pan_right") : String(a.value) }));
    else if (k === "grade") out.push({ type: "set_grade", grade: String(a.value) });
    else if (["text_off", "text_less", "cta", "hook_text"].includes(k)) {
      const texts = textsAfter(a, tl, overlays);
      if (texts === null) { if (k === "text_off" || k === "text_less") notes.push("There is no on-screen text to change."); }
      else { overlays = texts; out.push({ type: "set_overlays", overlays: texts }); }
    } else if (k === "transition") { for (const i of targets(a, tl, notes)) if (i !== 0) out.push({ type: "set_transition", segmentId: tl.segments[i].id, transition: String(a.value), duration: a.value === "cut" ? null : 0.4 }); }
    else if (k === "music_volume") { curMusic = rnd(Math.min(Math.max(a.factor !== null ? curMusic * a.factor : curMusic + (a.delta ?? 0), 0), 1.5)); out.push({ type: "set_music", volume: curMusic, fadeIn: null, fadeOut: null, audioStart: null }); }
    else if (k === "mute_music") { curMusic = 0; out.push({ type: "set_music", volume: 0, fadeIn: null, fadeOut: null, audioStart: null }); }
    else if (k === "music_fade") out.push({ type: "set_music", volume: null, fadeIn: null, fadeOut: Number(a.value ?? 2), audioStart: null });
    else if (k === "voice_volume") {
      if (!tl.voice) notes.push("There is no voice-over to adjust.");
      else { const cur = tl.voice.volume, nw = a.factor !== null ? cur * a.factor : cur + (a.delta ?? 0); out.push({ type: "set_voice_mix", volume: rnd(Math.min(Math.max(nw, 0), 2)), duckMusic: null, start: null }); }
    } else if (k === "voice_off") { if (!tl.voice) notes.push("There is no voice-over to remove."); else out.push({ type: "clear_voice" }); }
    else if (k === "duration") {
      const lo = MIN_DURATION, hi = Math.min(MAX_DURATION, audioDuration || MAX_DURATION), target = a.value !== null ? Number(a.value) : tl.duration * (a.factor ?? 1), clamped = Math.min(Math.max(target, lo), hi);
      if (clamped !== target) notes.push(`A length of ${g(target)}s is outside what this Reel can be; using ${g(clamped)}s.`);
      out.push({ type: "fit_duration", target: Math.round(clamped * 100) / 100 });
    } else if (k === "captions_off") { if (!tl.captions.length) notes.push("There are no captions to remove."); else out.push({ type: "replace_captions", captions: [] }); }
    else if (k === "caption_style") { if (!tl.captions.length) notes.push('There are no captions yet; say "add captions" first.'); else out.push({ type: "set_caption_style", style: a.value as "minimal" }); }
    else if (k === "framing") for (const s of tl.segments) out.push({ type: "set_crop", segmentId: s.id, crop: CropSpec.parse({ framing: String(a.value) }) });
    else if (k === "watermark_off") { if (!tl.watermark) notes.push("There is no watermark on this Reel."); else out.push({ type: "clear_watermark" }); }
    if (out.length > before || (k === "delete" && doomed.size)) applied.push(a);
  }
  if (doomed.size) {
    if (doomed.size >= tl.segments.length) notes.push("That would remove every shot; a Reel needs at least one.");
    else out.push(...[...doomed].sort((x, y) => x - y).map((i) => ({ type: "delete" as const, segmentId: tl.segments[i].id })));
  }
  return [out, notes, applied];
}
/** Settings for a fresh generation; later requests win. */
export function rebuildOverrides(actions: Action[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const a of actions) {
    if (a.kind === "style") o.style = a.value;
    else if (a.kind === "pace") o.pace = a.value;
    else if (a.kind === "captions_on") o.captions = true;
    else if (a.kind === "reshuffle") o.seed = 1 + Math.floor(Math.random() * 10_000_000);
    else if (a.kind === "duration" && a.value !== null) o.duration = Math.trunc(Math.min(Math.max(Math.round(Number(a.value)), MIN_DURATION), MAX_DURATION));
  }
  if (("style" in o || "pace" in o) && !("seed" in o)) o.seed = 0;
  return o;
}
export const shortLabel = (text: string, limit = 60) => { const t = text.replace(/\s+/g, " ").trim(); return t.length <= limit ? t : `${t.slice(0, limit - 1).trimEnd()}…`; };
/** Re-validate a plan the person saw and confirmed (nothing the client sends is trusted as-is). */
export function actionsFromDicts(items: Record<string, unknown>[], shots: number): Action[] {
  const dicts = items.filter((d) => d && typeof d === "object");
  const [acts] = parseAiActions({ actions: dicts.map((d) => ({ action: d.kind, scope: d.scope, shot: d.shot, value: d.value, factor: d.factor, delta: d.delta, to: d.to })) }, shots, new Set(listStyles().map((s) => s.id)));
  let pos = 0;
  for (const a of acts) {
    while (pos < dicts.length) { const d = dicts[pos++]; if (String(d.kind) === a.kind) { a.text = String(d.text ?? "").slice(0, 200); a.source = d.source === "ai" ? "ai" : "rules"; break; } }
  }
  return acts;
}
/** Any action as an edit patch {operation, target, reason, value?} (was director_patch.to_patch). */
export function toPatch(a: Action, tl: Timeline | null = null) {
  const n = tl ? tl.segments.length : 0;
  let target: string | undefined = ({ first: "timeline[0]", last: n ? `timeline[${Math.max(n - 1, 0)}]` : "timeline[-1]" } as Record<string, string>)[a.scope];
  if (a.scope === "shot" && a.shot) target = `timeline[${a.shot - 1}]`;
  const op = ({ replace_hook: "replace_hook", drop_reveal: "move_hero_to_drop", product_earlier: "move_product_earlier", delete: "remove_shot", move: "move_shot", speed: "set_speed", effect: "set_effect", transition: "set_transition",
    duration: "set_duration", style: "change_style", pace: "change_pace", reshuffle: "rebuild", captions_on: "add_captions", captions_off: "remove_captions", music_volume: "set_music_volume", mute_music: "mute_music",
    music_fade: "fade_music", grade: "set_grade", cta: "set_cta", hook_text: "set_hook_text", text_off: "remove_text", text_less: "reduce_text", framing: "set_crop" } as Record<string, string>)[a.kind] ?? a.kind;
  if (target === undefined) target = ({ music_volume: "music", mute_music: "music", music_fade: "music", grade: "look", style: "edit", pace: "edit", duration: "edit", cta: "text", hook_text: "text", text_off: "text", text_less: "text",
    drop_reveal: "music.drop", product_earlier: "timeline[1]" } as Record<string, string>)[a.kind] ?? "timeline";
  return { operation: op, target, reason: a.source === "rules" ? "user_request" : "user_request_ai_interpreted", ...(a.value !== null && a.value !== undefined ? { value: a.value } : {}) };
}
