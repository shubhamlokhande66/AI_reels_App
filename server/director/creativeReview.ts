import { fixed, g, round } from "@/server/core/py";
import { direction, motionBetween, type ClipInput, type UsableWindow } from "@/server/models/clip";
import { segLength, type Timeline } from "@/server/models/timeline";
import { isFresh, overlapSeconds } from "@/server/video/footage";
import { beatDistance, briefTerms, cutMoments, windowsOf } from "@/server/video/timeline";
import * as intel from "./intelligence";
import { energyAtMap, levelAt, loudLimit, snapPoints, type MusicMap } from "./musicMap";
import { chooseTransition, ensureTransitions } from "@/server/video/transitions";
import type { Check } from "./review";

/** The Quality Reviewer (was director/creative_review.py): scores an edit 0-100 with timestamped issues and repairs what
 * it can before rendering; plus the ten-score card (scorecard.py) and the post-render correction round (self_correct.py). */

export const TARGET_SCORE = 80, MAX_REVISIONS = 2;
const MUST_FIX = new Set(["split_long_shot"]);
const WEIGHTS: Record<string, number> = { hook: 0.18, pacing: 0.12, story: 0.14, diversity: 0.14, beat: 0.1, visual: 0.1, transitions: 0.06, motion: 0.05, ending: 0.06, text: 0.05 };
const SIMILAR = 0.86, BEAT_TOLERANCE = 0.06, MAX_HOOK = 2.6, MIN_ENDING = 0.9;
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

export interface Issue { timestamp: number; problem: string; severity: string; category: string; fix: string | null }
export interface CreativeReview { overallScore: number; categories: Record<string, number>; issues: Issue[]; iterations: Record<string, unknown>[] }
const issue = (timestamp: number, problem: string, severity: string, category: string, fix: string | null = null): Issue => ({ timestamp, problem, severity, category, fix });
export const issueDoc = (i: Issue) => ({ timestamp: round(i.timestamp, 2), problem: i.problem, severity: i.severity, category: i.category, fix: i.fix });
export const reviewDoc = (r: CreativeReview) => ({ overallScore: r.overallScore, categories: r.categories, issues: r.issues.map(issueDoc), iterations: r.iterations, target: TARGET_SCORE });

export function windowAt(clip: ClipInput | undefined | null, t: number): UsableWindow | null {
  if (!clip) return null;
  const ws = windowsOf(clip);
  const inside = ws.filter((w) => w.start - 1e-3 <= t && t <= w.end + 1e-3);
  if (inside.length) return inside[0];
  return ws.length ? ws.reduce((a, w) => (Math.min(Math.abs(w.start - t), Math.abs(w.end - t)) < Math.min(Math.abs(a.start - t), Math.abs(a.end - t)) ? w : a)) : null;
}
const sim = (a: number[], b: number[]) => (a.length && b.length && a.length === b.length ? a.reduce((s, x, i) => s + Math.min(x, b[i]), 0) : 0);
const pct = (x: number) => round(Math.min(Math.max(x, 0), 1) * 100);
const argmin = (n: number, f: (i: number) => number) => { let best = 0; for (let i = 1; i < n; i++) if (f(i) < f(best)) best = i; return best; };

export interface ReviewOpts { brief?: string; maxTransitionRatio?: number; pace?: string; steps?: boolean; renderChecks?: Check[] | null }

export function reviewEdit(tl: Timeline, clips: ClipInput[], mm: MusicMap | null, o: ReviewOpts = {}): CreativeReview {
  const byId = new Map(clips.map((c) => [c.clipId, c])), segs = tl.segments, n = segs.length, steps = Boolean(o.steps);
  const issues: Issue[] = [], cat: Record<string, number> = {};
  const wins = segs.map((s) => windowAt(byId.get(s.clipId), s.sourceStart));
  const terms = briefTerms(o.brief ?? ""), sigs = clips.flatMap((c) => windowsOf(c).map((w) => w.signature));
  const hooks = intel.rankHooks(clips, o.brief ?? "");
  const first = segs[0], w0 = wins[0];
  if (hooks.length && w0 && byId.has(first.clipId)) {
    const ratio = intel.hookScore(intel.hookParts(byId.get(first.clipId)!, w0, terms, sigs)) / Math.max(hooks[0].score, 1e-6);
    cat.hook = Math.min(ratio, 1);
    if (ratio < 0.85 && !steps) issues.push(issue(0, `weak opening: ${hooks[0].name} would hook harder (${intel.hookReason(hooks[0])})`, ratio < 0.7 ? "high" : "medium", "hook", "replace_opening"));
  } else cat.hook = 0.6;
  if (segLength(first) > MAX_HOOK + 1e-6) { cat.hook *= 0.8; issues.push(issue(0, `the opening shot lasts ${fixed(segLength(first), 1)}s; the hook should land within ${g(MAX_HOOK)}s`, "medium", "hook")); }
  let pacePen = 0;
  const lengths = segs.map(segLength);
  if (mm) for (const s of segs) {
    const lim = loudLimit(mm, s.timelineStart, s.timelineEnd, o.pace ?? "balanced");
    if (lim && segLength(s) > lim[1] * 1.15 && !steps) { pacePen += 0.15; issues.push(issue(s.timelineStart, `a ${fixed(segLength(s), 1)}s shot drags in a ${lim[0].replace(/_/g, " ")} part of the song`, "medium", "pacing", "split_long_shot")); }
  }
  if (n >= 5) {
    const mean = lengths.reduce((a, b) => a + b, 0) / n, cv = Math.sqrt(lengths.reduce((s, x) => s + (x - mean) ** 2, 0) / n) / Math.max(mean, 1e-6);
    if (cv < 0.12) { pacePen += 0.2; issues.push(issue(segs[Math.floor(n / 2)].timelineStart, "every shot is the same length: the rhythm feels predictable", "low", "pacing")); }
  }
  cat.pacing = 1 - Math.min(pacePen, 0.8);
  let story = 1;
  const value = segs.map((s, i) => (wins[i] ? 0.55 * wins[i]!.quality + 0.45 * motionBetween(wins[i]!, s.sourceStart, s.sourceEnd) : 0.3));
  if (n >= 6 && !steps) {
    const third = Math.floor(n / 3), middle = value.slice(third, n - third), overall = value.reduce((a, b) => a + b, 0) / n;
    if (middle.length && middle.reduce((a, b) => a + b, 0) / middle.length < 0.8 * overall) {
      const k = third + argmin(middle.length, (i) => middle[i]);
      story -= 0.3;
      issues.push(issue(segs[k].timelineStart, "the middle sags: these shots are weaker than the rest, viewers may drop off", "medium", "story", "strengthen_middle"));
    }
  }
  const hero = n >= 3 ? intel.findHero(clips) : null, peak = peakIndex(tl, mm);
  if (hero && peak !== null && !steps) {
    const s = segs[peak];
    const on = s.clipId === hero.clipId && overlapSeconds(s.sourceStart, s.sourceEnd, [[hero.start, hero.end]]) > 0.2;
    if (!on && (!wins[peak] || intel.heroValue(byId.get(s.clipId)!, wins[peak]!, s.sourceStart, s.sourceEnd) < 0.9 * hero.score)) {
      story -= 0.3;
      issues.push(issue(s.timelineStart, `the music's peak shows a weaker moment; the strongest one (${hero.name} ${fixed(hero.start, 1)}-${fixed(hero.end, 1)}s) belongs here`, "medium", "story", "hero_on_drop"));
    }
  }
  cat.story = Math.max(story, 0);
  let rep = 0;
  for (let i = 1; i < n; i++) {
    const a = segs[i - 1], b = segs[i];
    if (a.clipId === b.clipId && Math.abs(a.sourceEnd - b.sourceStart) < 0.05) continue;
    if (a.clipId === b.clipId || (wins[i - 1] && wins[i] && sim(wins[i - 1]!.signature, wins[i]!.signature) >= SIMILAR)) {
      rep++;
      issues.push(issue(b.timelineStart, "repetitive visual: this shot looks like the one before it", "medium", "diversity", "swap_repetitive"));
    }
  }
  const usable = new Set((clips.some((c) => c.analysis.usable) ? clips.filter((c) => c.analysis.usable) : clips).map((c) => c.clipId));
  const usedShare = new Set(segs.map((s) => s.clipId).filter((id) => usable.has(id))).size / Math.max(Math.min(usable.size, n), 1);
  cat.diversity = Math.max(0, Math.min(usedShare, 1) - 0.15 * rep);
  const cuts = cutMoments(tl);
  if (mm && mm.beats.length && cuts.length) { const snap = snapPoints(mm); cat.beat = cuts.filter((c) => beatDistance(c, snap) <= BEAT_TOLERANCE).length / cuts.length; }
  else cat.beat = 0.7;
  const q = wins.filter((w): w is UsableWindow => w !== null).map((w) => w.quality);
  cat.visual = q.length ? q.reduce((a, b) => a + b, 0) / q.length : 0.5;
  segs.forEach((s, i) => { const w = wins[i]; if (w && w.quality < 0.35) issues.push(issue(s.timelineStart, `low-quality footage (${fixed(w.quality, 2)}) from ${s.video}`, "low", "visual", "swap_repetitive")); });
  // every cut is entered with a transition (video/transitions.ts): a plain cut is a gap to fill
  const plain = segs.slice(1).filter((s) => s.transitionIn.type === "cut").length;
  cat.transitions = n > 1 ? 1 - plain / (n - 1) : 1;
  if (plain) issues.push(issue(segs.slice(1).find((s) => s.transitionIn.type === "cut")!.timelineStart, `${plain} of ${n - 1} cuts have no transition`, "medium", "transitions", "add_transitions"));
  let reversals = 0;
  for (let i = 1; i < n; i++) {
    if (wins[i - 1] && wins[i] && intel.motionMatch(wins[i - 1], wins[i]!) < 0 && segs[i].clipId !== segs[i - 1].clipId) {
      reversals++;
      issues.push(issue(segs[i].timelineStart, `jarring cut: the movement reverses (${direction(wins[i - 1]!)} then ${direction(wins[i]!)})`, "low", "motion", "match_motion"));
    }
  }
  cat.motion = Math.max(0, 1 - 0.25 * reversals);
  const last = segs[n - 1], wl = wins[n - 1];
  let end = 1;
  if (segLength(last) < MIN_ENDING - 1e-6) { end -= 0.4; issues.push(issue(last.timelineStart, `the Reel ends on a ${fixed(segLength(last), 2)}s shot and feels cut off`, "medium", "ending")); }
  if (wl && q.length && wl.quality < 0.85 * (q.reduce((a, b) => a + b, 0) / q.length)) { end -= 0.3; issues.push(issue(last.timelineStart, "weak ending: the last shot is weaker than the rest", "medium", "ending", "strengthen_ending")); }
  cat.ending = Math.max(end, 0);
  let text = 1;
  const ov = [...tl.overlays].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ov.length; i++) if (ov[i].start < ov[i - 1].end - 0.05) { text -= 0.3; issues.push(issue(ov[i].start, "two texts on screen at once", "medium", "text")); }
  if (tl.duration > 0 && ov.length > Math.max(tl.duration / 4, 2)) { text -= 0.3; issues.push(issue(ov.length ? ov[0].start : 0, `text overload: ${ov.length} texts in ${g(tl.duration)}s`, "low", "text")); }
  for (const x of ov) if (x.end - x.start < 0.25 * Math.max(x.text.split(/\s+/).filter(Boolean).length, 1) + 0.5) { text -= 0.15; issues.push(issue(x.start, `'${x.text}' is on screen too briefly to read`, "low", "text")); }
  cat.text = Math.max(text, 0);
  let tech = 0;
  for (const c of o.renderChecks ?? []) if (!c.ok) { tech += 12; issues.push(issue(0, `technical: ${c.name}` + (c.detail ? ` (${c.detail})` : ""), "high", "technical")); }
  const categories = Object.fromEntries(Object.keys(WEIGHTS).map((k) => [k, pct(cat[k] ?? 0.7)]));
  const score = Object.keys(WEIGHTS).reduce((s, k) => s + WEIGHTS[k] * categories[k], 0) - tech;
  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.timestamp - b.timestamp);
  return { overallScore: round(Math.min(Math.max(score, 0), 100)), categories, issues, iterations: [] };
}

export function peakIndex(tl: Timeline, mm: MusicMap | null): number | null {
  const segs = tl.segments;
  if (!mm || segs.length < 3) return null;
  const middle = Array.from({ length: segs.length - 2 }, (_, i) => i + 1);
  const inner = mm.drops.filter((d) => segs[0].timelineEnd <= d && d < segs[segs.length - 1].timelineStart);
  if (inner.length) return middle.reduce((a, i) => (Math.abs(segs[i].timelineStart - inner[0]) < Math.abs(segs[a].timelineStart - inner[0]) ? i : a));
  const order: Record<string, number> = { very_high: 3, high: 2, medium: 1, low: 0 };
  const loud = (i: number) => order[energyAtMap(mm, segs[i].timelineStart)] ?? 0;
  const v = (i: number) => loud(i) + 0.25 * (levelAt(mm, segs[i].timelineStart) >= 3 ? 1 : 0) - 0.6 * Math.abs(segs[i].timelineStart / tl.duration - 0.6);
  const best = middle.reduce((a, i) => (v(i) > v(a) ? i : a));
  return loud(best) >= 2 ? best : null;
}

export function usedRanges(tl: Timeline, skip: number | null = null): Map<string, [number, number][]> {
  const out = new Map<string, [number, number][]>();
  tl.segments.forEach((s, i) => { if (i !== skip) { if (!out.has(s.clipId)) out.set(s.clipId, []); out.get(s.clipId)!.push([s.sourceStart, s.sourceEnd]); } });
  return out;
}

/** Put footage into shot i; false when the person locked that shot. */
export function placeFootage(tl: Timeline, i: number, clip: ClipInput, start: number, w: UsableWindow, reason: string): boolean {
  const s = tl.segments[i];
  if (s.locked) return false;
  const span = segLength(s) * s.speed;
  Object.assign(s, { clipId: clip.clipId, video: clip.name, sourceStart: round(start, 3), sourceEnd: round(start + span, 3), focusX: w.focusX, focusY: w.focusY, focusSource: w.focusSource, reason: `${clip.name}: ${reason}` });
  return true;
}

type Key = (c: ClipInput, w: UsableWindow, a: number, b: number) => number;
function bestFresh(tl: Timeline, i: number, clips: ClipInput[], key: Key, avoid: Set<string> = new Set()): [ClipInput, number, UsableWindow] | null {
  const s = tl.segments[i], span = segLength(s) * s.speed, used = usedRanges(tl, i);
  let best: [ClipInput, number, UsableWindow] | null = null, bestV = -1e9;
  for (const c of clips.some((c) => c.analysis.usable) ? clips.filter((c) => c.analysis.usable) : clips) {
    if (avoid.has(c.clipId)) continue;
    for (const w of windowsOf(c)) for (let a = w.start; a + span <= w.end + 1e-6; a += 0.25) {
      if (isFresh(a, a + span, used.get(c.clipId) ?? [])) { const v = key(c, w, a, a + span); if (v > bestV) { best = [c, a, w]; bestV = v; } }
    }
  }
  return best;
}
const neighbours = (tl: Timeline, i: number) => new Set([i - 1, i + 1].filter((j) => j >= 0 && j < tl.segments.length).map((j) => tl.segments[j].clipId));
const shotAt = (tl: Timeline, t: number) => { const k = tl.segments.findIndex((s) => Math.abs(s.timelineStart - t) < 1e-3); return k < 0 ? null : k; };

/** One round of fixes for the review's issues, in place; returns what changed. */
export function reviseOnce(tl: Timeline, review: CreativeReview, clips: ClipInput[], mm: MusicMap | null, o: { brief?: string; maxTransitionRatio?: number } = {}): string[] {
  const byId = new Map(clips.map((c) => [c.clipId, c])), done: string[] = [];
  const fixes = new Set(review.issues.map((i) => i.fix).filter(Boolean) as string[]);
  const terms = briefTerms(o.brief ?? ""), sigs = clips.flatMap((c) => windowsOf(c).map((w) => w.signature));
  if (fixes.has("replace_opening")) {
    const avoid = neighbours(tl, 0); avoid.delete(tl.segments[0].clipId);
    const pick = bestFresh(tl, 0, clips, (c, w, a, b) => intel.hookScore(intel.hookParts(c, w, terms, sigs)) + 0.05 * motionBetween(w, a, b), avoid);
    if (pick) {
      const [c, a, w] = pick;
      const reason = intel.hookReason({ clipId: c.clipId, name: c.name, start: a, end: a, score: 0, parts: intel.hookParts(c, w, terms, sigs) } as intel.HookCandidate);
      if (placeFootage(tl, 0, c, a, w, `Replaced the opening: the strongest hook in the footage (${reason}).`)) done.push(`replaced the opening with ${c.name}`);
    }
  }
  const peak = peakIndex(tl, mm), hero = intel.findHero(clips);
  if (fixes.has("hero_on_drop") && peak !== null && hero) {
    const s = tl.segments[peak], span = segLength(s) * s.speed, c = byId.get(hero.clipId);
    tl.segments.forEach((x, j) => {
      if (j !== peak && x.clipId === hero.clipId && overlapSeconds(x.sourceStart, x.sourceEnd, [[hero.start, hero.start + span]]) > 0.05) {
        const alt = bestFresh(tl, j, clips, (c2, w2, a2, b2) => w2.quality - (c2.clipId === hero.clipId && a2 < hero.start + span && b2 > hero.start ? 1 : 0));
        if (alt) placeFootage(tl, j, alt[0], alt[1], alt[2], "Moved here so the strongest moment is saved for the music's peak.");
      }
    });
    const w = c ? windowAt(c, hero.start) : null;
    if (c && w && hero.start + span <= w.end + 1e-6 && isFresh(hero.start, hero.start + span, usedRanges(tl, peak).get(c.clipId) ?? []) && placeFootage(tl, peak, c, hero.start, w, "Saved the strongest moment of the footage for the music's peak."))
      done.push(`put the strongest moment (${c.name}) on the music's peak`);
  }
  if (fixes.has("strengthen_middle") || fixes.has("strengthen_ending")) {
    const targets = [...(fixes.has("strengthen_middle") ? review.issues.filter((i) => i.fix === "strengthen_middle").map((i) => i.timestamp) : []), ...(fixes.has("strengthen_ending") ? [tl.segments[tl.segments.length - 1].timelineStart] : [])];
    for (const t of targets) {
      const i = shotAt(tl, t);
      if (i === null || i === peak) continue;
      const nb = neighbours(tl, i);
      const pick = bestFresh(tl, i, clips, (c, w, a, b) => 0.55 * w.quality + 0.45 * motionBetween(w, a, b) - (nb.has(c.clipId) ? 0.5 : 0));
      if (!pick) continue;
      const [c, a, w] = pick, cur = windowAt(byId.get(tl.segments[i].clipId), tl.segments[i].sourceStart);
      if (!cur || 0.55 * w.quality + 0.45 * motionBetween(w, a, a + 1) > 0.55 * cur.quality + 0.45 * cur.motion + 0.03) {
        const last = i === tl.segments.length - 1;
        if (placeFootage(tl, i, c, a, w, last ? "A stronger shot to end on." : "A stronger moment so the middle keeps viewers watching.")) done.push(`strengthened the ${last ? "ending" : "middle"} with ${c.name}`);
      }
    }
  }
  for (const t of review.issues.filter((i) => i.fix === "swap_repetitive").map((i) => i.timestamp)) {
    const i = shotAt(tl, t);
    if (i === null || i === 0 || i === peak) continue;
    const prevW = windowAt(byId.get(tl.segments[i - 1].clipId), tl.segments[i - 1].sourceStart);
    const pick = bestFresh(tl, i, clips, (c, w) => w.quality - (prevW ? sim(w.signature, prevW.signature) : 0) + 0.1 * intel.motionMatch(prevW, w), neighbours(tl, i));
    if (pick && placeFootage(tl, i, pick[0], pick[1], pick[2], "Brings in different footage so neighbouring shots do not look alike.")) done.push(`swapped a repetitive shot at ${fixed(tl.segments[i].timelineStart, 1)}s for ${pick[0].name}`);
  }
  for (const t of review.issues.filter((i) => i.fix === "match_motion").map((i) => i.timestamp)) {
    const i = shotAt(tl, t);
    if (i === null || i === 0 || i === peak) continue;
    const prevW = windowAt(byId.get(tl.segments[i - 1].clipId), tl.segments[i - 1].sourceStart);
    const pick = bestFresh(tl, i, clips, (c, w) => (intel.motionMatch(prevW, w) < 0 ? 0 : 0.5) + w.quality, neighbours(tl, i));
    if (pick && intel.motionMatch(prevW, pick[2]) >= 0 && placeFootage(tl, i, pick[0], pick[1], pick[2], `Continues the movement of the shot before (${prevW ? direction(prevW) : "still"}) instead of reversing it.`))
      done.push(`smoothed a direction change at ${fixed(t, 1)}s`);
  }
  if (fixes.has("add_transitions")) {
    const k = ensureTransitions(tl);
    if (k) done.push(`gave ${k} cut(s) a transition`);
  }
  if (fixes.has("split_long_shot")) done.push(...splitLong(tl, review, mm));
  return done;
}

function splitLong(tl: Timeline, review: CreativeReview, mm: MusicMap | null): string[] {
  if (!mm) return [];
  const out: string[] = [];
  for (const t of [...new Set(review.issues.filter((i) => i.fix === "split_long_shot").map((i) => i.timestamp))].sort((a, b) => b - a)) {
    const k = shotAt(tl, t);
    if (k === null || tl.segments[k].locked) continue;
    const s = tl.segments[k], beats = mm.beats.map((b) => b.t).filter((b) => s.timelineStart + 0.6 < b && b < s.timelineEnd - 0.6);
    if (!beats.length) continue;
    const mid = (s.timelineStart + s.timelineEnd) / 2;
    const cut = beats.reduce((a, b) => { const la = levelAt(mm, a), lb = levelAt(mm, b); return lb > la || (lb === la && -Math.abs(b - mid) > -Math.abs(a - mid)) ? b : a; });
    const second = structuredClone(s);
    second.id = s.id.length >= 8 ? s.id.slice(0, 6) + "s" + s.id.slice(7) : s.id + "s";
    second.timelineStart = round(cut, 3);
    second.sourceStart = round(s.sourceStart + (cut - s.timelineStart) * s.speed, 3);
    second.transitionIn = chooseTransition("loud", s.transitionIn.type);
    second.effect = s.effect === "none" ? "punch" : s.effect;
    second.reason = `${s.video}: Split on a strong beat so the shot keeps up with the loud music (same footage, no repeat).`;
    s.timelineEnd = round(cut, 3);
    s.sourceEnd = second.sourceStart;
    tl.segments.splice(k + 1, 0, second);
    out.push(`split a long shot on the beat at ${fixed(cut, 1)}s`);
  }
  return out;
}

/** Review -> revise -> review, at most MAX_REVISIONS rounds; the best-scoring edit wins. */
export function autoRevise(tl: Timeline, clips: ClipInput[], mm: MusicMap | null, o: ReviewOpts & { repair?: (t: Timeline) => unknown } = {}): [Timeline, CreativeReview] {
  let review = reviewEdit(tl, clips, mm, o);
  const first = review.overallScore;
  let bestTl = tl, best = review;
  const rounds: { round: number; changes: string[]; scoreBefore: number; scoreAfter: number; kept: boolean }[] = [];
  for (let k = 0; k < MAX_REVISIONS; k++) {
    const mustOnly = best.overallScore >= TARGET_SCORE;
    let todo = best.issues.filter((i) => i.fix && (MUST_FIX.has(i.fix) || !mustOnly));
    if (o.steps) todo = todo.filter((i) => i.fix === "add_transitions" || MUST_FIX.has(i.fix!));
    if (!todo.length) break;
    const cand = structuredClone(bestTl);
    const changes = reviseOnce(cand, { ...best, issues: todo }, clips, mm, o);
    if (!changes.length) break;
    o.repair?.(cand);
    review = reviewEdit(cand, clips, mm, o);
    const kept = review.overallScore > best.overallScore || (mustOnly && review.overallScore >= best.overallScore);
    rounds.push({ round: k + 1, changes, scoreBefore: best.overallScore, scoreAfter: review.overallScore, kept });
    if (!kept) break;
    bestTl = cand; best = review;
  }
  best.iterations = rounds;
  if (rounds.length) {
    const keptRounds = rounds.filter((r) => r.kept);
    bestTl.notes = [...bestTl.notes, keptRounds.length
      ? `Quality reviewer: ${first} -> ${best.overallScore}/100 after ${keptRounds.length} revision(s): ` + keptRounds.flatMap((r) => r.changes).join("; ").slice(0, 300)
      : `Quality reviewer: ${first}/100; its revision did not improve the edit, so the first version was kept.`];
  }
  return [bestTl, best];
}

// ------------------------------------------------------------------ scorecard (director/scorecard.py)
export interface FileIssue { code: string; message: string; severity: string; details: Record<string, unknown> }
const SCORE_KEYS = ["hook", "story", "pacing", "music_sync", "visual_quality", "brand_fit", "text_readability", "audio", "ending", "retention"];
const CARD_WEIGHTS: Record<string, number> = { hook: 0.16, story: 0.12, pacing: 0.1, music_sync: 0.1, visual_quality: 0.12, brand_fit: 0.08, text_readability: 0.06, audio: 0.1, ending: 0.06, retention: 0.1 };
const AUDIO_COST: Record<string, number> = { NO_AUDIO: 60, AUDIO_CLIPPING: 25, AUDIO_LOUDNESS: 12, AUDIO_ABRUPT_START: 5, MUSIC_ABRUPT_END: 15, AUDIO_ENDS_EARLY: 15 };
const PICTURE_COST: Record<string, number> = { BLACK_FRAMES: 15, DUPLICATE_FRAMES: 12, WRONG_RESOLUTION: 20 };
const clamp100 = (x: number) => round(Math.min(Math.max(x, 0), 100));
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function brandFit(tl: Timeline, brief: Record<string, unknown> | null, brand: Record<string, unknown> | null): [number, string[]] {
  let score = 100;
  const notes: string[] = [], b = brief ?? {}, inferred = new Set((b.inferred as string[]) ?? []);
  const look = (brand?.visualStyle as string) || (!inferred.has("style") ? (b.style as string) : null);
  if (look && !["auto", tl.style].includes(look)) { score -= 25; notes.push(`the edit's style (${tl.style.replace(/_/g, " ")}) is not the brand look (${look.replace(/_/g, " ")})`); }
  const cta = (brand?.cta as string) || (!inferred.has("cta") ? (b.cta as string) : "");
  if (cta && !tl.overlays.some((x) => x.role === "cta")) { score -= 20; notes.push(`the call to action '${cta}' never appears on screen`); }
  else if (cta && tl.duration > 0 && Math.max(...tl.overlays.filter((x) => x.role === "cta").map((x) => x.start)) < tl.duration * 0.6) { score -= 8; notes.push("the call to action comes early and is gone by the end"); }
  if (brand && (brand.colors as unknown[] | undefined)?.length && tl.overlays.length && !tl.captionColor) score -= 5;
  if (!brand && !look) { score = Math.min(score, 85); notes.push("no brand kit: brand fit is judged only on the brief"); }
  return [clamp100(score), notes];
}

export function scorecard(review: CreativeReview, o: { timeline: Timeline; fileIssues?: FileIssue[] | null; brief?: Record<string, unknown> | null; brand?: Record<string, unknown> | null; expectAudio?: boolean; threshold?: number }) {
  const c = review.categories, codes = (o.fileIssues ?? []).map((i) => i.code);
  let audio = 100;
  for (const code of codes) if (!(code === "NO_AUDIO" && o.expectAudio === false)) audio -= AUDIO_COST[code] ?? 0;
  const pictureCost = codes.reduce((s, code) => s + (PICTURE_COST[code] ?? 0), 0);
  const [bf, brandNotes] = brandFit(o.timeline, o.brief ?? null, o.brand ?? null);
  const scores: Record<string, number> = {
    hook: c.hook ?? 60, story: c.story ?? 60, pacing: c.pacing ?? 60, music_sync: c.beat ?? 70, visual_quality: clamp100(0.8 * (c.visual ?? 60) + 0.2 * (c.motion ?? 80) - pictureCost),
    brand_fit: bf, text_readability: c.text ?? 100, audio: clamp100(audio), ending: clamp100((c.ending ?? 70) - (codes.includes("MUSIC_ABRUPT_END") ? 15 : 0)),
    retention: clamp100(0.35 * (c.hook ?? 60) + 0.25 * (c.story ?? 60) + 0.2 * (c.pacing ?? 60) + 0.2 * (c.diversity ?? 60)),
  };
  const overall = clamp100(SCORE_KEYS.reduce((s, k) => s + CARD_WEIGHTS[k] * scores[k], 0));
  const issues = [...review.issues.filter((i) => i.category !== "technical").map((i) => i.problem).slice(0, 8),
    ...(o.fileIssues ?? []).filter((i) => i.severity !== "info" || i.code in AUDIO_COST).map((i) => i.message), ...brandNotes.slice(0, 2)];
  return { overallScore: overall, ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [camel(k), v])), issues: issues.slice(0, 12), threshold: o.threshold ?? 70, measured: o.fileIssues !== undefined && o.fileIssues !== null } as Record<string, unknown> & { overallScore: number };
}
export const weakest = (card: Record<string, unknown>, n = 3) => [...SCORE_KEYS].sort((a, b) => ((card[camel(a)] as number) ?? 100) - ((card[camel(b)] as number) ?? 100)).slice(0, n);

// ------------------------------------------------------------------ self-correction (director/self_correct.py)
export const MAX_ITERATIONS = 3;
export interface AiFix { fix: string; at: number | null; problem: string }
export interface Round { iteration: number; scoreBefore: number; scoreAfter: number | null; changes: string[]; kept: boolean; aiSummary: string }
export const roundDoc = (r: Round) => ({ ...r });

export function audioFixes(tl: Timeline, fileIssues: FileIssue[], aiFixes: AiFix[], targetLufs = -14): string[] {
  const done: string[] = [], codes = new Map(fileIssues.map((i) => [i.code, i])), names = new Set(aiFixes.map((f) => f.fix));
  if (codes.has("AUDIO_CLIPPING") || names.has("lower_music")) { tl.musicVolume = Math.max(round(tl.musicVolume * 0.85, 3), 0.2); done.push(`lowered the music to ${fixed(tl.musicVolume, 2)}x so it does not clip`); }
  else if (codes.has("AUDIO_LOUDNESS")) {
    const lufs = codes.get("AUDIO_LOUDNESS")!.details.lufs as number | undefined;
    if (lufs !== undefined && lufs !== null) { tl.musicVolume = round(Math.min(Math.max(tl.musicVolume * 10 ** ((targetLufs - lufs) / 20), 0.2), 2), 3); done.push(`set the music to ${fixed(tl.musicVolume, 2)}x for platform loudness`); }
  }
  if ((codes.has("MUSIC_ABRUPT_END") || names.has("fade_out_music")) && (tl.musicFadeOut ?? 0) < 1) { tl.musicFadeOut = 1.5; done.push("faded the music out at the end"); }
  if (codes.has("AUDIO_ABRUPT_START") && (tl.musicFadeIn ?? 0) < 0.2) { tl.musicFadeIn = 0.3; done.push("faded the music in"); }
  return done;
}

/** One correction round on a copy: measured issues plus the AI reviewer's named fixes, then the audio fixes. */
export function correct(tl: Timeline, review: CreativeReview, fileIssues: FileIssue[], aiFixes: AiFix[], clips: ClipInput[], mm: MusicMap | null, o: { brief?: string; maxTransitionRatio?: number } = {}): [Timeline, string[]] {
  const cand = structuredClone(tl);
  const issues = review.issues.filter((i) => i.fix);
  for (const f of aiFixes) {
    if (["fade_out_music", "lower_music"].includes(f.fix)) continue;
    const near = f.at !== null && cand.segments.length ? cand.segments.reduce((a, s) => (Math.abs(s.timelineStart - f.at!) < Math.abs(a.timelineStart - f.at!) ? s : a)).timelineStart : null;
    const at = f.at !== null ? near : f.fix === "strengthen_ending" ? cand.segments[cand.segments.length - 1].timelineStart : 0;
    if (at !== null && !issues.some((i) => i.fix === f.fix && Math.abs(i.timestamp - at) < 1e-3)) issues.push(issue(at, f.problem || f.fix, "medium", "ai_review", f.fix));
  }
  const changes = issues.length ? reviseOnce(cand, { ...review, issues }, clips, mm, o) : [];
  changes.push(...audioFixes(cand, fileIssues, aiFixes));
  return [cand, changes];
}
