import { fixed, g, round } from "@/server/core/py";
import { PyRandom } from "@/server/core/random";
import { FINAL_STAGES, orderForFood, stageOf } from "@/server/director/review";
import { meanEnergy, type AudioAnalysis } from "@/server/models/analysis";
import { motionBetween, windowLength, type ClipInput, type UsableWindow } from "@/server/models/clip";
import { Timeline as TimelineSchema, type Caption, type Segment, type Timeline } from "@/server/models/timeline";
import type { EditingStyle } from "@/server/styles";
import { wordsFor } from "@/server/timeline/ops";
import { cuesToCaptions, groupWords, type Word } from "@/server/video/render/text";
import { assignEffects, assignTransitions, chooseMusicWindow, gridBeats, snapToAccent, windowsOf, type Slot } from "@/server/video/timeline";

/** Step-by-step Reels (cooking, crafts, tutorials): every clip once, in the order the steps happened (was
 * video/steps.py); and talking-head Reels cut on the speech (video/talking.py). */

const MAX_STEP_SPEED = 2, MIN_SLOW_SPEED = 0.5, MAX_STEP_SECONDS = 4, FINAL_SHARE = 1.4, MIN_STEP = 0.7, TEASER_SECONDS = 1.2, LABEL_MAX = 1.8;
const LABELS: Record<string, [string, string, string]> = {
  en: ["The result", "Step {n}", "Done!"], hinglish: ["Final result", "Step {n}", "Ready!"], hi: ["नतीजा", "स्टेप {n}", "तैयार!"], mr: ["अंतिम रूप", "पायरी {n}", "तयार!"],
};
const STAMP = /(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)(?:[-_. T]?([0-2]\d)[-_.]?([0-5]\d)[-_.]?([0-5]\d))?/;
const SERIAL = /(\d{2,})(?!.*\d)/, CLOCK = /(\d{1,2})[.:](\d{2})[.:](\d{2})\s*([AaPp][Mm])?/;

/** When a clip was recorded, as far as its file name says. */
export function recordingKey(name: string): number[] | null {
  const stem = name.replace(/\.[A-Za-z0-9]{2,4}$/, "");
  const m = STAMP.exec(stem);
  if (m) {
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      const after = stem.slice(m.index + m[0].length);
      let hh = 0, mi = 0, ss = 0, rest = after;
      const c = m[4] ? null : CLOCK.exec(after);
      if (m[4]) { hh = Number(m[4]); mi = Number(m[5]); ss = Number(m[6]); }
      else if (c) { hh = Number(c[1]); mi = Number(c[2]); ss = Number(c[3]); if (c[4]) hh = (hh % 12) + (c[4].toLowerCase() === "pm" ? 12 : 0); rest = after.slice(c.index + c[0].length); }
      const serial = SERIAL.exec(rest);
      return [y, mo, d, hh, mi, ss, serial ? Number(serial[1]) : 0];
    }
  }
  const serial = SERIAL.exec(stem);
  return serial ? [0, 0, 0, 0, 0, 0, Number(serial[1])] : null;
}
const cmpKey = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Recording order when every file name reveals it; otherwise the user's order. */
export function orderClips<C extends { name: string }>(clips: C[], notes: string[]): C[] {
  const keys = clips.map((c) => recordingKey(c.name));
  if (clips.length > 1 && keys.every((k) => k !== null) && new Set(keys.map((k) => k!.join(","))).size === keys.length) {
    const ordered = clips.map((c, i) => [keys[i]!, c] as const).sort((a, b) => cmpKey(a[0], b[0])).map(([, c]) => c);
    const moved = ordered.some((c, i) => c.name !== clips[i].name);
    notes.push("Steps follow the time in the file names" + (moved ? " (your list was reordered to match)." : "."));
    return ordered;
  }
  notes.push("Steps follow the order of your clip list (the file names do not show when they were recorded). Reorder the clips if a step is out of place.");
  return [...clips];
}

const bestWindow = (c: ClipInput) => windowsOf(c).reduce((a, w) => (windowLength(w) > windowLength(a) || (windowLength(w) === windowLength(a) && w.quality > a.quality) ? w : a));

function allocate(clips: ClipInput[], target: number, notes: string[]): [number[], number] {
  const n = clips.length;
  const want = clips.map((c, i) => Math.min(Math.max(windowLength(bestWindow(c)), MIN_STEP), MAX_STEP_SECONDS) * (i === n - 1 && n > 1 ? FINAL_SHARE : 1));
  const total = want.reduce((a, b) => a + b, 0);
  if (n * MIN_STEP > target) { target = n * MIN_STEP; notes.push(`${n} steps need at least ${fixed(n * MIN_STEP, 0)}s to be readable, so the Reel is longer than the length you chose.`); }
  if (total <= target) {
    if (total < target - 1) notes.push(`The Reel is ${fixed(total, 0)}s, not ${g(target)}s: each step is shown once and that is all the footage there is.`);
    return [want, total];
  }
  return [want.map((w) => Math.max((w * target) / total, MIN_STEP)), target];
}

function snap(targets: number[], beats: number[], end: number, begin: number, accents: [number, number][]): number[] {
  const n = targets.length, out: number[] = [];
  let prev = begin;
  targets.slice(0, -1).forEach((t, k) => {
    const lo = prev + MIN_STEP, hi = end - (n - 1 - k) * MIN_STEP;
    const cands = beats.filter((b) => lo - 1e-6 <= b && b <= hi + 1e-6);
    let pick = cands.length ? cands.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a)) : Math.min(Math.max(t, lo), hi);
    const snapped = snapToAccent(pick, accents);
    if (lo - 1e-6 <= snapped && snapped <= hi + 1e-6) pick = snapped;
    out.push(round(pick, 3));
    prev = pick;
  });
  return [...out, round(end, 3)];
}

const seg = (o: Partial<Segment> & Pick<Segment, "clipId" | "video" | "sourceStart" | "sourceEnd" | "timelineStart" | "timelineEnd">) => o;

export function buildStepsTimeline(audio: AudioAnalysis, clipsIn: ClipInput[], duration: number, style: EditingStyle,
  o: { seed?: number; audioStart?: number | null; teaser?: boolean; stepLabels?: boolean; language?: string; orderMode?: string } = {}): Timeline {
  if (!clipsIn.length) throw new Error("At least one clip is required to build a timeline.");
  const rng = new PyRandom(o.seed ?? 0), warnings: string[] = [], notes: string[] = [], manual = o.orderMode === "manual";
  let clips = clipsIn, story: ReturnType<typeof orderForFood<ClipInput>> | null = null, teaser = Boolean(o.teaser);
  if (manual) notes.push("Steps follow the order you arranged them in.");
  else {
    clips = orderClips(clips, notes);
    story = orderForFood(clips);
    if (story.usedVision) { clips = story.clips; notes.push(...story.notes); }
  }
  const n = clips.length, hookClip = story?.hook ?? clips[n - 1], lastStage = stageOf(clips[n - 1].semantic);
  if (teaser && lastStage !== null && !FINAL_STAGES.includes(lastStage) && (!story || !story.hook) && !manual) { teaser = false; notes.push("No clip shows the finished dish, so there is no result teaser at the start."); }
  const finale = bestWindow(hookClip);
  teaser = teaser && n >= 2 && windowLength(finale) >= TEASER_SECONDS;
  let lead = teaser ? TEASER_SECONDS : 0;
  const [shares, stepsLen] = allocate(clips, Math.max(duration - lead, MIN_STEP), notes);
  const [start, eff] = chooseMusicWindow(audio, stepsLen + lead, warnings, o.audioStart ?? null);
  const grid = gridBeats(audio, start, eff);
  if (teaser) { const near = grid.filter((b) => 0.8 <= b && b <= 1.7); lead = near.length ? near.reduce((a, b) => (Math.abs(b - TEASER_SECONDS) < Math.abs(a - TEASER_SECONDS) ? b : a)) : TEASER_SECONDS; }
  const sumShares = shares.reduce((a, b) => a + b, 0), scale = sumShares > eff - lead ? (eff - lead) / sumShares : 1;
  const cum: number[] = [];
  let runT = lead;
  for (const sh of shares) { runT += sh * scale; cum.push(runT); }
  const accentsRel: [number, number][] = audio.accents.map((t, i) => [round(t - start, 3), audio.accentStrengths[i]]);
  const ends = snap(cum, grid, eff, lead, accentsRel);
  const slots: Slot[] = [], segments: Partial<Segment>[] = [], trimmed: string[] = [];
  let prevEnd = 0;
  if (teaser) {
    const slot: Slot = { index: 0, start: 0, end: round(lead, 3), energy: meanEnergy(audio, start, start + lead), onStrong: true };
    slots.push(slot);
    segments.push(seg({ clipId: hookClip.clipId, video: hookClip.name, sourceStart: round(finale.end - lead, 3), sourceEnd: round(finale.end, 3), timelineStart: 0, timelineEnd: slot.end, speed: 1,
      focusX: finale.focusX, focusY: finale.focusY, focusSource: finale.focusSource }));
    prevEnd = slot.end;
  }
  clips.forEach((clip, i) => {
    const end = ends[i], length = end - prevEnd, w: UsableWindow = bestWindow(clip), last = i === n - 1, wl = windowLength(w);
    let speed = 1, span: number;
    if (wl < length - 1e-6) {
      speed = Math.max(wl / length, MIN_SLOW_SPEED);
      span = Math.min(length * speed, wl);
      if (length * speed > wl + 0.05) warnings.push(`'${clip.name}' is shorter than the time its step needs, so it plays in slow motion.`);
    } else {
      if (!last && wl > length * 1.25) speed = Math.min(MAX_STEP_SPEED, wl / length);
      span = length * speed;
      if (wl - span > 0.5) trimmed.push(clip.name);
    }
    const room = Math.max(wl - span, 0);
    let a: number;
    if (last) a = w.start + room;
    else if (room <= 0.3 * wl) a = w.start + room / 2;
    else a = Array.from({ length: 6 }, (_, k) => w.start + (room * k) / 5).reduce((best, t) => (motionBetween(w, t, t + span) > motionBetween(w, best, best + span) ? t : best));
    const slot: Slot = { index: slots.length, start: round(prevEnd, 3), end, energy: meanEnergy(audio, start + prevEnd, start + end), onStrong: false };
    slots.push(slot);
    segments.push(seg({ clipId: clip.clipId, video: clip.name, sourceStart: round(a, 3), sourceEnd: round(Math.min(a + span, w.end), 3), timelineStart: slot.start, timelineEnd: slot.end,
      speed: round(speed, 3), focusX: w.focusX, focusY: w.focusY, focusSource: w.focusSource }));
    prevEnd = end;
  });
  const captions: Partial<Caption>[] = [];
  if (o.stepLabels) {
    const [wordTeaser, stepFmt, wordDone] = LABELS[o.language ?? "en"] ?? LABELS.en;
    const byId = new Map(clips.map((c) => [c.clipId, c]));
    let numbered = 0;
    segments.forEach((s, k) => {
      let text: string;
      if (teaser && k === 0) text = wordTeaser;
      else {
        const stage = stageOf(byId.get(s.clipId!)!.semantic);
        if (k === segments.length - 1 && (stage === null || FINAL_STAGES.includes(stage))) text = wordDone;
        else if (stage === "ingredients" && ["en", "hinglish"].includes(o.language ?? "en")) text = "Ingredients";
        else text = stepFmt.replace("{n}", String(++numbered));
      }
      const a = s.timelineStart! + 0.1, b = Math.min(s.timelineEnd! - 0.08, a + LABEL_MAX);
      if (b - a >= 0.4) captions.push({ start: round(a, 3), end: round(b, 3), text, words: wordsFor(text, a, b) });
    });
  }
  const tl = TimelineSchema.parse({ duration: round(eff, 3), bpm: audio.bpm, audioStart: start, style: style.id, segments, warnings, notes, captions, captionStyle: captions.length ? "bold" : "minimal" });
  assignEffects(tl.segments, slots, style, rng);
  assignTransitions(tl.segments, slots, style, rng);
  for (const s of tl.segments) s.id = rng.getrandbits(48).toString(16).padStart(12, "0");
  if (trimmed.length) tl.notes.push(`Only part of ${trimmed.length} long step${trimmed.length !== 1 ? "s" : ""} fits: ${trimmed.slice(0, 3).join(", ")}${trimmed.length > 3 ? "…" : ""}. Choose a longer Reel to show more.`);
  if (teaser) tl.notes.push("The Reel opens with a short look at the finished dish (the last clip), then shows the steps in order.");
  const fast = tl.segments.filter((s) => s.speed > 1.05).length;
  if (fast) tl.notes.push(`${fast} long step${fast !== 1 ? "s are" : " is"} sped up so the whole action still shows.`);
  return tl;
}

// ------------------------------------------------------------------ talking head (video/talking.py)
const MAX_PAUSE = 0.35, PAD = 0.08, MIN_SPAN = 0.4;
const FILLERS = new Set(["um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mmm", "mhm"]);
const cleanWord = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}_']/gu, "");
export interface Span { clipId: string; start: number; end: number; words: Word[] }

/** The stretches of real speech in one clip: fillers dropped, split where the speaker pauses too long. */
export function speechSpans(clipId: string, words: Word[], clipSeconds: number): Span[] {
  const kept = words.filter((w) => cleanWord(w.text) && !FILLERS.has(cleanWord(w.text)));
  const spans: Span[] = [];
  let cur: Word[] = [];
  for (const w of kept) {
    if (cur.length && w.start - cur[cur.length - 1].end > MAX_PAUSE) { spans.push({ clipId, start: cur[0].start, end: cur[cur.length - 1].end, words: cur }); cur = []; }
    cur.push(w);
  }
  if (cur.length) spans.push({ clipId, start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
  const out: Span[] = [];
  for (const sp of spans) {
    const a = Math.max(sp.start - PAD, 0), b = Math.min(sp.end + PAD, clipSeconds), last = out[out.length - 1];
    if (last && a < last.end) { last.end = b; last.words = [...last.words, ...sp.words]; }
    else if (b - a >= MIN_SPAN) out.push({ clipId, start: round(a, 3), end: round(b, 3), words: sp.words });
  }
  return out;
}

export function buildTalkingTimeline(clips: ClipInput[], transcripts: Map<string, Word[]>, maxSeconds: number, style = "social_native"): [Timeline, { spoken: number; cut: number; left_out: number; shots: number }] {
  const segments: Partial<Segment>[] = [], wordsTl: Word[] = [];
  let t = 0, spoken = 0, cut = 0, leftOut = 0;
  for (const c of clips) {
    const dur = c.analysis.metadata.duration, spans = speechSpans(c.clipId, transcripts.get(c.clipId) ?? [], dur);
    cut += Math.max(dur - spans.reduce((s, x) => s + x.end - x.start, 0), 0);
    for (const sp of spans) {
      const len = sp.end - sp.start;
      if (t + len > maxSeconds + 1e-6) { leftOut++; continue; }
      segments.push(seg({ clipId: c.clipId, video: c.name, sourceStart: sp.start, sourceEnd: sp.end, timelineStart: round(t, 3), timelineEnd: round(t + len, 3), effect: "none", volume: 1,
        reason: `${c.name}: speech ${fixed(sp.start, 1)}-${fixed(sp.end, 1)}s (pauses and filler words cut)` }));
      wordsTl.push(...sp.words.map((w) => ({ text: w.text, start: round(t + (w.start - sp.start), 3), end: round(t + (w.end - sp.start), 3) })));
      t += len; spoken += len;
    }
  }
  const tl = TimelineSchema.parse({ duration: round(t, 3), style, segments, captionStyle: "highlight", musicVolume: 0 });
  const cues = wordsTl.length ? groupWords(wordsTl, tl.duration) : [];
  if (cues.length) tl.captions = cuesToCaptions(cues);
  return [tl, { spoken: round(spoken, 1), cut: round(cut, 1), left_out: leftOut, shots: segments.length }];
}
