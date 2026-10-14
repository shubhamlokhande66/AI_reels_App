import { round } from "@/server/core/py";
import { energyAt, meanEnergy, type AudioAnalysis } from "@/server/models/analysis";

/** The song as an editor reads it (was director/music_map.py): beat levels, bars, phrases, pauses, energy curve, all in
 * Reel time. Built from the existing analysis. */

export const LEVEL_NAMES: Record<number, string> = { 1: "subtle", 2: "normal", 3: "strong", 4: "major" };
export const LEVEL_ACTION: Record<number, string> = { 1: "micro movement", 2: "camera movement", 3: "cut / zoom / text", 4: "reveal / major transition" };
const ENERGY_LEVELS: [number, string][] = [[0.85, "very_high"], [0.6, "high"], [0.35, "medium"], [0, "low"]];
const PAUSE_LEVEL = 0.08, PAUSE_MIN = 0.35, ACCENT_NEAR = 0.09, ACCENT_NORMAL = 0.55, ACCENT_STRONG = 0.9, DROP_NEAR = 0.15;

export interface Beat { t: number; level: number; downbeat: boolean }
export interface MusicMap {
  bpm: number; beats: Beat[]; bars: number[]; phrases: number[]; drops: number[]; pauses: [number, number][];
  energyCurve: [number, number, string][]; accents: [number, number][]; sections: Record<string, unknown>[]; points: Record<string, unknown>[];
}

export function sectionAt(mm: MusicMap, t: number) {
  return mm.sections.find((s) => (s.start as number) - 1e-6 <= t && t < (s.end as number)) ?? mm.sections[mm.sections.length - 1] ?? null;
}
export function levelAt(mm: MusicMap, t: number, tol = 0.06): number {
  if (!mm.beats.length) return 1;
  const b = mm.beats.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), mm.beats[0]);
  return Math.abs(b.t - t) <= tol ? b.level : 1;
}
/** Beat-grid times plus real strong accents: what "on the beat" means to a human editor. */
export const snapPoints = (mm: MusicMap) => [...new Set([...mm.beats.map((b) => b.t), ...mm.accents.filter(([, s]) => s >= 0.6).map(([a]) => a)])].sort((a, b) => a - b);
export function energyAtMap(mm: MusicMap, t: number): string {
  for (const [a, b, n] of mm.energyCurve) if (a - 1e-6 <= t && t < b) return n;
  return mm.energyCurve.length ? mm.energyCurve[mm.energyCurve.length - 1][2] : "medium";
}
export function musicMapDoc(mm: MusicMap) {
  return {
    bpm: round(mm.bpm, 1), beats: mm.beats.map((b) => ({ t: round(b.t, 3), level: b.level, downbeat: b.downbeat })),
    accents: mm.accents.map(([t, s]) => ({ t: round(t, 3), strength: round(s, 3) })), bars: mm.bars.map((t) => round(t, 3)), phrases: mm.phrases.map((t) => round(t, 3)),
    drops: mm.drops.map((t) => round(t, 3)), pauses: mm.pauses.map(([a, b]) => ({ start: round(a, 3), end: round(b, 3) })),
    energyCurve: mm.energyCurve.map(([a, b, n]) => ({ start: round(a, 2), end: round(b, 2), level: n })), sections: [...mm.sections], timeline: [...mm.points],
    notDetected: ["exact vocal entries and emphasis (vocal presence is estimated, not separated)"],
  };
}

export const energyName = (e: number) => ENERGY_LEVELS.find(([floor]) => e >= floor)![1];

function curve(audio: AudioAnalysis, start: number, duration: number): [number, number, string][] {
  const cells: [number, number, string][] = [];
  for (let t = 0; t < duration - 1e-6; t += 0.5) cells.push([t, Math.min(t + 0.5, duration), energyName(meanEnergy(audio, start + t, start + Math.min(t + 0.5, duration)))]);
  const join = (xs: [number, number, string][], absorb: boolean) => {
    const out: [number, number, string][] = [];
    for (const r of xs) {
      const last = out[out.length - 1];
      if (last && (absorb ? r[1] - r[0] < 1 : last[2] === r[2])) last[1] = r[1];
      else out.push([...r]);
    }
    return out;
  };
  return join(join(join(cells, false), true), false);
}

const ENERGY_MAX_SHOT: Record<string, number> = { very_high: 2.2, high: 3.0 };
const PACE_SCALE: Record<string, number> = { calm: 1.8, balanced: 1, fast: 0.75 };
const LOUDNESS: Record<string, number> = { low: 0, medium: 1, high: 2, very_high: 3 };

/** (energy, longest shot it allows) when at least half of a shot is in a loud part; null in calm music. */
export function loudLimit(mm: MusicMap, a: number, b: number, pace = "balanced"): [string, number] | null {
  const cover: Record<string, number> = {};
  for (const [s0, s1, n] of mm.energyCurve) cover[n] = (cover[n] ?? 0) + Math.max(0, Math.min(b, s1) - Math.max(a, s0));
  for (const name of ["very_high", "high"]) {
    const loud = Object.entries(cover).filter(([k]) => (LOUDNESS[k] ?? 0) >= LOUDNESS[name]).reduce((s, [, v]) => s + v, 0);
    if (b > a && loud >= 0.5 * (b - a)) return [name, round(ENERGY_MAX_SHOT[name] * (PACE_SCALE[pace] ?? 1), 2)];
  }
  return null;
}

/** Song seconds of every strong hit (strong beats and strong accents), for beat-reactive effects. */
export function songHits(audio: AudioAnalysis, minGap = 0.08): number[] {
  const ts = [...new Set([...audio.strongBeats, ...audio.accents.filter((_, i) => audio.accentStrengths[i] >= 0.6)])].sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of ts) if (!out.length || t - out[out.length - 1] >= minGap) out.push(round(t, 3));
  return out;
}

export function buildMusicMap(audio: AudioAnalysis, start: number, duration: number): MusicMap {
  const rel = (t: number) => round(t - start, 3), inside = (t: number) => -0.03 <= t - start && t - start <= duration + 0.03;
  const strong = new Set(audio.strongBeats.filter(inside).map(rel));
  const drops = audio.drops.filter(inside).map(rel);
  const accents: [number, number][] = audio.accents.map((t, i) => [t, audio.accentStrengths[i]] as [number, number]).filter(([t]) => inside(t)).map(([t, s]) => [rel(t), s]);
  const beats: Beat[] = audio.beats.filter(inside).map((b) => {
    const t = Math.max(rel(b), 0);
    const near = accents.filter(([a]) => Math.abs(a - t) <= ACCENT_NEAR).map(([, s]) => s);
    const hit = near.length ? Math.max(...near) : 0;
    const level = drops.some((d) => Math.abs(d - t) <= DROP_NEAR) ? 4 : strong.has(t) || strong.has(rel(b)) || hit >= ACCENT_STRONG ? 3 : hit >= ACCENT_NORMAL ? 2 : 1;
    return { t: round(t, 3), level, downbeat: strong.has(rel(b)) };
  });
  const bars = beats.filter((b) => b.downbeat).map((b) => b.t), phrases = bars.filter((_, i) => i % 4 === 0);
  const pauses: [number, number][] = [];
  let lo: number | null = null;
  const n = Math.trunc(duration / audio.energyHop);
  for (let i = 0; i <= n; i++) {
    const low = energyAt(audio, start + i * audio.energyHop) < PAUSE_LEVEL && i < n;
    if (low && lo === null) lo = i * audio.energyHop;
    else if (!low && lo !== null) {
      if (i * audio.energyHop - lo >= PAUSE_MIN) pauses.push([round(lo, 3), round(i * audio.energyHop, 3)]);
      lo = null;
    }
  }
  const sections = audio.songSections.filter((s) => s.end > start + 0.05 && s.start < start + duration - 0.05).map((s) => ({
    start: round(Math.max(s.start - start, 0), 2), end: round(Math.min(s.end - start, duration), 2), label: s.label, energy: s.energy, vocal: s.vocal,
    density: s.density, cutOn: s.cutOn, confidence: s.confidence,
  }));
  const points = beats.map((b) => {
    const sec = sections.find((s) => s.start - 1e-6 <= b.t && b.t < s.end) ?? sections[sections.length - 1] ?? null;
    const ps = phrases.filter((p) => p <= b.t + 1e-6), nxt = phrases.filter((p) => p > b.t + 1e-6);
    const base = ps.length ? ps[ps.length - 1] : 0, span = (nxt.length ? nxt[0] : duration) - base;
    const hits = accents.filter(([a]) => Math.abs(a - b.t) <= ACCENT_NEAR).map(([, s]) => s);
    return { time: b.t, section: sec?.label ?? null, energy: round(energyAt(audio, start + b.t), 3), beatStrength: round(Math.max(hits.length ? Math.max(...hits) : 0, b.level / 4), 3),
      phrasePosition: span > 0 ? round((b.t - base) / span, 3) : 0 };
  });
  return { bpm: audio.bpm, beats, bars, phrases, drops, pauses, energyCurve: curve(audio, start, duration), accents, sections, points };
}
