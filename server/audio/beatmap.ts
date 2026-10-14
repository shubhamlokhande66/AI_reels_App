import { fixed, round } from "@/server/core/py";
import { annotatePlan } from "@/server/director/planMotion";
import * as pr from "@/server/director/paceRules";
import type { AudioAnalysis } from "@/server/models/analysis";
import { energyAt, meanEnergy, sectionAt } from "@/server/models/analysis";
import { beatScore, KEY_SCORE } from "./keyBeats";

/** The song's beat map and cut plan (was backend/app/audio/beatmap.py): beats, strong hits, hits between beats, rolls,
 * rises / falls, and the edit cut by cut - from the cached analysis, no AI. Effect names are the renderer's own. */

export const CURVE_STEP = 0.25;
/** a shot lasts at least this many beats unless every beat was asked for (about a bar loud, two calm) */
const KEY_BEATS_LOUD = 4, KEY_BEATS_CALM = 8;
const TREND_WINDOW = 4, TREND_MIN = 0.12, MIN_TREND_SECONDS = 2, MAJOR_HIT = 0.95, HARD_SUB = 0.9, MIN_SHOT = 0.35, PUNCH_GAP = 3;
const TRANSITIONS: Record<string, [string[], number]> = {
  drop: [["flash"], 0.2], major_loud: [["slide_left", "cover_up", "slide_right", "cover_down"], 0.24], beat_loud: [["slide_up", "slide_left", "slide_down", "slide_right"], 0.2],
  major_soft: [["dissolve"], 0.35], beat_soft: [["dissolve"], 0.3], rise: [["cover_up", "slide_up"], 0.2], fall: [["dissolve"], 0.45], hero: [["dissolve"], 0.4],
};
const TRANSITION_LABEL: Record<string, string> = {
  cut: "Cut", flash: "Flash", slide_left: "Slide left", slide_right: "Slide right", slide_up: "Slide up", slide_down: "Slide down", cover_up: "Cover up",
  cover_down: "Cover down", dissolve: "Dissolve", fade_in: "Fade in",
};
const FLASH_MARGIN = 0.25, CLOSE_HIT = 0.06, ROLL_GAP = 0.2, STAND_OUT = 0.2, ROLL_HITS = 4, MEDIUM_SUB = 0.6, FLASH_GAP = 3;
const LOUD_SHOTS = ["Impact: close-up / detail", "Big movement / new angle", "Close-up of the best detail", "Wide shot, then punch in"];
const ENDING = 1.6;
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
  subs: number[];
  private hard?: number[];
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
    const subs: number[] = [];
    const all = [...new Set([...a.accents.map((x) => round(x, 3)), ...a.onsets.map((x) => round(x, 3))])].sort((x, y) => x - y);
    for (const t of all) if (!near(this.beats, t, Math.min(this.period * 0.2, 0.08)) && (!subs.length || t - subs[subs.length - 1] > 0.06)) subs.push(t);
    this.subs = subs;
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
  groove(t: number): boolean {
    const i = bisectLeft(this.subs, t);
    return i > 0 && t - this.subs[i - 1] < ROLL_GAP && i + 1 < this.subs.length && this.subs[i + 1] - t < ROLL_GAP;
  }
  hardSubs(start = 0, end = 1e9): number[] {
    if (!this.hard) {
      const raw = this.subs.filter((t) => this.hit(t, 0.06) >= HARD_SUB);
      this.hard = raw.filter((t) => !this.pattern(t, raw) && this.standsOut(t));
    }
    return this.hard.filter((t) => start <= t && t <= end);
  }
  private standsOut(t: number): boolean {
    const around = [...this.subs, ...this.beats].filter((x) => Math.abs(x - t) > 0.05 && Math.abs(x - t) <= 1).map((x) => this.hit(x, 0.06)).sort((x, y) => x - y);
    return !around.length || this.hit(t, 0.06) - around[Math.floor(around.length / 2)] >= STAND_OUT;
  }
  private pattern(t: number, raw: number[]): boolean {
    const i = bisectLeft(this.beats, t) - 1;
    if (i < 0) return false;
    const phase = t - this.beats[i];
    let same = 0;
    for (const k of [-4, -3, -2, -1, 1, 2, 3, 4]) {
      const j = i + k;
      if (j >= 0 && j < this.beats.length && near(raw, this.beats[j] + phase, this.period * 0.08)) same++;
    }
    return same >= 3;
  }
}

type Row = Record<string, unknown> & { t: number; kind: string; effect: string };

export function beatMap(a: AudioAnalysis) {
  const s = new Song(a);
  const events: Record<string, unknown>[] = [];
  const downs = [...a.downbeats].sort((x, y) => x - y);
  const known = a.beatLevels.length === a.beats.length ? a.beats.map((b, i) => [b, a.beatLevels[i]] as const) : [];
  for (const t of s.beats) {
    const key = s.key(t);
    const level = known.find(([bt]) => Math.abs(bt - t) <= 0.03)?.[1] ?? 1;
    events.push({ t: round(t, 3), kind: ["drop", "major_loud", "major_soft"].includes(key) ? "major" : "beat", strength: round(Math.max(s.hit(t), energyAt(a, t) * 0.8), 2), key, level, downbeat: near(downs, t, 0.03) });
  }
  for (const d of s.drops) if (!events.some((ev) => Math.abs((ev.t as number) - d) <= s.period * 0.5)) events.push({ t: round(d, 3), kind: "major", strength: 1, key: "drop" });
  for (const t of s.subs) {
    const h = s.hit(t, 0.06);
    events.push({ t, kind: "sub", strength: round(Math.max(h, energyAt(a, t) * 0.6), 2), key: h >= HARD_SUB ? "sub_hit" : "sub" });
  }
  const sorted = events.map((e, i) => [e, i] as const).sort((x, y) => (x[0].t as number) - (y[0].t as number) || x[1] - y[1]).map(([e]) => e);
  for (const ev of sorted) {
    const [effect, label, why] = EFFECTS[ev.key as string];
    delete ev.key;
    Object.assign(ev, { effect, effectLabel: label, why, section: s.part(ev.t as number) });
  }
  const rolls: Record<string, unknown>[] = [];
  let run: number[] = [];
  for (const t of [...s.subs, Infinity]) {
    if (run.length && t - run[run.length - 1] > s.period * 0.75) {
      if (run.length >= 3) rolls.push({ start: run[0], end: run[run.length - 1], count: run.length, perSecond: round(run.length / Math.max(run[run.length - 1] - run[0], 0.1), 1) });
      run = [];
    }
    if (t !== Infinity) run.push(t);
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
  const count = Object.fromEntries(["major", "beat", "sub"].map((k) => [k, sorted.filter((ev) => ev.kind === k).length]));
  return {
    bpm: round(60 / s.period, 1), trackerBpm: round(a.bpm, 1), seconds: round(a.duration, 2), beatSeconds: round(s.period, 3),
    beatConfidence: round(a.beatConfidence, 2), downbeatConfidence: round(a.downbeatConfidence, 2),
    counts: {
      ...count, hardSub: s.hardSubs().length, rolls: rolls.length, drops: s.drops.length, rises: tr.filter((t) => t.kind === "rise").length,
      falls: tr.filter((t) => t.kind === "fall").length, cuts: plan.filter((p) => p.transition !== "fade_in" && p.kind === "cut").length,
    },
    events: sorted, rolls, trends: tr, plan,
    sections: a.songSections.map((x) => ({ label: x.label, start: round(x.start, 2), end: round(x.end, 2), energy: round(x.energy, 2), cutOn: x.cutOn })),
    drops: s.drops.map((d) => round(d, 3)), curveStep: CURVE_STEP, energy: energy.slice(0, n), rhythm: rhythm.slice(0, n),
  };
}

/** Hits of a fast run (3+ hits under 0.2 s apart) that ends right before a drop. */
function preDropRolls(s: Song, dropCuts: number[]): number[] {
  const out: number[] = [];
  for (const d of dropCuts) {
    const run = s.subs.filter((t) => d - 1.2 < t && t < d - CLOSE_HIT);
    const tail: number[] = [];
    for (const t of [...run].reverse()) {
      if ((tail.length && tail[tail.length - 1] - t >= ROLL_GAP) || (!tail.length && d - t >= FLASH_MARGIN + ROLL_GAP)) break;
      tail.push(t);
    }
    if (tail.length >= 3) out.push(...tail.slice(0, ROLL_HITS));
  }
  return out;
}

/** The edit, moment by moment, for the song from `start` to `end` (song time): cuts on the beats, effects on the hits. */
export function cutPlan(a: AudioAnalysis, song: Song | null = null, trendsIn: Trend[] | null = null, start = 0, endIn: number | null = null,
                        maxShots: number | null = null, everyBeat = false, minShot = MIN_SHOT): Row[] {
  const s = song ?? new Song(a);
  const end = endIn === null ? a.duration : Math.min(endIn, a.duration);
  const tr = trendsIn ?? songTrends(a);
  const trendAt = (t: number) => tr.find((x) => x.start <= t && t < x.end)?.kind ?? "";
  const pace = pr.paceFor(s.period);
  // cuts only on key beats (drops, new parts, bar starts, the hardest hits), unless every beat was asked for
  const grid = s.beats.filter((b) => start + minShot <= b && b <= end - ENDING && (everyBeat || s.isMajor(b) || s.isDrop(b)));
  const cuts: number[] = [];
  let last = start;
  for (const b of grid) {
    const t = trendAt(b), loud = s.loud(b);
    const inDrop = s.drops.some((d) => b - d >= 0 && b - d <= pr.DROP_BARS * 4 * s.period);
    let step = Math.max(pr.cutStep(pace, s.period, loud, t, inDrop, minShot), loud ? KEY_BEATS_LOUD : KEY_BEATS_CALM);
    if (everyBeat) step = s.period < minShot ? Math.max(1, round(minShot / s.period + 0.49)) : 1;
    const since = round((b - last) / s.period);
    const due = since >= step || (everyBeat && step === 1);
    const first = !cuts.length && s.isMajor(b) && b - start <= 2.5;
    if ((s.isDrop(b) || first || due) && b - last >= minShot) {
      cuts.push(b);
      last = b;
    }
  }
  const tail = s.beats.filter((b) => end - ENDING - s.period * 2 <= b && b <= end - 0.8 && b > start + minShot);
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
  let lastFlash = -1e9, nLoud = 0, lastPunch = -1e9, prevTr = "";
  let sinceTransition = pace.transitionEvery;
  const nexts = new Map(cuts.map((c, k) => [c, k + 1 < cuts.length ? cuts[k + 1] : end]));
  const used: Record<string, number> = {};
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
    const flash = key === "drop" || (key === "major_loud" && s.hit(c) >= MAJOR_HIT && c - lastFlash >= FLASH_GAP);
    const onBar = near(s.strong, c, 0.06);
    const smoothT = everyBeat || c === hero || pr.wantsTransition(pace, sinceTransition, onBar);
    let kind: string, dur: number;
    if (flash) {
      lastFlash = c;
      [kind, dur] = ["flash", TRANSITIONS.drop[1]];
    } else if (!smoothT) {
      [kind, dur] = ["cut", 0];
      sinceTransition++;
    } else {
      sinceTransition = 0;
      const group = c === hero ? "hero" : t === "rise" ? "rise" : t === "fall" ? "fall" : key in TRANSITIONS ? key : "beat_loud";
      const [choices, want] = TRANSITIONS[group];
      const prevCut = Math.max(start, ...cuts.filter((x) => x < c));
      const room = Math.min(c - prevCut, nexts.get(c)! - c);
      dur = !everyBeat ? pr.transitionSeconds(pace, want, s.period, room) : Math.min(want, round(s.period * 0.45, 2));
      let nn = used[group] ?? 0;
      kind = choices[nn % choices.length];
      if (kind === prevTr && choices.length > 1) {
        nn++;
        kind = choices[nn % choices.length];
      }
      used[group] = nn + 1;
      if (dur < 0.08) [kind, dur] = ["cut", 0];
    }
    prevTr = kind;
    rows.push({ t: round(c, 3), kind: "cut", shot, effect, effectLabel: label, transition: kind, tdur: dur, transitionLabel: TRANSITION_LABEL[kind] ?? kind, why });
  }
  const cutTimes = rows.map((r) => r.t);
  const preDrop = new Set(preDropRolls(s, cutTimes.filter((c) => s.isDrop(c))));
  let flashes = rows.filter((r) => r.transition === "flash").map((r) => r.t).sort((x, y) => x - y);
  let punches = rows.filter((r) => r.effect === "punch" || r.effect === "crash_zoom").map((r) => r.t).sort((x, y) => x - y);
  const shotHasHit = (t: number) => {
    const i = bisectLeft(cutTimes, t);
    const a0 = i > 0 ? cutTimes[i - 1] : start, b0 = i < cutTimes.length ? cutTimes[i] : end;
    return rows.some((r) => a0 < r.t && r.t < b0 && (r.kind === "hit" || r.kind === "flash"));
  };
  const hit = (t: number, kind: string, shot: string, effect: string, effectLabel: string, why: string): Row => ({ t: round(t, 3), kind, shot, effect, effectLabel, transition: "", why });
  for (const t of s.hardSubs(start + 0.2, end - 0.2)) {
    const i = bisectLeft(cutTimes, t);
    const nxt = i < cutTimes.length ? cutTimes[i] : null;
    const prev = i > 0 ? cutTimes[i - 1] : null;
    if (nxt !== null && CLOSE_HIT <= nxt - t && nxt - t < FLASH_MARGIN) rows.push(hit(t, "ramp", "Speed up into the next cut", "speed_ramp", "Speed ramp", `a hard hit ${fixed(nxt - t, 2)} s before the cut`));
    else if (prev !== null && CLOSE_HIT <= t - prev && t - prev < FLASH_MARGIN) rows.push(hit(t, "zoom", "Punch-in on the new shot", "punch", "Quick punch-in", `a hard hit ${fixed(t - prev, 2)} s after the cut`));
    else if (hero !== null && t > hero) rows.push(hit(t, "hit", "Punch on the hit (hero shot)", "beat_punch", "Punch", "a hard hit in the ending"));
    else if (preDrop.has(t)) rows.push(hit(t, "hit", "Stutter punch (roll into the drop)", "beat_stutter", "Strong stutter punch", "a hard hit in the roll into the drop"));
    else if (!near(cutTimes, t, FLASH_MARGIN) && near(flashes, t, FLASH_GAP) && (shotHasHit(t) || near(punches, t, PUNCH_GAP))) {
      if (!shotHasHit(t)) rows.push(hit(t, "hit", "Soft pulse on the hit (same shot)", "zoom_pulse", "Soft pulse", "a hard hit soon after a punch"));
    } else if (!near(cutTimes, t, FLASH_MARGIN) && near(flashes, t, FLASH_GAP)) {
      punches = [...punches, t].sort((x, y) => x - y);
      rows.push(hit(t, "hit", "Punch on the hit (same shot)", "beat_punch", "Strong punch", "a hard hit between beats"));
    } else if (!near(cutTimes, t, FLASH_MARGIN)) {
      flashes = [...flashes, t].sort((x, y) => x - y);
      rows.push(hit(t, "flash", "Flash on the hit (same shot)", "beat_flash", "Flash", "a hard hit between beats"));
    }
  }
  const marked = new Set(rows.map((r) => r.t));
  for (const t of [...preDrop].sort((x, y) => x - y)) {
    if (start + CLOSE_HIT < t && t < end - CLOSE_HIT && !marked.has(round(t, 3)) && !near(cutTimes, t, CLOSE_HIT)) {
      rows.push(hit(t, "hit", "Stutter punch (roll into the drop)", "beat_stutter", "Stutter punch", "the roll into the drop"));
      marked.add(round(t, 3));
    }
  }
  const bounds = [...cutTimes, end];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const a0 = bounds[k], b0 = bounds[k + 1];
    if (rows.some((r) => a0 < r.t && r.t < b0 && r.kind !== "cut")) continue;
    const cands = s.subs.filter((t) => a0 + FLASH_MARGIN <= t && t <= b0 - FLASH_MARGIN && MEDIUM_SUB <= s.hit(t, 0.06) && s.hit(t, 0.06) < HARD_SUB && !s.groove(t) && !near(punches, t, PUNCH_GAP));
    if (cands.length) {
      const t = cands.reduce((best, x) => (s.hit(x, 0.06) > s.hit(best, 0.06) ? x : best), cands[0]);
      punches = [...punches, t].sort((x, y) => x - y);
      rows.push(hit(t, "hit", "Punch on the accent (same shot)", "beat_punch", "Punch", "an accent between beats"));
    }
  }
  const ordered = rows.map((r, i) => [r, i] as const).sort((x, y) => x[0].t - y[0].t || x[1] - y[1]).map(([r]) => r);
  const shots = ordered.filter((r) => r.kind === "cut");
  shots.forEach((sh, k) => {
    sh.end = round(k + 1 < shots.length ? shots[k + 1].t : end, 3);
    const lastShot = k + 1 === shots.length;
    const shEnd = sh.end as number;
    const beatsIn = s.beats.filter((b) => sh.t + CLOSE_HIT < b && b < (lastShot ? shEnd + 1e-6 : shEnd - CLOSE_HIT));
    const hitsIn = ordered.filter((r) => ["hit", "ramp", "zoom"].includes(r.kind) && sh.t < r.t && r.t < shEnd).map((r) => r.t);
    const inside = [...new Set([...beatsIn.map((b) => round(b, 3)), ...hitsIn])].sort((x, y) => x - y);
    if (inside.length) {
      const fast = ordered.some((r) => r.effect === "beat_stutter" && sh.t < r.t && r.t < shEnd);
      if (sh.effect !== "crash_zoom") {
        const hitsHere = ordered.some((r) => r.kind === "hit" && r.effect === "beat_punch" && sh.t < r.t && r.t < shEnd);
        sh.effect = fast ? "beat_stutter" : hitsHere ? "beat_punch" : "zoom_pulse";
      }
      const what: string[] = [];
      if (beatsIn.length) what.push(`${beatsIn.length} beat${beatsIn.length > 1 ? "s" : ""}`);
      if (hitsIn.length) what.push(`${hitsIn.length} hit${hitsIn.length > 1 ? "s" : ""}`);
      const kindLabel = sh.effect === "crash_zoom" ? "punches" : fast ? "stutter punches" : sh.effect === "beat_punch" ? "punch" : "soft pulse";
      sh.effectLabel = `${sh.transition !== "fade_in" ? sh.effectLabel : "Fade in"} + ${kindLabel} on ${what.join(" and ")}`;
      sh.pulses = inside;
    }
  });
  for (const r of ordered) if (!("end" in r)) r.end = r.t;
  return ordered;
}

/** Song times the picture must answer inside the shots: the beats a shot holds over (it pulses on them). */
export const planHits = (rows: Row[]) => [...new Set(rows.flatMap((r) => (r.pulses as number[] | undefined) ?? []))].sort((x, y) => x - y);

/** Beats and hard hits from start to end that the plan does not mark (should be none). */
export function missedBeats(a: AudioAnalysis, rows: Row[], start: number, end: number): number[] {
  const s = new Song(a);
  const marked = [...rows.map((r) => r.t), ...planHits(rows)].sort((x, y) => x - y);
  const out = s.beats.filter((b) => start + CLOSE_HIT < b && b < end - CLOSE_HIT && !near(marked, b, CLOSE_HIT));
  const shots = rows.filter((r) => r.kind === "cut");
  const marks = rows.filter((r) => ["hit", "flash", "ramp", "zoom"].includes(r.kind)).map((r) => r.t);
  for (const t of s.hardSubs(start + 0.2, end - 0.2)) {
    if (near(marked, t, CLOSE_HIT)) continue;
    const shot = shots.find((r) => r.t <= t && t < (r.end as number));
    if (!shot || !marks.some((m) => shot.t < m && m < (shot.end as number))) out.push(t);
  }
  return out.sort((x, y) => x - y);
}
