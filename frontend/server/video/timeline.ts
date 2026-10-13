import { fixed, g, round } from "@/server/core/py";
import { PyRandom } from "@/server/core/random";
import { addMotion } from "@/server/director/planMotion";
import type { AudioAnalysis } from "@/server/models/analysis";
import { meanEnergy, sectionAt } from "@/server/models/analysis";
import { motionBetween, semanticTerms, windowDefaults, windowLength, type ClipInput, type UsableWindow } from "@/server/models/clip";
import { parseTimeline, Segment, segLength, type Timeline, type Transition } from "@/server/models/timeline";
import type { EditingStyle } from "@/server/styles";
import * as footage from "./footage";

/** The editing engine: beats + clip analyses + style -> Timeline (was backend/app/video/timeline.py). Pure functions;
 * the same seed gives the same edit (Python's own random generator), a different seed another version. */

const MIN_SLOW_SPEED = 0.4, HIGH_ENERGY = 0.6, START_STEPS = 6, ACCENT_MIN_STRENGTH = 0.55, ACCENT_MIN_SHOT = 1.4, ACCENT_EDGE = 0.45, ACCENT_GAP = 0.8;
const ACCENT_FRAME = 1 / 24, ACCENT_SNAP_TOL = 0.12, ACCENT_SNAP_MIN = 0.6;
export const FLASH_MARGIN = 0.25;

export interface Slot { index: number; start: number; end: number; energy: number; onStrong: boolean }
export const slotLength = (s: Slot) => s.end - s.start;
type Row = Record<string, unknown> & { t: number; kind: string; effect: string };

const nearest = (xs: number[], t: number) => xs.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), xs[0]);

// ---------------------------------------------------------------- music window
export function chooseMusicWindow(audio: AudioAnalysis, duration: number, warnings: string[] = [], start: number | null = null): [number, number] {
  const usable = audio.duration - 0.05;
  if (usable < duration) {
    const eff = usable >= 1 ? Math.max(Math.trunc(usable), 1) : usable;
    warnings.push(`The song is only ${fixed(audio.duration, 1)}s long, shorter than the requested ${g(duration)}s; the Reel was shortened to ${g(eff)}s.`);
    return [0, eff];
  }
  if (start !== null) {
    const latest = round(audio.duration - duration - 0.05, 3);
    const chosen = Math.min(Math.max(start, 0), latest);
    if (chosen < start - 0.05) {
      warnings.push(`The part of the song you chose starts at ${fixed(start, 1)}s, but a ${g(duration)}s Reel needs to start by ${fixed(latest, 1)}s to fit inside the ${fixed(audio.duration, 1)}s song, so it starts at ${fixed(chosen, 1)}s.`);
    }
    return [round(chosen, 3), duration];
  }
  if (audio.duration - duration < 1 || !audio.beats.length) return [0, duration];
  const parts = rankMusicWindows(audio, duration, 1);
  return [parts.length ? parts[0].start : 0, duration];
}

function windowScore(audio: AudioAnalysis, b: number, duration: number, strong: Set<number>): [number, string[]] {
  const e = meanEnergy(audio, b, b + duration);
  let score = e;
  const why = [`${e >= 0.75 ? "very high" : e >= 0.55 ? "high" : e >= 0.35 ? "medium" : "low"} energy`];
  if (strong.has(b)) { score += 0.03; why.push("starts on a strong beat"); }
  const drop = audio.drops.find((d) => b <= d && d <= b + duration * 0.4);
  if (drop !== undefined) { score += 0.1; why.push(`the drop hits ${fixed(drop - b, 1)}s in`); }
  if (b < 0.3) { score += 0.05; why.push("the start of the song"); }
  const sec = audio.songSections.length ? sectionAt(audio, b + duration / 2) : null;
  if (sec) why.push(`mostly the ${sec.label}`);
  return [score, why];
}

export interface MusicWindow { start: number; end: number; score: number; reasons: string[] }

/** The best parts of the song for a `duration`-second Reel, best first, each clearly different from the others. */
export function rankMusicWindows(audio: AudioAnalysis, duration: number, k = 5): MusicWindow[] {
  if (audio.duration - duration < 1 || !audio.beats.length) return [{ start: 0, end: round(Math.min(duration, audio.duration), 3), score: 0, reasons: ["the whole song"] }];
  const candidates = audio.beats.filter((b) => b + duration <= audio.duration - 0.05);
  if (!candidates.includes(0)) candidates.unshift(0);
  const strong = new Set(audio.strongBeats);
  const scored = candidates.map((b, i) => { const [sc, why] = windowScore(audio, b, duration, strong); return { sc, i, b, why }; });
  scored.sort((x, y) => -x.sc - -y.sc || x.i - y.i);
  const out: MusicWindow[] = [];
  for (const { b, why, sc } of scored) {
    if (out.every((o) => Math.abs(b - o.start) >= duration * 0.5)) out.push({ start: round(b, 3), end: round(b + duration, 3), score: round(sc, 3), reasons: why });
    if (out.length >= k) break;
  }
  return out;
}

// ---------------------------------------------------------------- cut planning
export function gridBeats(audio: AudioAnalysis, start: number, duration: number): number[] {
  let rel = audio.beats.filter((b) => b - start >= -0.03 && b - start <= duration + 0.03).map((b) => round(b - start, 3));
  const period = audio.bpm > 0 ? 60 / audio.bpm : 0.5;
  if (rel.length < 0.6 * (duration / period) || rel.length < 3) rel = Array.from({ length: Math.trunc(duration / period) + 1 }, (_, i) => round(i * period, 3));
  rel = rel.map((b) => Math.max(b, 0));
  if (!rel.length || rel[0] > 0.05) rel.unshift(0);
  else rel[0] = 0;
  return [...new Set(rel)].sort((a, b) => a - b);
}

export function snapToAccent(t: number, accents: [number, number][], tol = ACCENT_SNAP_TOL, minStrength = ACCENT_SNAP_MIN): number {
  const near = accents.filter(([a, s]) => Math.abs(a - t) <= tol && s >= minStrength);
  return near.length ? near.reduce((x, p) => (Math.abs(p[0] - t) < Math.abs(x[0] - t) ? p : x), near[0])[0] : t;
}

/** Cut points on beats (snapped onto a real accent nearby); pace follows the music energy and the style. */
export function planSlots(audio: AudioAnalysis, audioStart: number, duration: number, style: EditingStyle): Slot[] {
  const beats = gridBeats(audio, audioStart, duration);
  const strongRel = new Set(audio.strongBeats.map((b) => round(b - audioStart, 3)));
  const dropsRel = audio.drops.map((d) => d - audioStart);
  const accentsRel = audio.accents.map((t, i) => [round(t - audioStart, 3), audio.accentStrengths[i]] as [number, number]);
  const period = audio.bpm > 0 ? 60 / audio.bpm : 0.5;
  const tAt = (i: number) => (i < beats.length ? beats[i] : beats[beats.length - 1] + (i - beats.length + 1) * period);
  const slots: Slot[] = [];
  let i = 0, t = 0;
  while (duration - t > 1e-3) {
    const e = meanEnergy(audio, audioStart + t, audioStart + Math.min(t + 2 * period, duration));
    let n = e >= HIGH_ENERGY ? style.cutBeatsHigh : style.cutBeatsLow;
    const sec = audio.songSections.length ? sectionAt(audio, audioStart + t) : null;
    if (sec && style.sectionPacing) {
      if (["intro", "outro", "bridge"].includes(sec.label)) n *= 2;
      else if (sec.label === "drop" && n >= 2) n = Math.floor(n / 2);
    }
    n = Math.max(n, 1);
    let bestJ = i + n, bestPen = 1;
    for (const j of [i + n, i + n - 1, i + n + 1]) {
      if (j <= i) continue;
      const length = tAt(j) - t;
      if (length < style.minSegment * 0.9 || length > style.maxSegment * 1.1) continue;
      const pen = (strongRel.has(round(tAt(j), 3)) ? 0 : 0.5) + Math.abs(j - (i + n)) * 0.25;
      if (pen < bestPen) { bestJ = j; bestPen = pen; }
    }
    let j = bestJ;
    while (tAt(j) - t < style.minSegment && j < i + 64) j++;
    let end = Math.min(tAt(j), duration);
    if (end < duration - 1e-6) {
      const snapped = snapToAccent(end, accentsRel);
      const lim = Math.max(style.minSegment * 0.75, 0.2);
      if (snapped - t >= lim && duration - snapped >= lim) end = snapped;
    }
    if (duration - end < style.minSegment) end = duration;
    const onStrong = strongRel.has(round(t, 3)) || dropsRel.some((d) => Math.abs(t - d) < 0.15);
    slots.push({ index: slots.length, start: round(t, 3), end: round(end, 3), energy: meanEnergy(audio, audioStart + t, audioStart + end), onStrong });
    t = end;
    i = j;
  }
  slots[slots.length - 1].end = round(duration, 3);
  return slots;
}

function bestStart(inner: number[], refDuration: number, duration: number): number {
  const bounds = [0, ...inner, refDuration];
  const shots = bounds.slice(1).map((b, k) => b - bounds[k]).sort((a, b) => a - b);
  const typical = shots[Math.floor(shots.length / 2)];
  const score = (st: number) => {
    const cs = inner.filter((c) => st < c && c < st + duration - 0.2).map((c) => c - st);
    const a = [0, ...cs], b = [...cs, duration];
    const lens = a.map((x, k) => b[k] - x);
    return lens.reduce((s, x) => s + Math.abs(Math.log(Math.max(x, 0.05) / typical)), 0) / lens.length;
  };
  const starts = [0, ...inner.filter((c) => c <= refDuration - duration)];
  return starts.reduce((best, st) => { const a = round(score(st), 3), b = round(score(best), 3); return a < b || (a === b && st < best) ? st : best; }, starts[0]);
}

function windowOffset(refCuts: number[], refDuration: number, duration: number): number {
  const inner = refCuts.filter((c) => c > 0 && c < refDuration);
  return refDuration > duration * 1.2 && inner.length ? bestStart(inner, refDuration, duration) : 0;
}

function refCutsOver(refCuts: number[], refDuration: number, duration: number): number[] {
  const inner = refCuts.filter((c) => c > 0 && c < refDuration);
  if (refDuration > duration * 1.2 && inner.length) {
    const best = bestStart(inner, refDuration, duration);
    return inner.filter((c) => best < c && c < best + duration - 0.2).map((c) => round(c - best, 3));
  }
  const pattern = [...inner, refDuration];
  const out: number[] = [];
  for (let offset = 0; offset < duration && pattern.length; offset += refDuration) {
    for (const c of pattern) {
      const t = offset + c;
      if (t >= duration - 0.2) return out;
      out.push(round(t, 3));
    }
  }
  return out;
}

/** [where in the reference the copied stretch starts, its cut times from there]. */
export const referenceWindow = (refCuts: number[], refDuration: number, duration: number): [number, number[]] =>
  [windowOffset(refCuts, refDuration, duration), refCutsOver(refCuts, refDuration, duration)];
export const referenceCuts = (refCuts: number[], refDuration: number, duration: number) => refCutsOver(refCuts, refDuration, duration);

/** "Make it like this Reel": the reference's own cut timing at its real speed; on-beat references snap to this song. */
export function templateSlots(audio: AudioAnalysis, audioStart: number, duration: number, refCuts: number[], refDuration: number, onBeat: number | null,
                              style: EditingStyle, sameSong = false): Slot[] {
  if (!refCuts.length || refDuration <= 0) return planSlots(audio, audioStart, duration, style);
  const cuts = referenceCuts(refCuts, refDuration, duration);
  if (!cuts.length) return planSlots(audio, audioStart, duration, style);
  const beats = audio.beats.filter((b) => audioStart <= b && b <= audioStart + duration).map((b) => b - audioStart);
  const period = audio.bpm > 0 ? 60 / audio.bpm : 0.5;
  const snap = onBeat !== null && onBeat >= 0.5 && beats.length >= 2 && !sameSong;
  const strongRel = new Set(audio.strongBeats.map((b) => round(b - audioStart, 3)));
  const out: number[] = [];
  for (let c of cuts) {
    if (snap) {
      const near = nearest(beats, c);
      if (Math.abs(near - c) <= period * 0.5) c = near;
    }
    if ((!out.length && c >= 0.2) || (out.length && c - out[out.length - 1] >= 0.2)) out.push(round(c, 3));
  }
  const bounds = [0, ...out, round(duration, 3)];
  if (bounds[bounds.length - 1] - bounds[bounds.length - 2] < 0.2 && bounds.length > 2) bounds.splice(bounds.length - 2, 1);
  return bounds.slice(0, -1).map((a, k) => ({ index: k, start: round(a, 3), end: round(bounds[k + 1], 3), energy: meanEnergy(audio, audioStart + a, audioStart + bounds[k + 1]), onStrong: strongRel.has(round(a, 3)) }));
}

// ---------------------------------------------------------------- selection
const intersection = (a: number[], b: number[]) => (!a.length || !b.length || a.length !== b.length ? 0 : a.reduce((s, x, i) => s + Math.min(x, b[i]), 0));

export function targetMotion(energy: number, preference: number): number {
  if (preference >= 0) return Math.min(Math.max(0.4 + 0.6 * preference * (energy - 0.5) * 2, 0.05), 0.95);
  return 0.2 + 0.2 * energy * (1 + preference);
}

/** The clip's usable windows (nothing usable: the whole clip as one low-trust window). */
export function windowsOf(clip: ClipInput): UsableWindow[] {
  const a = clip.analysis;
  if (a.windows.length) return a.windows;
  return [windowDefaults({ start: 0, end: a.metadata.duration, quality: a.qualityScore * 0.5, motion: a.motionScore, brightness: a.brightnessScore, sharpness: a.sharpnessScore })];
}

const overlap = (a0: number, a1: number, ranges: [number, number][]) => Math.min(ranges.reduce((s, [r0, r1]) => s + Math.max(0, Math.min(a1, r1) - Math.max(a0, r0)), 0) / Math.max(a1 - a0, 1e-6), 1);

const STOP = new Set(["the", "and", "for", "with", "this", "that", "from", "your", "about", "reel", "video", "make", "our", "are", "you"]);
/** Meaningful words of the project brief (stop-words dropped). */
export const briefTerms = (brief: string) => new Set((brief.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)));

/** 0..1: how much of the brief the clip's visible content matches. */
export function relevance(clip: ClipInput, terms: Set<string>): number {
  if (!terms.size || !clip.semantic) return 0;
  const ct = semanticTerms(clip.semantic);
  const hits = [...terms].filter((t) => ct.has(t)).length;
  return Math.min((hits / Math.max(terms.size, 1)) * 2, 1);
}

interface Cand { clip: ClipInput; window: UsableWindow; start: number; end: number; score: number }

export async function selectSegments(slots: Slot[], clips: ClipInput[], style: EditingStyle, rng: PyRandom, orderHint: Record<string, number> | null = null,
                                     warnings: string[] = [], brief = ""): Promise<Segment[]> {
  const intel = await import("@/server/director/intelligence");
  const usable = clips.filter((c) => c.analysis.usable);
  const pool = usable.length ? usable : clips;
  if (!usable.length) warnings.push("No clip passed the quality checks; using the best available footage.");
  const hooks = intel.rankHooks(pool, brief);
  const hero = slots.length >= 3 ? intel.findHero(pool) : null;
  const peak = hero ? intel.heroSlot(slots, HIGH_ENERGY) : null;
  const hookSigs = pool.flatMap((c) => windowsOf(c).map((w) => w.signature));
  const used: Record<string, [number, number][]> = Object.fromEntries(pool.map((c) => [c.clipId, []]));
  const uses: Record<string, number> = Object.fromEntries(pool.map((c) => [c.clipId, 0]));
  const segments: Segment[] = [];
  let prev: [ClipInput, UsableWindow] | null = null;
  const nSlots = slots.length;
  let reusedWarned = false, slowWarned = false;
  const terms = briefTerms(brief);
  for (const slot of slots) {
    const L = slotLength(slot);
    const isFirst = slot.index === 0, isLast = slot.index === nSlots - 1;
    let speed = 1;
    const wantsSlow = rng.random() < style.slowMotionChance && slot.energy < 0.75 && L >= 0.8;
    if ((isLast && style.closing === "reveal") || wantsSlow) speed = style.slowMotionSpeed;
    let span = L * speed;
    let tgt = targetMotion(slot.energy, style.motionPreference);
    if (isFirst && style.opening === "establishing") tgt = 0.2;
    let cands: Cand[] = [];
    for (const clip of pool) {
      for (const w of windowsOf(clip)) {
        const room = windowLength(w) - span;
        if (room < -1e-6) continue;
        const steps = Math.max(1, Math.min(START_STEPS, Math.trunc(room / 0.25) + 1));
        for (let k = 0; k < steps; k++) {
          const a = w.start + (steps > 1 ? (room * k) / (steps - 1) : Math.min(room, 0.1) / 2);
          cands.push({ clip, window: w, start: a, end: a + span, score: 0 });
        }
      }
    }
    const fresh = cands.filter((c) => footage.isFresh(c.start, c.end, used[c.clip.clipId]));
    let replay = false;
    if (fresh.length) cands = fresh;
    else {
      const spare = pool.map((c) => [c, footage.longestFree(windowsOf(c), used[c.clipId])] as const)
        .filter((x): x is readonly [ClipInput, footage.Span] => x[1] !== null && x[1][1] - x[1][0] >= L * footage.MIN_SLOW - 1e-6);
      if (spare.length) {
        const [clip, [a, b, w]] = spare.reduce((best, x) => {
          const lx = x[1][1] - x[1][0], lb = best[1][1] - best[1][0];
          return lx > lb || (lx === lb && x[1][2].quality > best[1][2].quality) ? x : best;
        }, spare[0]);
        speed = Math.min(speed, Math.max((b - a) / L, footage.MIN_SLOW));
        span = L * speed;
        cands = [{ clip, window: w, start: a, end: a + span, score: 0 }];
        if (!slowWarned) { warnings.push("Some shots play in slow motion so no moment has to be shown twice."); slowWarned = true; }
      } else if (cands.length) {
        replay = true;
      } else {
        const all = pool.flatMap((c) => windowsOf(c).map((w) => [c, w] as const));
        const [clip, w] = all.reduce((best, x) => (windowLength(x[1]) > windowLength(best[1]) ? x : best), all[0]);
        speed = Math.max(windowLength(w) / L, MIN_SLOW_SPEED);
        span = Math.min(L * speed, windowLength(w));
        cands = [{ clip, window: w, start: w.start, end: w.start + span, score: 0 }];
        warnings.push("Some shots were longer than the available footage; slow motion/freeze was used.");
      }
    }
    for (const c of cands) {
      const w = c.window, clip = c.clip;
      const motion = motionBetween(w, c.start, c.end);
      let score = 0.4 * w.quality + 0.3 * (1 - Math.abs(motion - tgt));
      score += 0.05 * clip.analysis.qualityScore;
      if (uses[clip.clipId] === 0) score += 0.2;
      score -= 0.12 * uses[clip.clipId];
      score -= 0.7 * overlap(c.start, c.end, used[clip.clipId]);
      if (prev) {
        score -= 0.3 * intersection(w.signature, prev[1].signature);
        if (prev[0].clipId === clip.clipId) score -= 0.35;
      }
      if (style.preferLandscape && clip.analysis.metadata.orientation === "landscape") score += 0.1;
      if (w.face) score += 0.04;
      if (clip.semantic) score += 0.1 * clip.semantic.importance + 0.25 * relevance(clip, terms);
      if (isFirst) {
        score += 0.15 * w.quality + (style.opening === "establishing" ? 0.15 * (1 - Math.abs(motion - 0.2)) : 0.1 * motion);
        if (style.opening !== "establishing") score += style.hookPriority * intel.hookScore(intel.hookParts(clip, w, terms, hookSigs));
      }
      if (style.subjectPriority) score += style.subjectPriority * intel.subjectValue(clip, w);
      if (style.shakeTolerance) score += 0.1 * style.shakeTolerance * clip.analysis.shakeScore;
      if (prev) score += 0.08 * intel.motionMatch(prev[1], w);
      if (hero && peak !== null && clip.clipId === hero.clipId) {
        const onHero = overlap(c.start, c.end, [[hero.start, hero.end]]);
        if (slot.index < peak) score -= 0.45 * onHero;
        else if (slot.index === peak) score += 0.4 * onHero;
      }
      if (slot.index === peak) score += 0.2 * intel.heroValue(clip, w, c.start, c.end);
      if (isLast && style.closing === "reveal") score += 0.3 * w.sharpness * Math.max(w.brightness, 0.2) + 0.1 * (1 - motion);
      if (orderHint && clip.clipId in orderHint) score += 0.15 * (1 - Math.abs(slot.index / Math.max(nSlots - 1, 1) - orderHint[clip.clipId]));
      score += rng.uniform(-0.03, 0.03);
      c.score = score;
    }
    const chosen = cands.reduce((best, c) => (c.score > best.score ? c : best), cands[0]);
    if (replay) {
      speed = footage.REPLAY_SPEED;
      chosen.end = chosen.start + L * speed;
      if (!reusedWarned) {
        warnings.push("There is not enough different good footage for this length, so a moment is shown again as a slow-motion replay. Add more clips or choose a shorter Reel to avoid it.");
        reusedWarned = true;
      }
    }
    const prevW: UsableWindow | null = prev ? prev[1] : null;
    const isHero = slot.index === peak && hero !== null && chosen.clip.clipId === hero.clipId && overlap(chosen.start, chosen.end, [[hero.start, hero.end]]) > 0.3;
    const { direction } = await import("@/server/models/clip");
    const reason = intel.shotReason({
      index: slot.index, n: nSlots, clipName: chosen.clip.name, firstUse: uses[chosen.clip.clipId] === 0,
      hook: isFirst ? hooks.find((h) => h.clipId === chosen.clip.clipId) ?? null : null, hero: isHero, dropAt: slot.onStrong ? slot.start : null,
      match: intel.motionMatch(prevW, chosen.window), energy: slot.energy, quality: chosen.window.quality, slow: speed < 0.95 && !replay,
      relevant: relevance(chosen.clip, terms) >= 0.5, prevDirection: prevW ? direction(prevW) : "still",
    });
    used[chosen.clip.clipId].push([chosen.start, chosen.end]);
    uses[chosen.clip.clipId]++;
    prev = [chosen.clip, chosen.window];
    segments.push(Segment.parse({
      clipId: chosen.clip.clipId, video: chosen.clip.name, sourceStart: round(chosen.start, 3), sourceEnd: round(chosen.end, 3), timelineStart: slot.start,
      timelineEnd: slot.end, speed: round(speed, 3), focusX: chosen.window.focusX, focusY: chosen.window.focusY, focusSource: chosen.window.focusSource, reason,
    }));
  }
  return segments;
}

// ---------------------------------------------------------------- effects / transitions
function weightedChoice(weights: Record<string, number>, rng: PyRandom): string {
  const items = Object.entries(weights).filter(([, w]) => w > 0);
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rng.uniform(0, total);
  for (const [k, w] of items) {
    r -= w;
    if (r <= 0) return k;
  }
  return items[items.length - 1][0];
}

export function assignEffects(segments: Segment[], slots: Slot[], style: EditingStyle, rng: PyRandom) {
  let prev = "none";
  segments.forEach((seg, i) => {
    const slot = slots[i];
    if (!slot) return;
    const weights = { ...style.effects };
    if (slot.onStrong && slot.energy >= HIGH_ENERGY && "punch" in weights) weights.punch *= 2.5;
    if (prev in weights && prev !== "none") weights[prev] *= 0.4;
    seg.effect = weightedChoice(weights, rng);
    prev = seg.effect;
  });
}

/** How each segment is entered. Most boundaries stay hard cuts. */
export function assignTransitions(segments: Segment[], slots: Slot[], style: EditingStyle, rng: PyRandom) {
  const boundaries = Math.max(segments.length - 1, 1);
  let nonCut = 0, prevType = "cut";
  for (let i = 1; i < segments.length; i++) {
    const e = slots[i].energy;
    const weights: Record<string, number> = {};
    for (const [name, w0] of Object.entries(style.transitions)) {
      let w = w0;
      if (["flash", "zoom", "slide", "speed_ramp"].includes(name)) w *= 0.5 + e;
      else if (["fade", "dissolve", "blur"].includes(name)) w *= 1.5 - e;
      weights[name] = w;
    }
    if (prevType !== "cut") {
      weights[prevType] = 0;
      weights.cut = (weights.cut ?? 0) + 0.5;
    }
    let kind = weightedChoice(weights, rng);
    const dur = Math.min(style.transitionDuration, 0.45 * segments[i - 1].timelineEnd - 0.45 * segments[i - 1].timelineStart, 0.45 * segLength(segments[i]));
    if (kind !== "cut" && (dur < 0.06 || (nonCut + 1) / boundaries > style.maxTransitionRatio)) kind = "cut";
    if (kind === "cut") segments[i].transitionIn = { type: "cut", duration: 0 };
    else {
      nonCut++;
      segments[i].transitionIn = { type: kind, duration: round(dur, 3) };
    }
    prevType = kind;
  }
}

/** Answer the song's strong hits inside a long shot: split at the hit, the footage carrying on, a punch after it. */
export function addAccentHits(segments: Segment[], audio: AudioAnalysis, audioStart: number, closingReveal = false): number {
  const hits = audio.accents.map((t, i) => [t - audioStart, audio.accentStrengths[i]] as const).filter(([, s]) => s >= ACCENT_MIN_STRENGTH);
  if (!hits.length) return 0;
  const out: Segment[] = [];
  let added = 0;
  segments.forEach((seg, idx) => {
    const length = segLength(seg);
    const skip = length < ACCENT_MIN_SHOT || Math.abs(seg.speed - 1) > 0.05 || (closingReveal && idx === segments.length - 1);
    const picked: number[] = [];
    if (!skip) {
      const inside = hits.filter(([t]) => seg.timelineStart + ACCENT_EDGE <= t && t <= seg.timelineEnd - ACCENT_EDGE);
      for (const [t] of inside.map((x, i) => [x, i] as const).sort((a, b) => b[0][1] - a[0][1] || a[1] - b[1]).map(([x]) => x)) {
        if (picked.length >= (length < 2 ? 1 : 2)) break;
        if (picked.every((p) => Math.abs(t - p) >= ACCENT_GAP)) picked.push(t);
      }
    }
    const cuts = [...new Set(picked.map((t) => round(round(t / ACCENT_FRAME) * ACCENT_FRAME, 3)))].sort((a, b) => a - b).filter((c) => seg.timelineStart + 0.2 < c && c < seg.timelineEnd - 0.2);
    if (!cuts.length) { out.push(seg); return; }
    const edges = [seg.timelineStart, ...cuts, seg.timelineEnd];
    for (let k = 0; k + 1 < edges.length; k++) {
      const a = edges[k], b = edges[k + 1];
      const piece: Segment = structuredClone(seg);
      piece.timelineStart = a;
      piece.timelineEnd = b;
      piece.sourceStart = k === 0 ? seg.sourceStart : round(seg.sourceStart + (a - seg.timelineStart) * seg.speed, 3);
      piece.sourceEnd = k === edges.length - 2 ? seg.sourceEnd : round(seg.sourceStart + (b - seg.timelineStart) * seg.speed, 3);
      if (k > 0) {
        piece.effect = "punch";
        piece.transitionIn = { type: "cut", duration: 0 };
        piece.reason = `${seg.video}: A quick punch on a strong hit in the music; the same footage carries on, nothing repeats.`;
      }
      out.push(piece);
    }
    added += cuts.length;
  });
  segments.splice(0, segments.length, ...out);
  return added;
}

/** Seconds of footage the selector can actually draw from (usable windows only). */
export function usableFootageSeconds(clips: ClipInput[]): number {
  const usable = clips.filter((c) => c.analysis.usable);
  const pool = usable.length ? usable : clips;
  return pool.reduce((s, c) => s + (c.analysis.windows.reduce((x, w) => x + windowLength(w), 0) || c.analysis.metadata.duration), 0);
}

// ---------------------------------------------------------------- entry point
export interface BuildOptions {
  seed?: number; orderHint?: Record<string, number> | null; brief?: string; audioStart?: number | null;
  template?: { cuts?: number[]; seconds?: number; on_beat_share?: number | null; use_audio?: boolean } | null; beatPlan?: boolean; everyBeat?: boolean; minClip?: number | null;
}

export async function buildTimeline(audio: AudioAnalysis, clips: ClipInput[], duration: number, style: EditingStyle, o: BuildOptions = {}): Promise<Timeline> {
  if (!clips.length) throw new Error("At least one clip is required to build a timeline.");
  const rng = new PyRandom(o.seed ?? 0);
  const warnings: string[] = [];
  const [audioStart, eff] = chooseMusicWindow(audio, duration, warnings, o.audioStart ?? null);
  const fs = usableFootageSeconds(clips);
  if (fs < eff * 1.15) warnings.push(`You provided about ${fixed(fs, 0)}s of usable footage for a ${g(eff)}s Reel, so some moments will repeat. Add more clips or choose a shorter duration.`);
  let planRows: Row[] = [];
  let slots: Slot[];
  if (o.template?.cuts?.length) {
    slots = templateSlots(audio, audioStart, eff, o.template.cuts, o.template.seconds || eff, o.template.on_beat_share ?? null, style, Boolean(o.template.use_audio));
  } else if (o.beatPlan) {
    const { cutPlan } = await import("@/server/audio/beatmap");
    const moments = clips.reduce((s, c) => s + Math.max(1, Math.trunc(usableFootageSeconds([c]) / (o.everyBeat ? 0.6 : 1.6))), 0);
    planRows = cutPlan(audio, null, null, audioStart, audioStart + eff, Math.max(moments, 3), Boolean(o.everyBeat), o.minClip || undefined) as Row[];
    slots = planRowsToSlots(audio, audioStart, eff, planRows);
  } else {
    slots = planSlots(audio, audioStart, eff, style);
  }
  const segments = await selectSegments(slots, clips, style, rng, o.orderHint ?? null, warnings, o.brief ?? "");
  assignEffects(segments, slots, style, rng);
  assignTransitions(segments, slots, style, rng);
  let motionNotes: string[] = [];
  let accentsAdded = 0;
  if (planRows.length) {
    const seconds = Object.fromEntries(clips.map((c) => [c.clipId, c.analysis.metadata.duration]));
    applyPlan(segments, planRows, audioStart, seconds);
    motionNotes = addMotion(segments, audio, audioStart, seconds);
  } else if (style.accentHits) {
    accentsAdded = addAccentHits(segments, audio, audioStart, style.closing === "reveal");
  }
  for (const seg of segments) seg.id = rng.getrandbits(48).toString(16).padStart(12, "0");
  return parseTimeline({
    duration: round(eff, 3), bpm: audio.bpm, audioStart, style: style.id, segments, warnings,
    notes: [...(accentsAdded ? [`The picture answers ${accentsAdded} strong hits in the music (a quick punch on the beat).`] : []), ...motionNotes],
  });
}

/** The beat map plan's shots (song time) as slots in Reel time. */
export function planRowsToSlots(audio: AudioAnalysis, audioStart: number, duration: number, rows: Row[]): Slot[] {
  const cuts = rows.filter((r) => r.kind === "cut" && r.transition !== "fade_in").map((r) => round(r.t - audioStart, 3));
  const bounds = [0, ...cuts.filter((c) => c >= 0.2 && c <= duration - 0.2), round(duration, 3)];
  const strong = new Set(audio.strongBeats.map((b) => round(b - audioStart, 3)));
  return bounds.slice(0, -1).map((a, k) => ({ index: k, start: a, end: bounds[k + 1], energy: meanEnergy(audio, audioStart + a, audioStart + bounds[k + 1]), onStrong: strong.has(round(a, 3)) }));
}

/** Each shot gets the plan's effect and way in; a hard hit inside a shot gets a flash. The plan's shots are locked. */
export function applyPlan(segments: Segment[], rows: Row[], audioStart: number, clipSeconds: Record<string, number> = {}) {
  const shots = rows.filter((r) => r.kind === "cut");
  for (const seg of segments) {
    const t = seg.timelineStart + audioStart;
    const row = seg.timelineStart > 0.01 ? shots.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best), shots[0]) : shots[0];
    seg.effect = row.effect !== "none" ? row.effect : row.transition === "fade_in" ? seg.effect : "none";
    if (seg.timelineStart > 0.01 && !["fade_in", "cut", ""].includes(row.transition as string)) seg.transitionIn = { type: row.transition as string, duration: Number(row.tdur || 0.2) };
    else if (seg.timelineStart > 0.01) seg.transitionIn = { type: "cut", duration: 0 };
    seg.locked = true;
  }
  landOnBeat(segments, clipSeconds);
  for (const r of rows) {
    const at = round(r.t - audioStart, 3);
    if (r.kind === "ramp") {
      const k = segments.findIndex((s) => s.timelineStart > at);
      if (k >= 0 && segments[k].transitionIn.type === "cut") segments[k].transitionIn = { type: "speed_ramp", duration: round(Math.max(segments[k].timelineStart - at, 0.12), 3) };
    } else if (r.kind === "zoom") {
      let k = -1;
      for (let j = segments.length - 1; j >= 0; j--) if (segments[j].timelineStart < at) { k = j; break; }
      if (k >= 0 && ["none", "zoom_in", "zoom_pulse"].includes(segments[k].effect)) segments[k].effect = "punch";
    }
  }
  for (const r of rows) {
    if (r.kind !== "flash") continue;
    const at = round(r.t - audioStart, 3);
    const i = segments.findIndex((s) => s.timelineStart + FLASH_MARGIN <= at && at <= s.timelineEnd - FLASH_MARGIN);
    if (i < 0) continue;
    const seg = segments[i];
    const first: Segment = structuredClone(seg), second: Segment = structuredClone(seg);
    first.timelineEnd = at;
    first.sourceEnd = round(seg.sourceStart + (at - seg.timelineStart) * seg.speed, 3);
    second.timelineStart = at;
    second.sourceStart = first.sourceEnd;
    second.effect = "beat_flash";
    second.transitionIn = { type: "cut", duration: 0 };
    second.id = `${seg.id}f`;
    segments.splice(i, 1, first, second);
  }
}

/** Move each blending transition's start earlier so it lands on the beat (a flash peaks on it). */
export function landOnBeat(segments: Segment[], clipSeconds: Record<string, number>) {
  for (let i = 1; i < segments.length; i++) {
    const prev = segments[i - 1], seg = segments[i];
    const t: Transition = seg.transitionIn;
    if (t.type === "cut" || t.type === "speed_ramp" || t.duration <= 0) continue;
    const flash = t.type === "flash";
    const prevLen = segLength(prev), segLen = segLength(seg);
    const want = Math.min(t.duration, 0.4 * segLen) / (flash ? 2 : 1);
    const roomPrev = (0.4 * prevLen) / (flash ? 1.8 : 1.4) - 0.005;
    const spd = Math.max(seg.speed, 0.01);
    const after = ((clipSeconds[seg.clipId] ?? 1e9) - seg.sourceEnd) / spd;
    const before = seg.sourceStart / spd;
    const fromBefore = after < Math.min(want, roomPrev) && before > after;
    const shift = round(Math.max(0, Math.min(want, roomPrev, fromBefore ? before : after)), 3);
    if (shift < 0.06) { seg.transitionIn = { type: "cut", duration: 0 }; continue; }
    if (shift < want) seg.transitionIn = { type: t.type, duration: round(t.type === "flash" ? shift * 2 : shift, 3) };
    prev.timelineEnd = round(prev.timelineEnd - shift, 3);
    prev.sourceEnd = round(prev.sourceEnd - shift * prev.speed, 3);
    seg.timelineStart = round(seg.timelineStart - shift, 3);
    if (fromBefore) seg.sourceStart = round(seg.sourceStart - shift * seg.speed, 3);
    else seg.sourceEnd = round(seg.sourceEnd + shift * seg.speed, 3);
  }
}

export const cutPoints = (tl: Timeline) => tl.segments.slice(1).map((s) => s.timelineStart);

/** Each cut as [start, landing] (a transition may start on the beat, or start early and land on it). */
export function cutMoments(tl: Timeline): [number, number][] {
  return tl.segments.slice(1).map((s) => {
    const t = s.transitionIn;
    if (t.type === "cut" || t.type === "speed_ramp" || t.duration <= 0) return [s.timelineStart, s.timelineStart];
    return [s.timelineStart, round(s.timelineStart + (t.type === "flash" ? t.duration / 2 : t.duration), 4)];
  });
}

export const beatDistance = (moment: [number, number], points: number[]) => (points.length ? Math.min(...moment.map((m) => Math.min(...points.map((b) => Math.abs(m - b))))) : 0);
