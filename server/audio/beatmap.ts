import { round } from "@/server/core/py";
import { annotatePlan } from "@/server/director/planMotion";
import * as pr from "@/server/director/paceRules";
import type { AudioAnalysis } from "@/server/models/analysis";
import { energyAt, meanEnergy, sectionAt } from "@/server/models/analysis";
import { beatScore, KEY_SCORE, scoreBeats } from "./keyBeats";
import { getTransition } from "@/server/video/render/parts";
import { chooseTransition, type Moment } from "@/server/video/transitions";

/** The song's beat map and cut plan (was backend/app/audio/beatmap.py): beats, strong hits, hits between beats, rolls,
 * rises / falls, and the edit cut by cut - from the cached analysis, no AI. Effect names are the renderer's own. */

export const CURVE_STEP = 0.25;
/** a shot lasts at least this many beats unless every beat was asked for (about a bar loud, two calm) */
const KEY_BEATS_LOUD = 4, KEY_BEATS_CALM = 8;
const TREND_WINDOW = 4, TREND_MIN = 0.12, MIN_TREND_SECONDS = 2, MIN_SHOT = 0.35, PUNCH_GAP = 3;
const CLOSE_HIT = 0.06;
const LOUD_SHOTS = ["Impact: close-up / detail", "Big movement / new angle", "Close-up of the best detail", "Wide shot, then punch in"];
const ENDING = 1.6, KEY_MIN_GAP = 0.1, KEY_END_GAP = 0.2, QUICK_GAP = 0.25;
const LOUD_PARTS = new Set(["drop", "chorus"]);
const EFFECTS: Record<string, [string, string, string]> = {
  drop: ["crash_zoom", "Crash zoom + flash", "the drop: the music kicks in"],
  major_loud: ["punch", "Punch in", "a strong hit in a loud part"],
  major_soft: ["zoom_in", "Cut + slow zoom-in", "a strong hit in a softer part"],
  beat_loud: ["none", "Clean", "a beat in a loud part"],
  beat_soft: ["zoom_in", "Slow push in", "a beat in a softer part"],
  sub_hit: ["beat_flash", "Flash", "a hard hit between beats"],
  sub: ["none", "Quick cut (fast styles only)", "a small hit between beats"],
  rise: ["zoom_in", "Faster cuts + zoom in", "the rhythm and energy build up"],
  fall: ["ken_burns", "Longer shots + slow drift", "the rhythm and energy fall away"],
};

/** bisect.bisect_left */
function bisectLeft(xs: number[], t: number): number {
  let lo = 0, hi = xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m] < t) lo = m + 1; else hi = m; }
  return lo;
}
function near(sorted: number[], t: number, tol: number): boolean {
  const i = bisectLeft(sorted, t);
  return [i - 1, i].some((j) => j >= 0 && j < sorted.length && Math.abs(sorted[j] - t) <= tol);
}
const pyMedian = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

/** [beat times, seconds between beats]: only the beats that were detected (none are added after the last one). */
export function beatGrid(a: AudioAnalysis): [number[], number] {
  const beats = [...a.beats].sort((x, y) => x - y);
  if (beats.length < 2) return [beats, a.bpm > 0 ? 60 / a.bpm : 0.5];
  return [beats, pyMedian(beats.slice(1).map((y, i) => y - beats[i]))];
}

function curve(a: AudioAnalysis, hop: number, values: number[]): number[] {
  if (!values.length) return [];
  const n = Math.trunc(a.duration / CURVE_STEP) + 1;
  return Array.from({ length: n }, (_, k) => round(values[Math.min(Math.trunc((k * CURVE_STEP) / hop), values.length - 1)], 3));
}

function smooth(xs: number[], width: number): number[] {
  const out: number[] = [];
  let acc = 0;
  xs.forEach((x, i) => {
    acc += x;
    if (i >= width) acc -= xs[i - width];
    out.push(acc / Math.min(i + 1, width));
  });
  return out;
}

export interface Trend { kind: string; start: number; end: number; change: number; [k: string]: unknown }

function trends(drive: number[]): Trend[] {
  const w = Math.trunc(TREND_WINDOW / CURVE_STEP);
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const labels = drive.map((_, i) => {
    const d = avg(drive.slice(i, i + w + 1)) - avg(drive.slice(Math.max(i - w, 0), i + 1));
    return d >= TREND_MIN ? "rise" : d <= -TREND_MIN ? "fall" : "";
  });
  const spans: Trend[] = [];
  let i = 0;
  while (i < labels.length) {
    let j = i;
    while (j + 1 < labels.length && labels[j + 1] === labels[i]) j++;
    const start = i * CURVE_STEP, end = (j + 1) * CURVE_STEP;
    if (labels[i] && end - start >= MIN_TREND_SECONDS) {
      const change = drive[Math.min(j + Math.floor(w / 2), drive.length - 1)] - drive[Math.max(i - Math.floor(w / 2), 0)];
      if (labels[i] === "rise" ? change >= TREND_MIN : change <= -TREND_MIN) spans.push({ kind: labels[i], start: round(start, 2), end: round(end, 2), change: round(change, 2) });
    }
    i = j + 1;
  }
  return spans;
}

export function songTrends(a: AudioAnalysis): Trend[] {
  const energy = curve(a, a.energyHop, a.energy);
  const rhythm = curve(a, a.curveHop, a.density);
  const r = rhythm.length ? rhythm : energy.map(() => 0);
  const n = Math.min(energy.length, r.length);
  return trends(smooth(Array.from({ length: n }, (_, i) => (energy[i] + r[i]) / 2), Math.trunc(1 / CURVE_STEP)));
}

/** Measurements shared by the map and the plan. */
export class Song {
  beats: number[];
  period: number;
  strong: number[];
  drops: number[];
  accT: number[];
  accS: number[];
  loudCut: number;
  constructor(public a: AudioAnalysis) {
    [this.beats, this.period] = beatGrid(a);
    this.strong = [...a.strongBeats].sort((x, y) => x - y);
    this.drops = [...a.drops].sort((x, y) => x - y);
    const strengths = a.accentStrengths.length ? a.accentStrengths : a.accents.map(() => 0.5);
    const pairs = a.accents.map((t, i) => [t, strengths[i]] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    this.accT = pairs.map(([t]) => t);
    this.accS = pairs.map(([, s]) => s);
    const local = this.beats.map((b) => meanEnergy(a, Math.max(b - 2, 0), b + 2));
    const loc = local.length ? local : [0.5];
    this.loudCut = [...loc].sort((x, y) => x - y)[Math.trunc(loc.length * 0.5)];
  }
  /** How hard the music hits at t (0..1): the nearest accent's strength. */
  hit(t: number, tol = 0.08): number {
    const i = bisectLeft(this.accT, t);
    let best = 0;
    for (const k of [i - 1, i]) if (k >= 0 && k < this.accT.length && Math.abs(this.accT[k] - t) <= tol) best = Math.max(best, this.accS[k]);
    return best;
  }
  part(t: number): string {
    return sectionAt(this.a, t + 0.05)?.label ?? "";
  }
  loud(t: number): boolean {
    return LOUD_PARTS.has(this.part(t)) || meanEnergy(this.a, Math.max(t - 2, 0), t + 2) >= this.loudCut;
  }
  isDrop(t: number) { return near(this.drops, t, this.period * 0.5); }
  /** a key beat (audio/keyBeats.ts): a drop, a new part, a bar start or one of the hardest hits around it */
  isMajor(t: number) { return beatScore(this.a, t) >= KEY_SCORE; }
  key(t: number): string {
    if (this.isDrop(t)) return "drop";
    return (this.isMajor(t) ? "major_" : "beat_") + (this.loud(t) ? "loud" : "soft");
  }

}

type Row = Record<string, unknown> & { t: number; kind: string; effect: string };

export function beatMap(a: AudioAnalysis) {
  const s = new Song(a);
  const events: Record<string, unknown>[] = [];
  const downs = [...a.downbeats].sort((x, y) => x - y);
  const position = new Map(a.beats.map((b, i) => [round(b, 3), a.beatPositions[i] ?? null]));
  for (const t of s.beats) {
    const key = s.key(t), major = ["drop", "major_loud", "major_soft"].includes(key);
    events.push({ t: round(t, 3), kind: major ? "major" : "beat", strength: round(Math.max(s.hit(t), energyAt(a, t) * 0.8), 2), key, level: major ? 3 : 1,
      downbeat: near(downs, t, 0.03), position: position.get(round(t, 3)) ?? null });
  }
  for (const d of s.drops) if (!events.some((ev) => Math.abs((ev.t as number) - d) <= s.period * 0.5)) events.push({ t: round(d, 3), kind: "major", strength: 1, key: "drop" });
  const sorted = events.map((e, i) => [e, i] as const).sort((x, y) => (x[0].t as number) - (y[0].t as number) || x[1] - y[1]).map(([e]) => e);
  for (const ev of sorted) {
    const [effect, label, why] = EFFECTS[ev.key as string];
    delete ev.key;
    Object.assign(ev, { effect, effectLabel: label, why, section: s.part(ev.t as number) });
  }
  const energy = curve(a, a.energyHop, a.energy);
  const rhythmRaw = curve(a, a.curveHop, a.density);
  const rhythm = rhythmRaw.length ? rhythmRaw : energy.map(() => 0);
  const n = Math.min(energy.length, rhythm.length);
  const tr = trends(smooth(Array.from({ length: n }, (_, i) => (energy[i] + rhythm[i]) / 2), Math.trunc(1 / CURVE_STEP)));
  for (const x of tr) {
    const [effect, label, why] = EFFECTS[x.kind];
    Object.assign(x, { effect, effectLabel: label, why });
  }
  const plan = cutPlan(a, s, tr);
  annotatePlan(plan, a);
  const count = Object.fromEntries(["major", "beat"].map((k) => [k, sorted.filter((ev) => ev.kind === k).length]));
  return {
    bpm: round(60 / s.period, 1), trackerBpm: round(a.bpm, 1), seconds: round(a.duration, 2), beatSeconds: round(s.period, 3),
    beatConfidence: round(a.beatConfidence, 2), downbeatConfidence: round(a.downbeatConfidence, 2),
    counts: {
      ...count, bars: a.downbeats.length, drops: s.drops.length, rises: tr.filter((t) => t.kind === "rise").length,
      falls: tr.filter((t) => t.kind === "fall").length, cuts: plan.filter((p) => p.transition !== "fade_in" && p.kind === "cut").length,
    },
    events: sorted, trends: tr, plan,
    sections: a.songSections.map((x) => ({ label: x.label, start: round(x.start, 2), end: round(x.end, 2), energy: round(x.energy, 2), cutOn: x.cutOn })),
    drops: s.drops.map((d) => round(d, 3)), curveStep: CURVE_STEP, energy: energy.slice(0, n), rhythm: rhythm.slice(0, n),
  };
}


/** The edit, moment by moment, for the song from `start` to `end` (song time): cuts on the beats, effects on the hits. */
export function cutPlan(a: AudioAnalysis, song: Song | null = null, trendsIn: Trend[] | null = null, start = 0, endIn: number | null = null,
                        maxShots: number | null = null, everyBeat = false, minShot = MIN_SHOT): Row[] {
  const s = song ?? new Song(a);
  const end = endIn === null ? a.duration : Math.min(endIn, a.duration);
  const tr = trendsIn ?? songTrends(a);
  const trendAt = (t: number) => tr.find((x) => x.start <= t && t < x.end)?.kind ?? "";
  const pace = pr.paceFor(s.period);
  // key beats: a cut on EVERY key beat the beat map lists (drops, new parts, bar starts, the hardest hits), however close
  // (only the same moment twice, under 0.1 s, is one cut), up to the very end; every beat: no shot shorter than minShot
  if (!everyBeat) minShot = KEY_MIN_GAP;
  const grid = s.beats.filter((b) => start + minShot <= b && b <= end - (everyBeat ? ENDING : KEY_END_GAP) && (everyBeat || s.isMajor(b) || s.isDrop(b)));
  const cuts: number[] = [];
  let last = start;
  for (const b of grid) {
    const t = trendAt(b), loud = s.loud(b);
    const inDrop = s.drops.some((d) => b - d >= 0 && b - d <= pr.DROP_BARS * 4 * s.period);
    let step = Math.max(pr.cutStep(pace, s.period, loud, t, inDrop, minShot), loud ? KEY_BEATS_LOUD : KEY_BEATS_CALM);
    if (everyBeat) step = s.period < minShot ? Math.max(1, round(minShot / s.period + 0.49)) : 1;
    const since = round((b - last) / s.period);
    // key beats: a cut on every key beat (the same ones the beat map lists); every beat: as often as the shortest shot allows
    const due = !everyBeat || since >= step || step === 1;
    const first = !cuts.length && s.isMajor(b) && b - start <= 2.5;
    if ((s.isDrop(b) || first || due) && b - last >= minShot) {
      cuts.push(b);
      last = b;
    }
  }
  const tail = s.beats.filter((b) => end - ENDING - s.period * 2 <= b && b <= end - 0.8 && b > start + minShot && (everyBeat || s.isMajor(b) || s.isDrop(b)));
  let hero: number | null = [...tail].reverse().find((b) => s.isMajor(b)) ?? (tail.length ? tail[tail.length - 1] : null);
  if (hero !== null && !cuts.includes(hero) && (!cuts.length || hero - cuts[cuts.length - 1] >= minShot)) cuts.push(hero);
  else if (cuts.length) hero = cuts[cuts.length - 1];

  if (maxShots && cuts.length + 1 > maxShots) {
    const weight = (c: number) => (s.isDrop(c) ? 3 : s.isMajor(c) ? 2 : 1);
    while (cuts.length + 1 > maxShots) {
      const removable = cuts.map((c, k) => [c, k] as const).filter(([c]) => c !== hero && weight(c) < 3).map(([, k]) => k);
      if (!removable.length) break;
      const low = Math.min(...removable.map((k) => weight(cuts[k])));
      const merged = (k: number) => (k + 1 < cuts.length ? cuts[k + 1] : end) - (k > 0 ? cuts[k - 1] : start);
      const cands = removable.filter((k) => weight(cuts[k]) === low);
      const pick = cands.reduce((best, k) => (merged(k) < merged(best) ? k : best), cands[0]);
      cuts.splice(pick, 1);
    }
  }

  const firstMajor = cuts.find((c) => s.isMajor(c) && c - start <= 2.5) ?? null;
  let nLoud = 0, lastPunch = -1e9, prevTr = "";
  const nexts = new Map(cuts.map((c, k) => [c, k + 1 < cuts.length ? cuts[k + 1] : end]));
  const rows: Row[] = [{ t: round(start, 3), kind: "cut", shot: "Black → soft fade-in: an establishing shot", effect: "none", effectLabel: "Fade in", transition: "fade_in", why: "the opening" }];
  for (const c of cuts) {
    const key = s.key(c);
    let [effect, label, why] = EFFECTS[key];
    const t = trendAt(c);
    let shot: string;
    if (c === hero) [shot, effect, label, why] = ["Hero shot + your logo / text, then fade out", "zoom_in", "Slow zoom-in, fade out", "the ending"];
    else if (c === firstMajor) shot = "Main reveal: your best shot";
    else if (key === "drop") shot = "Big impact shot (the best moment)";
    else if (key === "major_loud") shot = LOUD_SHOTS[nLoud++ % LOUD_SHOTS.length];
    else if (key === "major_soft") shot = "New angle, slow push in";
    else if (t === "rise") [shot, effect, label, why] = ["Faster cuts: quick movement", ...EFFECTS.rise];
    else if (t === "fall") [shot, effect, label, why] = ["Longer, slower shot", ...EFFECTS.fall];
    else shot = key === "beat_soft" ? "Angle change" : "Quick cut, small zoom";
    if (effect === "punch") {
      if (c - lastPunch >= PUNCH_GAP) lastPunch = c;
      else [effect, label] = ["none", "Clean"];
    }
    // every cut gets a transition, chosen from the music here; never the same one twice in a row; it fits both shots
    const scored = scoreBeats(a).find((b) => Math.abs(b.t - c) <= 0.03);
    const moment: Moment = key === "drop" || scored?.why === "drop" ? "drop" : scored?.why === "section" ? "section" : s.loud(c) ? "loud" : "calm";
    const pick = chooseTransition(moment, prevTr || null, rows.length);
    const prevCut = Math.max(start, ...cuts.filter((x) => x < c));
    const room = Math.min(c - prevCut, nexts.get(c)! - c);
    const kind = pick.type, dur = round(Math.max(Math.min(pick.duration, 0.4 * room), 0.08), 3);
    prevTr = kind;
    if (c !== hero) why = cutReason(scored?.why, s.part(c));
    rows.push({ t: round(c, 3), kind: "cut", shot, effect, effectLabel: label, transition: kind, tdur: dur, transitionLabel: getTransition(kind).label, why });
  }
  const ordered = rows.map((r, i) => [r, i] as const).sort((x, y) => x[0].t - y[0].t || x[1] - y[1]).map(([r]) => r);
  const shots = ordered.filter((r) => r.kind === "cut");
  shots.forEach((sh, k) => { sh.end = round(k + 1 < shots.length ? shots[k + 1].t : end, 3); });
  // key beats closer than QUICK_GAP: no room for a real transition, so the new shot hits as a quick impact instead
  // (loud / drop: a flash cut + punch-in; calm: a quick zoom + soft pulse)
  shots.forEach((sh, k) => {
    if (k === 0) return;
    const gap = sh.t - shots[k - 1].t;
    if (gap >= QUICK_GAP) return;
    const loud = s.isDrop(sh.t) || s.loud(sh.t);
    sh.transition = loud ? "flash" : "zoom";
    sh.transitionLabel = getTransition(sh.transition as string).label;
    sh.tdur = round(Math.max(Math.min(0.4 * gap, 0.1), 0.04), 3);
    [sh.effect, sh.effectLabel] = loud ? ["punch", "Punch-in"] : ["zoom_pulse", "Soft pulse"];
    sh.why = `${sh.why} · quick ${loud ? "flash" : "zoom"}: ${gap.toFixed(2)} s after the last cut`;
  });
  for (const r of ordered) if (!("end" in r)) r.end = r.t;
  return ordered;
}

/** Why a cut is on this beat, in plain words. */
function cutReason(why: string | undefined, part: string): string {
  if (why === "drop") return "the drop";
  if (why === "section") return part ? `a new part of the song (${part})` : "a new part of the song";
  if (why === "bar") return "a bar start";
  if (why === "hit") return "a strong hit";
  return "a beat";
}

/** Song times the picture must answer inside the shots: the beats a shot holds over (it pulses on them). */
export const planHits = (rows: Row[]) => [...new Set(rows.flatMap((r) => (r.pulses as number[] | undefined) ?? []))].sort((x, y) => x - y);

/** Beats and hard hits from start to end that the plan does not mark (should be none). */
export function missedBeats(a: AudioAnalysis, rows: Row[], start: number, end: number): number[] {
  const s = new Song(a);
  const marked = [...rows.map((r) => r.t), ...planHits(rows)].sort((x, y) => x - y);
  const out = s.beats.filter((b) => start + CLOSE_HIT < b && b < end - CLOSE_HIT && !near(marked, b, CLOSE_HIT));
  return out.sort((x, y) => x - y);
}
