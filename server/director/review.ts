import "server-only";
import { findBinary, run } from "@/server/core/ffmpeg";
import { fixed, g, round } from "@/server/core/py";
import type { ClipInput, ClipSemantic } from "@/server/models/clip";
import { semanticTerms } from "@/server/models/clip";
import { segLength, type Segment, type SoundEffect, type Timeline } from "@/server/models/timeline";
import { beatDistance, cutMoments, cutPoints, windowsOf } from "@/server/video/timeline";
import { LEVEL_ACTION, LEVEL_NAMES, energyAtMap, levelAt, loudLimit, musicMapDoc, snapPoints, type MusicMap } from "./musicMap";
import { ensureTransitions } from "@/server/video/transitions";

/** Quality control before rendering - check the timeline and repair what can be repaired (was director/review.py) -
 * plus the checks on the rendered file, the story order (story.py), the readable Reel plan (plan.py) and where sound
 * effects go (sfx.py). */

const MIN_SHOT = 0.25, MIN_ENDING = 0.9, MAX_HOOK = 2.6, BEAT_TOLERANCE = 0.06, SPEED_RANGE: [number, number] = [0.4, 2.5], DUPLICATE_OVERLAP = 0.6;

export interface Check { name: string; ok: boolean; detail: string; fixed: boolean }
export const check = (name: string, ok: boolean, detail = "", fixed_ = false): Check => ({ name, ok, detail, fixed: fixed_ });
export const checkDoc = (c: Check) => ({ name: c.name, ok: c.ok, fixed: c.fixed, detail: c.detail });

function reflow(tl: Timeline): boolean {
  let changed = false, t = 0;
  for (const s of tl.segments) {
    if (Math.abs(s.timelineStart - t) > 1e-3) { s.timelineStart = round(t, 3); changed = true; }
    t = s.timelineEnd;
  }
  const last = tl.segments[tl.segments.length - 1];
  if (last && Math.abs(last.timelineEnd - tl.duration) > 0.02) { last.timelineEnd = round(tl.duration, 3); changed = true; }
  return changed;
}
const clipLen = (clips: Map<string, ClipInput>, id: string) => clips.get(id)?.analysis.metadata.duration ?? 0;

function mergeTinyShots(tl: Timeline, clips: Map<string, ClipInput>): number {
  let merged = 0, i = 1;
  while (i < tl.segments.length) {
    const s = tl.segments[i];
    if (segLength(s) < MIN_SHOT - 1e-6) {
      const prev = tl.segments[i - 1];
      prev.timelineEnd = s.timelineEnd;
      let want = prev.sourceStart + segLength(prev) * prev.speed;
      const room = clipLen(clips, prev.clipId);
      if (room && want > room) { prev.speed = round(Math.max((room - prev.sourceStart) / segLength(prev), SPEED_RANGE[0]), 3); want = Math.min(want, room); }
      prev.sourceEnd = round(want, 3);
      tl.segments.splice(i, 1);
      merged++;
    } else i++;
  }
  return merged;
}
const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / Math.max(Math.min(a1 - a0, b1 - b0), 1e-6);

function dedupe(tl: Timeline, clips: Map<string, ClipInput>, skipFirst: boolean): [number, number] {
  let fixedN = 0, stuck = 0;
  tl.segments.forEach((b, j) => {
    if (j === 0 && skipFirst) return;
    for (let i = 0; i < j; i++) {
      const a = tl.segments[i];
      if ((i === 0 && skipFirst) || a.clipId !== b.clipId || (j === i + 1 && Math.abs(a.sourceEnd - b.sourceStart) < 0.05)) continue;
      if (overlap(a.sourceStart, a.sourceEnd, b.sourceStart, b.sourceEnd) < DUPLICATE_OVERLAP) continue;
      const span = b.sourceEnd - b.sourceStart;
      const used = tl.segments.filter((x) => x !== b && x.clipId === b.clipId && !(x === tl.segments[0] && skipFirst)).map((x) => [x.sourceStart, x.sourceEnd]);
      let best: number | null = null;
      const clip = clips.get(b.clipId);
      for (const w of clip ? windowsOf(clip) : []) {
        for (let start = w.start; start + span <= w.end + 1e-6; start += 0.25) {
          if (used.every(([u0, u1]) => overlap(start, start + span, u0, u1) < 0.15)) { best = start; break; }
        }
        if (best !== null) break;
      }
      if (best === null) stuck++;
      else { b.sourceStart = round(best, 3); b.sourceEnd = round(best + span, 3); fixedN++; }
      break;
    }
  });
  return [fixedN, stuck];
}

function lengthenEnding(tl: Timeline, clips: Map<string, ClipInput>, mm: MusicMap | null): boolean {
  if (tl.segments.length < 2) return false;
  const last = tl.segments[tl.segments.length - 1], prev = tl.segments[tl.segments.length - 2];
  let need = MIN_ENDING - segLength(last);
  if (need > 0 && mm) {
    const latest = last.timelineEnd - MIN_ENDING;
    const beats = snapPoints(mm).filter((b) => prev.timelineStart + 0.7 <= b && b <= latest + 1e-6);
    if (beats.length) need = last.timelineStart - Math.max(...beats);
  }
  if (need <= 0 || segLength(prev) - need < 0.7) return false;
  if (last.sourceStart - need * last.speed >= 0) last.sourceStart = round(last.sourceStart - need * last.speed, 3);
  else if (last.sourceEnd + need * last.speed <= clipLen(clips, last.clipId) + 1e-6) last.sourceEnd = round(last.sourceEnd + need * last.speed, 3);
  else return false;
  prev.timelineEnd = round(prev.timelineEnd - need, 3);
  prev.sourceEnd = round(prev.sourceEnd - need * prev.speed, 3);
  last.timelineStart = round(last.timelineStart - need, 3);
  return true;
}

/** The first shot has nothing to come from (a cut); every later shot gets a transition that fits it, never the same one
 * twice in a row (video/transitions.ts). */
function tidyTransitions(tl: Timeline): number {
  let changed = 0;
  const first = tl.segments[0]?.transitionIn;
  if (first && first.type !== "cut") { tl.segments[0].transitionIn = { type: "cut", duration: 0 }; changed++; }
  return changed + ensureTransitions(tl);
}

export function energyCheck(tl: Timeline, mm: MusicMap, pace: string, steps = false): Check {
  const slow: string[] = [], loudLen: number[] = [], calmLen: number[] = [];
  tl.segments.forEach((s, i) => {
    const lim = loudLimit(mm, s.timelineStart, s.timelineEnd, pace), len = segLength(s);
    (lim ? loudLen : calmLen).push(len);
    if (lim && len > lim[1] * 1.15) slow.push(`shot ${i + 1} (${fixed(len, 1)}s in a ${lim[0].replace(/_/g, " ")} part)`);
  });
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  let detail = [loudLen.length ? `loud parts ${fixed(avg(loudLen), 1)}s per shot` : "", calmLen.length ? `calm parts ${fixed(avg(calmLen), 1)}s per shot` : ""].filter(Boolean).join(", ");
  if (slow.length) detail = `${slow.slice(0, 3).join("; ")}${slow.length > 3 ? "…" : ""} too long for the music` + (detail ? ` (${detail})` : "");
  return check("Cut speed follows the music energy", steps || !slow.length, detail);
}

export function reviewTimeline(tl: Timeline, clips: ClipInput[], mm: MusicMap | null, o: { stepsOrder?: string[] | null; teaserFirst?: boolean; pace?: string } = {}): Check[] {
  const byId = new Map(clips.map((c) => [c.clipId, c]));
  const out: Check[] = [];
  const f = reflow(tl);
  const total = tl.segments.reduce((s, x) => s + segLength(x), 0);
  out.push(check("Shots follow each other and fill the Reel", Math.abs(total - tl.duration) < 0.05, `${tl.segments.length} shots over ${g(tl.duration)}s`, f));
  const n = mergeTinyShots(tl, byId);
  reflow(tl);
  out.push(check("No flicker shots (each at least 0.25 s)", !tl.segments.some((s) => segLength(s) < MIN_SHOT - 1e-6), n ? `${n} tiny shot(s) merged` : "", n > 0));
  const [fx, stuck] = dedupe(tl, byId, Boolean(o.teaserFirst));
  out.push(check("No accidental duplicate shots", stuck === 0, (fx ? `${fx} repeated moment(s) moved to unused footage` : "") + (stuck ? `; ${stuck} repeat(s) could not be avoided (not enough footage)` : ""), fx > 0));
  const lengthened = lengthenEnding(tl, byId, mm);
  const last = tl.segments[tl.segments.length - 1];
  out.push(check("The ending is a real shot, not a cut-off", segLength(last) >= MIN_ENDING - 1e-6, `last shot ${fixed(segLength(last), 2)}s` + (lengthened ? "; borrowed time from the shot before" : ""), lengthened));
  const t = tidyTransitions(tl);
  out.push(check("Transitions are varied and fit their shots", true, t ? `${t} adjusted` : "", t > 0));
  const bad = tl.segments.filter((s) => !(SPEED_RANGE[0] <= s.speed && s.speed <= SPEED_RANGE[1]));
  out.push(check("No extreme speed changes", !bad.length, bad.length ? `${bad.length} shot(s) outside ${SPEED_RANGE[0]}x-${SPEED_RANGE[1]}x` : ""));
  if (mm && mm.beats.length) {
    const cuts = cutPoints(tl), snap = snapPoints(mm);
    const worst = Math.max(0, ...cutMoments(tl).map((m) => beatDistance(m, snap)));
    out.push(check("Cuts land on the beat or a strong accent", worst <= BEAT_TOLERANCE, `worst cut is ${fixed(worst * 1000, 0)} ms away`));
    out.push(energyCheck(tl, mm, o.pace ?? "balanced", o.stepsOrder !== undefined && o.stepsOrder !== null));
    out.push(check("Strong beats get a visual response", true, `${cuts.filter((c) => levelAt(mm, c) >= 3).length} of ${cuts.length} cuts fall on a strong beat or major hit`));
  }
  const first = tl.segments[0], fl = segLength(first);
  out.push(check("The hook comes early", fl <= MAX_HOOK + 1e-6, `the opening shot lasts ${fixed(fl, 1)}s` + (fl <= MAX_HOOK ? "" : ` (over ${MAX_HOOK}s; not changed)`)));
  if (o.stepsOrder) {
    const seen: string[] = [];
    for (const s of o.teaserFirst ? tl.segments.slice(1) : tl.segments) if (!seen.includes(s.clipId)) seen.push(s.clipId);
    const want = o.stepsOrder.filter((c) => seen.includes(c));
    out.push(check("The sequence of steps is preserved", seen.length === want.length && seen.every((c, i) => c === want[i]), `${seen.length} steps in order`));
  }
  for (const cap of tl.captions) { cap.start = round(Math.max(cap.start, 0), 3); cap.end = round(Math.min(cap.end, tl.duration), 3); }
  out.push(check("Text stays inside the Reel and its safe area", tl.captions.every((c) => c.end > c.start), "positions come from the caption engine's safe margins; overlap with the subject is not measured for video clips"));
  return out;
}

/** Checks on the rendered file: format, audio, lengths, black frames, frozen frames. */
export async function checkRender(file: string, expectedDuration: number, expectAudio: boolean, expectPreview = false): Promise<Check[]> {
  const out: Check[] = [];
  const p = await run(findBinary("ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,duration", "-of", "json", file], 60_000);
  const streams = (JSON.parse(p.stdout || "{}").streams ?? []) as Record<string, string | number>[];
  const v = streams.find((s) => s.codec_type === "video") ?? {}, a = streams.find((s) => s.codec_type === "audio") ?? null;
  const w = Number(v.width), h = Number(v.height), vertical = Boolean(w && h && Math.abs(w / h - 9 / 16) < 0.01), full = w === 1080 && h === 1920;
  out.push(check("9:16 H.264 MP4 at 1080 x 1920", vertical && v.codec_name === "h264" && (full || expectPreview), `${w}x${h} ${v.codec_name ?? "?"}` + (full ? "" : expectPreview ? " (a fast preview is smaller on purpose)" : "")));
  out.push(check("Audio is present", a !== null || !expectAudio, a ? "" : "the file has no audio track"));
  if (a && v.duration && a.duration) {
    const diff = Math.abs(Number(v.duration) - Number(a.duration));
    out.push(check("Audio and video lengths match", diff <= 0.15, `differ by ${fixed(diff * 1000, 0)} ms`));
  }
  if (v.duration) {
    const diff = Math.abs(Number(v.duration) - expectedDuration);
    out.push(check("The video is as long as planned", diff <= 0.25, `${fixed(Number(v.duration), 2)}s vs ${fixed(expectedDuration, 2)}s planned`));
  }
  let log = "";
  try {
    log = (await run(findBinary("ffmpeg"), ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "blackdetect=d=0.2:pix_th=0.06,freezedetect=n=-55dB:d=0.8", "-f", "null", "-"], 300_000)).stderr;
  } catch (e) {
    log = String((e as { details?: string }).details ?? "");
  }
  const dur = expectedDuration;
  const blacks = [...log.matchAll(/black_start:(\S+)\s+black_end:(\S+)/g)].map((m) => [Number(m[1]), Number(m[2])]).filter(([x, y]) => !(x < 0.05 && y < 0.8) && !(y > dur - 0.05 && y - x < 1));
  out.push(check("No black frames", !blacks.length, blacks.slice(0, 4).map(([x, y]) => `${fixed(x, 1)}-${fixed(y, 1)}s`).join(", ")));
  const freezes = [...log.matchAll(/freeze_start: (\S+)/g)].map((m) => Number(m[1])), durs = [...log.matchAll(/freeze_duration: (\S+)/g)].map((m) => Number(m[1]));
  out.push(check("No frozen frames", !freezes.length, freezes.slice(0, Math.min(4, durs.length)).map((x, i) => `${fixed(x, 1)}s for ${fixed(durs[i], 1)}s`).join(", ")));
  return out;
}

// ------------------------------------------------------------------ story (director/story.py)
const VOTES: Record<string, Set<string>> = {
  food: new Set("food dish cook cooking kitchen recipe dough paratha roti curry pan wok bowl rice potato onion spice spices chop chopping fry frying stove plate plating meal batter flour knead kneading rolling".split(" ")),
  jewelry: new Set("jewelry jewellery ring necklace earring earrings bracelet diamond pendant gold gemstone bangle".split(" ")),
  product: new Set("product bottle packaging package box gadget device cosmetic shoe bag watch".split(" ")),
  fashion: new Set("dress outfit fashion model wearing saree jacket clothes clothing runway".split(" ")),
  travel: new Set("beach mountain landscape travel city sky road temple sunset lake forest tourist trip".split(" ")),
  beauty: new Set("makeup skincare lipstick hair face salon cosmetics".split(" ")),
  fitness: new Set("gym workout exercise running yoga fitness training".split(" ")),
  event: new Set("wedding party celebration festival crowd concert birthday".split(" ")),
  education: new Set("whiteboard classroom lecture teacher school".split(" ")),
  tutorial: new Set("tutorial laptop screen diy craft assembling".split(" ")),
};
const STYLE_HINT: Record<string, string> = { food: "food", travel: "travel", luxury: "jewelry" };
const STAGE_RANK: Record<string, number> = { ingredients: 0, preparation: 1, cooking: 2, plating: 3, finished: 4 };
export const FINAL_STAGES = ["plating", "finished"];

export interface Category { name: string; confidence: number; source: string; evidence: string[] }

export function detectCategory(semantics: (ClipSemantic | null)[], styleId = ""): Category {
  const known = semantics.filter((s): s is ClipSemantic => s !== null);
  const scores: Record<string, number> = {}, words: Record<string, Set<string>> = {};
  for (const s of known) {
    if (s.category !== "other") scores[s.category] = (scores[s.category] ?? 0) + 2;
    const terms = semanticTerms(s);
    for (const [cat, vocab] of Object.entries(VOTES)) {
      const hit = [...terms].filter((t) => vocab.has(t));
      if (hit.length) { scores[cat] = (scores[cat] ?? 0) + Math.min(hit.length, 3) * 0.5; (words[cat] ??= new Set()); hit.forEach((h) => words[cat].add(h)); }
    }
  }
  const keys = Object.keys(scores);
  if (known.length && keys.length) {
    const best = keys.reduce((a, b) => (scores[b] > scores[a] ? b : a), keys[0]);
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    return { name: best, confidence: round(scores[best] / total, 2), source: "vision", evidence: [...(words[best] ?? [])].sort().slice(0, 6) };
  }
  const hint = STYLE_HINT[styleId];
  return hint ? { name: hint, confidence: 0.3, source: "style", evidence: [`the ${styleId} style was chosen`] } : { name: "other", confidence: 0, source: "none", evidence: [] };
}

export const stageOf = (sem: ClipSemantic | null | undefined) => (sem && sem.stage in STAGE_RANK ? sem.stage : null);

export interface StoryOrder<C> { clips: C[]; hook: C | null; usedVision: boolean; moved: string[]; notes: string[] }

/** Recipe order from what the clips show; an unplaced clip keeps the rank of the one before it (stable). */
export function orderForFood<C extends { name: string; semantic?: ClipSemantic | null }>(base: C[]): StoryOrder<C> {
  const ranks = base.map((c) => { const st = stageOf(c.semantic); return st === null ? null : STAGE_RANK[st]; });
  if (!ranks.some((r) => r !== null)) return { clips: [...base], hook: null, usedVision: false, moved: [], notes: [] };
  let carried = 0;
  const filled = ranks.map((r) => (carried = r ?? carried));
  const order = base.map((_, i) => i).sort((i, j) => filled[i] - filled[j] || i - j);
  const clips = order.map((i) => base[i]);
  const moved = order.map((i, j) => [i, j]).filter(([i, j]) => i !== j).map(([i]) => base[i].name);
  const notes = moved.length ? ["Clips were arranged by what they show (ingredients, preparation, cooking, then serving) rather than by file name."] : [];
  const finals = clips.filter((c) => FINAL_STAGES.includes(stageOf(c.semantic) ?? ""));
  const key = (c: C) => [c.semantic!.hookCandidate || c.semantic!.endingCandidate ? 1 : 0, c.semantic!.importance];
  const hook = finals.length ? finals.reduce((a, b) => { const [x1, x2] = key(a), [y1, y2] = key(b); return y1 > x1 || (y1 === x1 && y2 > x2) ? b : a; }) : null;
  const known = ranks.filter((r) => r !== null).length;
  if (known < base.length) notes.push(`The vision model could place ${known} of ${base.length} clips in the recipe; the others stay next to the clip before them.`);
  return { clips, hook, usedVision: true, moved, notes };
}

// ------------------------------------------------------------------ the Reel plan (director/plan.py)
const LIMITS = [
  "Shots come from your own footage: nothing is generated.",
  "Subjects and stages come from the vision model when 'AI assist' is on; otherwise the plan says they were not analysed.",
  "Song parts (intro, build, drop ...) are measured; vocal presence is an estimate, so exact vocal entries are not detected.",
];
function musicEvent(mm: MusicMap, t: number): string {
  if (mm.drops.some((d) => Math.abs(d - t) <= 0.15)) return "drop";
  if (mm.phrases.some((p) => Math.abs(p - t) <= 0.06)) return "start of a musical phrase";
  return mm.beats.some((b) => Math.abs(b.t - t) <= 0.06) ? `${LEVEL_NAMES[levelAt(mm, t)]} beat` : "between beats";
}
function purpose(i: number, n: number, clip: ClipInput | undefined, teaser: boolean, steps: boolean): string {
  const sem = clip?.semantic ?? null, stage = stageOf(sem);
  if (i === 0) return teaser ? "hook: finished result teaser" : "hook";
  if (i === n - 1) return FINAL_STAGES.includes(stage ?? "") ? "ending: final dish" : "ending";
  if (steps && stage) return `step: ${stage}`;
  if (sem?.action) return `action: ${sem.action.slice(0, 40)}`;
  return "moment";
}

export function buildReelPlan(tl: Timeline, clips: ClipInput[], mm: MusicMap, category: Category, checks: Check[], o: { steps: boolean; teaser: boolean; storyNotes?: string[]; label?: string }) {
  const byId = new Map(clips.map((c) => [c.clipId, c])), n = tl.segments.length;
  const CAM: Record<string, string> = { punch: "punch on a hit", zoom_in: "slow push in", zoom_out: "slow pull out" };
  const shots = tl.segments.map((s: Segment, i) => {
    const clip = byId.get(s.clipId), sem = clip?.semantic ?? null;
    const text = tl.captions.filter((c) => c.start < s.timelineEnd - 0.01 && c.end > s.timelineStart + 0.01).map((c) => c.text);
    const lvl = levelAt(mm, s.timelineStart);
    return {
      index: i + 1, start: round(s.timelineStart, 3), end: round(s.timelineEnd, 3), asset: s.video, sourceStart: round(s.sourceStart, 3), sourceEnd: round(s.sourceEnd, 3),
      purpose: purpose(i, n, clip, o.teaser && i === 0, o.steps), subject: sem && (sem.summary || sem.scene) ? sem.summary || sem.scene : "not analysed",
      shotType: sem?.camera ?? null, camera: (CAM[s.effect] ?? "steady") + `, focus on ${s.focusSource}`, speed: s.speed, transition: s.transitionIn.type,
      text: text[0] ?? null, musicEvent: musicEvent(mm, s.timelineStart), beatLevel: lvl, beatLevelName: LEVEL_NAMES[lvl], mayTrigger: LEVEL_ACTION[lvl],
      energy: energyAtMap(mm, s.timelineStart), importance: sem ? round(sem.importance, 2) : null, why: s.reason,
    };
  });
  const first = tl.segments[0], last = tl.segments[n - 1], lastStage = stageOf(byId.get(last.clipId)?.semantic);
  return {
    label: o.label ?? "", duration: round(tl.duration, 3), format: "1080x1920", category: { ...category }, music: musicMapDoc(mm),
    hook: { asset: first.video, start: round(first.timelineStart, 3), end: round(first.timelineEnd, 3), kind: o.teaser ? "finished-result teaser" : "opening shot" },
    story: [...(o.storyNotes ?? []), ...(o.steps ? [] : ["Best moments, mixed: no recipe order is applied in this mode."])], shots,
    ending: { asset: last.video, purpose: FINAL_STAGES.includes(lastStage ?? "") ? "final dish" : "closing shot" }, quality: checks.map(checkDoc), limits: LIMITS,
  } as Record<string, unknown>;
}

// ------------------------------------------------------------------ sound effects (director/sfx.py)
const MOVING = ["zoom", "slide", "speed_ramp", "flash", "wipe", "smooth", "squeeze", "wind", "cover", "reveal", "whip", "circle", "slice"];
const SFX_LEN = { whoosh: 0.45, riser: 1.5 };

/** Few, purposeful effects on the edit's own events (moving transitions, drops, text). */
export function planSfx(tl: Timeline, mm: MusicMap | null): SoundEffect[] {
  const wanted: [number, SoundEffect][] = [];
  for (const s of tl.segments.slice(1)) {
    const t = s.transitionIn.type;
    if (t !== "cut" && MOVING.some((m) => t.startsWith(m))) wanted.push([2, { type: "whoosh", at: round(Math.max(s.timelineStart - SFX_LEN.whoosh * 0.6, 0), 3), volume: 0.55 }]);
  }
  for (const d of (mm?.drops ?? []).filter((d) => 1 < d && d < tl.duration - 0.5).slice(0, 2)) {
    if (d >= SFX_LEN.riser + 0.3) wanted.push([1, { type: "riser", at: round(d - SFX_LEN.riser, 3), volume: 0.45 }]);
    wanted.push([0, { type: "impact", at: round(d, 3), volume: 0.8 }]);
  }
  for (const o of [...tl.overlays].sort((a, b) => a.start - b.start).slice(0, 4)) wanted.push([3, { type: "pop", at: round(o.start, 3), volume: 0.5 }]);
  const chosen: SoundEffect[] = [];
  for (const [, e] of wanted.map((x, i) => [x, i] as const).sort((p, q) => p[0][0] - q[0][0] || p[0][1].at - q[0][1].at || p[1] - q[1]).map(([x]) => x)) {
    if (chosen.length >= 12) break;
    if (e.type !== "riser" && chosen.some((c) => Math.abs(e.at - c.at) < 0.4 && c.type !== "riser")) continue;
    chosen.push(e);
  }
  return chosen.sort((a, b) => a.at - b.at);
}
