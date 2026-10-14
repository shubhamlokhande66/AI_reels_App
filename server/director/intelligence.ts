import { fixed, round } from "@/server/core/py";
import { direction, motionBetween, windowLength, type ClipInput, type UsableWindow } from "@/server/models/clip";
import { briefTerms, relevance, windowsOf, type Slot } from "@/server/video/timeline";

/** Creative judgement as plain, deterministic scoring (was backend/app/director/intelligence.py): which opening
 * hooks hardest, which moment deserves the music's biggest hit, which shots flow into each other, and a reason. */

export const HOOK_CANDIDATES = 3, HERO_SPAN = 1.5, HERO_MARGIN = 1.08;
const HOOK_WEIGHTS: Record<string, number> = { impact: 0.3, motion: 0.15, clarity: 0.2, curiosity: 0.15, novelty: 0.1, relevance: 0.1 };
const HOOK_WORDS: Record<string, string> = {
  impact: "sharp, well-lit picture", motion: "movement from the first frame", clarity: "a clear subject", curiosity: "a striking subject",
  novelty: "looks unlike the rest", relevance: "matches the brief",
};

export interface HookCandidate { clipId: string; name: string; start: number; end: number; score: number; parts: Record<string, number> }

export function hookReason(h: HookCandidate): string {
  return Object.entries(h.parts).map(([k, v]) => [k, v * HOOK_WEIGHTS[k]] as const).map((x, i) => [x, i] as const)
    .sort((a, b) => b[0][1] - a[0][1] || a[1] - b[1]).slice(0, 2).map(([[k]]) => HOOK_WORDS[k]).join(" and ");
}

export const hookDoc = (h: HookCandidate) => ({
  clipId: h.clipId, asset: h.name, start: round(h.start, 2), end: round(h.end, 2), score: round(h.score, 3),
  parts: Object.fromEntries(Object.entries(h.parts).map(([k, v]) => [k, round(v, 3)])), reason: hookReason(h),
});

export interface HeroMoment { clipId: string; name: string; start: number; end: number; score: number }
export const heroDoc = (h: HeroMoment) => ({ clipId: h.clipId, asset: h.name, start: round(h.start, 2), end: round(h.end, 2), score: round(h.score, 3) });

function distinct(sig: number[], others: number[][]): number {
  const os = others.filter((o) => o.length && o.length === sig.length);
  if (!sig.length || !os.length) return 0.5;
  const meanSig = sig.map((_, k) => os.reduce((s, o) => s + o[k], 0) / os.length);
  return Math.min(Math.max(1 - sig.reduce((s, a, k) => s + Math.min(a, meanSig[k]), 0), 0), 1);
}

export function hookParts(clip: ClipInput, w: UsableWindow, terms: Set<string>, others: number[][]): Record<string, number> {
  const sem = clip.semantic;
  let clarity = w.face ? 1 : w.focusSource === "subject" || w.focusSource === "motion" ? 0.75 : 0.45;
  if (w.shotSize !== "unknown") clarity = (0.5 * clarity + 0.3 * w.subject + 0.2 * w.composition) * (1 - 0.6 * w.empty);
  const curiosity = sem ? 0.6 * sem.importance + (sem.hookCandidate ? 0.4 : 0) : 0.4;
  return {
    impact: 0.6 * w.quality + 0.4 * w.sharpness, motion: 1 - Math.abs(w.motion - 0.6) / 0.6, clarity, curiosity: Math.min(curiosity, 1),
    novelty: distinct(w.signature, others), relevance: relevance(clip, terms),
  };
}

export const hookScore = (parts: Record<string, number>) => Object.entries(parts).reduce((s, [k, v]) => s + HOOK_WEIGHTS[k] * Math.min(Math.max(v, 0), 1), 0);

/** The k strongest possible openings, at most one per clip, best first. */
export function rankHooks(clips: ClipInput[], brief = "", k = HOOK_CANDIDATES): HookCandidate[] {
  const pool = clips.filter((c) => c.analysis.usable).length ? clips.filter((c) => c.analysis.usable) : clips;
  const terms = briefTerms(brief);
  const sigs = pool.flatMap((c) => windowsOf(c).map((w) => w.signature));
  const best = new Map<string, HookCandidate>();
  for (const c of pool) {
    for (const w of windowsOf(c)) {
      const parts = hookParts(c, w, terms, sigs.filter((s) => s !== w.signature));
      const s = hookScore(parts);
      const cur = best.get(c.clipId);
      if (!cur || s > cur.score) best.set(c.clipId, { clipId: c.clipId, name: c.name, start: w.start, end: w.end, score: s, parts });
    }
  }
  return [...best.values()].map((h, i) => [h, i] as const).sort((a, b) => b[0].score - a[0].score || a[1] - b[1]).map(([h]) => h).slice(0, k);
}

const PRODUCT_CATEGORIES = new Set(["product", "jewelry", "fashion", "beauty", "food"]);

export function subjectValue(clip: ClipInput, w: UsableWindow): number {
  const sem = clip.semantic;
  let framed = w.face ? 1 : w.focusSource === "subject" || w.focusSource === "motion" ? 0.7 : 0.2;
  if (w.shotSize !== "unknown") framed = 0.5 * framed + 0.5 * Math.max(w.subject, ({ close: 0.8, medium: 0.5 } as Record<string, number>)[w.shotSize] ?? 0.2);
  const product = sem && PRODUCT_CATEGORIES.has(sem.category) ? 1 : sem === null ? 0.4 : 0.1;
  return 0.5 * framed + 0.3 * product + 0.2 * w.sharpness;
}

export function heroValue(clip: ClipInput, w: UsableWindow, a: number, b: number): number {
  const imp = clip.semantic ? clip.semantic.importance : 0.5;
  return 0.5 * w.quality + 0.3 * motionBetween(w, a, b) + 0.2 * imp;
}

/** The single strongest moment of all the footage: kept back for the music's biggest hit. */
export function findHero(clips: ClipInput[], span = HERO_SPAN): HeroMoment | null {
  const pool = clips.filter((c) => c.analysis.usable).length ? clips.filter((c) => c.analysis.usable) : clips;
  let best: HeroMoment | null = null;
  const perWindow: number[] = [];
  for (const c of pool) {
    for (const w of windowsOf(c)) {
      if (windowLength(w) < span * 0.6) continue;
      const length = Math.min(span, windowLength(w));
      const steps = Math.max(Math.trunc((windowLength(w) - length) / 0.25), 0) + 1;
      let top = 0;
      for (let i = 0; i < steps; i++) {
        const a = w.start + i * 0.25;
        const v = heroValue(c, w, a, a + length);
        top = Math.max(top, v);
        if (!best || v > best.score) best = { clipId: c.clipId, name: c.name, start: round(a, 3), end: round(a + length, 3), score: v };
      }
      perWindow.push(top);
    }
  }
  if (!best || perWindow.length < 2) return best;
  const typical = [...perWindow].sort((a, b) => a - b)[Math.floor(perWindow.length / 2)];
  return best.score >= typical * HERO_MARGIN ? best : null;
}

/** The slot the hero moment belongs to: the most intense one in the middle of the Reel (null when there is no peak). */
export function heroSlot(slots: Slot[], highEnergy = 0.6): number | null {
  const middle = slots.slice(1, -1);
  if (!middle.length) return null;
  const total = slots[slots.length - 1].end || 1;
  const val = (s: Slot) => s.energy + (s.onStrong ? 0.25 : 0) - 0.15 * Math.abs(s.start / total - 0.6);
  const best = middle.reduce((x, s) => (val(s) > val(x) ? s : x), middle[0]);
  return best.energy >= highEnergy || best.onStrong ? best.index : null;
}

/** +1 when the next shot continues the previous movement, -1 when it reverses it, 0 otherwise. */
export function motionMatch(prev: UsableWindow | null, w: UsableWindow): number {
  if (!prev) return 0;
  const a = direction(prev), b = direction(w);
  if (a === "still" || b === "still") return 0;
  if (a === b) return 1;
  const pair = [a, b].sort().join(",");
  return pair === "left,right" || pair === "down,up" ? -1 : 0;
}

export function shotReason(o: { index: number; n: number; clipName: string; firstUse: boolean; hook: HookCandidate | null; hero: boolean; dropAt: number | null;
  match: number; energy: number; quality: number; slow: boolean; relevant: boolean; prevDirection: string }): string {
  if (o.index === 0 && o.hook) return `Opens on ${o.clipName}: the strongest of ${HOOK_CANDIDATES} possible openings (${hookReason(o.hook)}).`;
  const bits: string[] = [];
  if (o.hero) bits.push(`saved the strongest moment of the footage for ${o.dropAt !== null ? `the drop at ${fixed(o.dropAt, 1)}s` : "the music's peak"}`);
  if (o.match > 0) bits.push(`keeps the ${o.prevDirection}ward movement of the shot before (a natural match cut)`);
  if (o.slow) bits.push("slowed down because the music is calm here");
  if (o.relevant) bits.push("shows what the brief asks for");
  if (o.index === o.n - 1) bits.push("ends on a clean, high-quality shot");
  if (!bits.length) {
    if (o.energy >= 0.6) bits.push("a lively moment for an energetic part of the song");
    else if (o.energy < 0.4) bits.push("a steady moment for a calm part of the song");
    else bits.push(`the best unused footage here (quality ${fixed(o.quality, 2)})`);
  }
  if (o.firstUse && !o.hero && o.index !== 0 && o.index !== o.n - 1) bits.push("brings in new footage");
  const text = bits.join("; ");
  return `${o.clipName}: ${text[0].toUpperCase()}${text.slice(1)}.`;
}
