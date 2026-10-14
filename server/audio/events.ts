import { round } from "@/server/core/py";
import type { AudioAnalysis } from "@/server/models/analysis";
import { songTrends } from "./beatmap";
import * as sp from "./dsp/spectral";
import { clip, Mat, max as vmax, mean, percentile } from "./dsp/util";

/** Every audio event of a song in the editor's vocabulary (was backend/app/audio/events.py): beats by strength
 * (STRONG / MAIN / WEAK, DOWNBEAT tag), SUB_BEAT, IMPACT, BASS_HIT, PERCUSSION_HIT, ONSET, and stretches (SILENCE,
 * REVERB_TAIL, ENERGY_RISE / DROP, MUSIC_DROP, BUILD_UP, FILL, SECTION_CHANGE, TEMPO_CHANGE, PHRASE_END, VOCAL_ENTRY /
 * PAUSE). Downbeats, phrases and vocals are estimates, each with its confidence. */

export const HIT_TYPES = ["STRONG_BEAT", "MAIN_BEAT", "WEAK_BEAT", "SUB_BEAT", "IMPACT", "BASS_HIT", "PERCUSSION_HIT", "ONSET"];
const HOP = 512, DEDUP = 0.05, STRENGTH_PCT = 99, IMPACT_PCT = 97, IMPACT_RISE = 0.25;
const BASS_HZ = 150, BASS_SHARE = 0.75, PERC_SHARE = 0.5, PERC_HOP = 1024, FILL_GAP = 0.25, FILL_HITS = 4, SILENCE_DB = -50, SILENCE_MIN = 1;
const TAIL_MIN = 0.6, TAIL_DB = 6, VOCAL_ON = 0.55, VOCAL_OFF = 0.3, VOCAL_HOLD = 1, PHRASE_BARS = 4;

export interface SongEvent {
  time: number; eventType: string; confidence: number; onsetStrength: number; rmsEnergy: number; subdivision: boolean;
  end: number | null; tags: string[]; details: Record<string, number>;
}

class Signal {
  envScale: number; bassScale: number; rmsScale: number; impactLevel: number;
  pOn: Float64Array; hOn: Float64Array; bassEnv: Float64Array; rms: Float64Array; db: Float64Array;
  constructor(y: Float32Array, public sr: number, public env: Float64Array) {
    const S = sp.stftMag(y, 2048, HOP);
    const freqs = sp.fftFrequencies(sr, 2048);
    const Sc = sp.stftMag(y, 1024, PERC_HOP);
    const [harm, perc] = sp.hpss(Sc, [17, 17]);
    const pOn = sp.onsetStrengthS(sp.amplitudeToDb(perc, "max"), 2048, PERC_HOP);
    const hOn = sp.onsetStrengthS(sp.amplitudeToDb(harm, "max"), 2048, PERC_HOP);
    const ps = percentile(pOn, 99) || 1, hs = percentile(hOn, 99) || 1;
    this.pOn = pOn.map((v) => v / ps);
    this.hOn = hOn.map((v) => v / hs);
    const lowRows = Array.from(freqs).filter((f) => f <= BASS_HZ).length;
    this.bassEnv = sp.onsetStrengthS(sp.amplitudeToDb(new Mat(lowRows, S.cols, S.data.slice(0, lowRows * S.cols)), "max"));
    this.rms = sp.rmsS(S, 2048);
    this.db = sp.amplitudeToDb1(this.rms, 1);
    this.envScale = percentile(env, STRENGTH_PCT) || 1;
    this.bassScale = percentile(this.bassEnv, STRENGTH_PCT) || 1;
    this.rmsScale = percentile(this.rms, 95) || 1;
    this.impactLevel = percentile(env, IMPACT_PCT);
  }
  frame(t: number) {
    return clip(sp.timeToFrames(t, this.sr, HOP), 0, this.env.length - 1);
  }
  peak(curve: Float64Array, t: number, r = 2) {
    const f = Math.min(this.frame(t), curve.length - 1);
    return vmax(curve, Math.max(f - r, 0), Math.min(f + r + 1, curve.length));
  }
  onset(t: number) { return clip(this.peak(this.env, t) / this.envScale, 0, 1); }
  energy(t: number) { return clip(this.peak(this.rms, t, 1) / this.rmsScale, 0, 1); }
  energyJump(t: number) {
    const f = Math.min(this.frame(t), this.rms.length - 1);
    const before = f > 1 ? mean(this.rms, Math.max(f - 8, 0), Math.max(f - 1, 1)) : 0;
    return (mean(this.rms, f, Math.min(f + 6, this.rms.length)) - before) / this.rmsScale;
  }
  bass(t: number) { return clip(this.peak(this.bassEnv, t) / this.bassScale, 0, 1); }
  percussive(t: number) {
    const f = clip(sp.timeToFrames(t, this.sr, PERC_HOP), 0, this.pOn.length - 1);
    const p = vmax(this.pOn, Math.max(f - 1, 0), f + 2), h = vmax(this.hOn, Math.max(f - 1, 0), f + 2);
    return p + h > 0 ? p / (p + h) : 0;
  }
}

const r3 = (x: number) => round(x, 3);
const rDetails = (d: Record<string, number>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, round(v, 3)]));

function hitEvent(sig: Signal, t: number, kind: string, conf: number, tags: string[], subdivision = false, details: Record<string, number> = {}): SongEvent {
  return { time: r3(t), eventType: kind, confidence: round(clip(conf, 0, 1), 2), onsetStrength: round(sig.onset(t), 2), rmsEnergy: round(sig.energy(t), 2), subdivision, end: null, tags, details: rDetails(details) };
}
function spanEvent(sig: Signal, t: number, end: number | null, kind: string, conf: number, details: Record<string, number> = {}): SongEvent {
  return { time: r3(t), end: end === null ? null : r3(end), eventType: kind, confidence: round(clip(conf, 0, 1), 2), onsetStrength: round(sig.onset(t), 2), rmsEnergy: round(sig.energy(t), 2), subdivision: false, tags: [], details: rDetails(details) };
}

function extraTags(sig: Signal, t: number): string[] {
  const tags: string[] = [];
  if (sig.peak(sig.env, t) >= sig.impactLevel && sig.energyJump(t) >= IMPACT_RISE) tags.push("IMPACT");
  if (sig.bass(t) >= BASS_SHARE) tags.push("BASS_HIT");
  if (sig.percussive(t) >= PERC_SHARE && sig.onset(t) >= 0.25) tags.push("PERCUSSION_HIT");
  return tags;
}

function hitEvents(a: AudioAnalysis, sig: Signal): SongEvent[] {
  const beats = a.beats;
  const down = new Set(a.downbeats.map(r3));
  const conf = a.beatConfidences.length === beats.length ? a.beatConfidences : beats.map(() => a.beatConfidence);
  const strength = beats.map((t) => sig.onset(t));
  const out: SongEvent[] = [];
  // every beat as the tracker found it: a bar start (STRONG_BEAT, tagged DOWNBEAT) or a beat (MAIN_BEAT); no weak / strong
  // guessing from loudness, no sub-beats
  beats.forEach((t, k) => {
    const bar = down.has(r3(t));
    out.push(hitEvent(sig, t, bar ? "STRONG_BEAT" : "MAIN_BEAT", conf[k], bar ? ["DOWNBEAT"] : [], false, { position: a.beatPositions[k] ?? null, strength: strength[k] }));
  });
  // between the beats only the real impacts (a hit that stands out), not every small onset
  for (const t of a.onsets) {
    if (beats.length && Math.min(...beats.map((b) => Math.abs(b - t))) <= DEDUP) continue;
    const tags = extraTags(sig, t);
    if (tags.includes("IMPACT")) out.push(hitEvent(sig, t, "IMPACT", 0.4 + 0.6 * sig.onset(t), tags.filter((x) => x !== "IMPACT"), false, { percussive_share: sig.percussive(t), bass: sig.bass(t) }));
  }
  return out;
}

function runs(mask: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start: number | null = null;
  [...mask, false].forEach((m, i) => {
    if (m && start === null) start = i;
    else if (!m && start !== null) { out.push([start, i]); start = null; }
  });
  return out;
}

function stretchEvents(a: AudioAnalysis, sig: Signal): SongEvent[] {
  const fps = sig.sr / HOP;
  const out: SongEvent[] = [];
  for (const [i, j] of runs(Array.from(sig.db, (d) => d < SILENCE_DB))) if ((j - i) / fps >= SILENCE_MIN) out.push(spanEvent(sig, i / fps, j / fps, "SILENCE", 0.95, { seconds: (j - i) / fps }));
  const hits = [...a.onsets, ...a.beats].sort((x, y) => x - y);
  for (let k = 0; k + 1 < hits.length; k++) {
    const x = hits[k], z = hits[k + 1];
    if (z - x < TAIL_MIN + 0.2) continue;
    const seg = sig.db.subarray(sig.frame(x + 0.1), sig.frame(z - 0.05));
    if (seg.length < 8 || Math.min(...seg) < SILENCE_DB) continue;
    const q = Math.max(Math.floor(seg.length / 5), 1);
    const fall = mean(seg, 0, q) - mean(seg, seg.length - q, seg.length);
    let down = 0;
    for (let i = 1; i < seg.length; i++) if (seg[i] - seg[i - 1] <= 0.5) down++;
    const steady = down / (seg.length - 1);
    if (fall >= TAIL_DB && steady >= 0.8) out.push(spanEvent(sig, x + 0.1, z - 0.05, "REVERB_TAIL", Math.min(1, 0.4 + fall / 30 + 0.2 * steady), { level_fall_db: fall }));
  }
  for (const tr of songTrends(a)) out.push(spanEvent(sig, tr.start, tr.end, tr.kind === "rise" ? "ENERGY_RISE" : "ENERGY_DROP", Math.min(1, 0.4 + Math.abs(tr.change)), { change: tr.change }));
  for (const ev of a.events) {
    if (ev.type === "possible_drop" || ev.type === "entry") out.push(spanEvent(sig, ev.time, null, "MUSIC_DROP", ev.confidence, { ...ev.measurements, from_silence: ev.type === "entry" ? 1 : 0 }));
    else if (ev.type === "build_up") out.push(spanEvent(sig, ev.time, ev.end, "BUILD_UP", ev.confidence, ev.measurements));
    else if (ev.type === "breakdown") out.push(spanEvent(sig, ev.time, ev.end, "ENERGY_DROP", ev.confidence, { ...ev.measurements, breakdown: 1 }));
  }
  const marks = [...new Set([...a.downbeats, ...a.songSections.filter((s) => s.start > 0).map((s) => s.start)])].sort((x, y) => x - y);
  let run: number[] = [];
  for (const t of [...[...a.onsets].sort((x, y) => x - y), Infinity]) {
    if (run.length && t - run[run.length - 1] <= FILL_GAP) { run.push(t); continue; }
    if (run.length >= FILL_HITS && run[run.length - 1] - run[0] <= 2.5) {
      const nxt = marks.find((m) => m > run[run.length - 1] - 0.05);
      if (nxt !== undefined && nxt - run[run.length - 1] <= 0.35) out.push(spanEvent(sig, run[0], run[run.length - 1], "FILL", 0.5 + 0.1 * Math.min(run.length - FILL_HITS, 4), { hits: run.length, leads_into: nxt }));
    }
    run = t !== Infinity ? [t] : [];
  }
  for (const s of a.songSections.slice(1)) out.push(spanEvent(sig, s.start, null, "SECTION_CHANGE", s.confidence || 0.6, { energy: s.energy }));
  for (let k = 1; k < a.tempoSections.length; k++) {
    const prev = a.tempoSections[k - 1], s = a.tempoSections[k];
    out.push(spanEvent(sig, s.start, null, "TEMPO_CHANGE", Math.min(prev.confidence, s.confidence), { bpm_before: prev.bpm, bpm_after: s.bpm }));
  }
  const downs = [...a.downbeats].sort((x, y) => x - y);
  for (let k = PHRASE_BARS; k < downs.length; k += PHRASE_BARS) {
    const before = a.beats.filter((b) => b < downs[k] - 0.01);
    if (before.length) out.push(spanEvent(sig, before[before.length - 1], downs[k], "PHRASE_END", 0.3 + 0.6 * a.downbeatConfidence, { bars: PHRASE_BARS }));
  }
  if (a.vocal.length) {
    const v = a.vocal, hop = a.curveHop;
    const hold = Math.max(Math.trunc(VOCAL_HOLD / hop), 1);
    let singing = false;
    for (let i = 0; i < v.length; i++) {
      const ahead = v.slice(i, i + hold);
      if (ahead.length !== hold) continue;
      const m = mean(ahead);
      if (!singing && Math.min(...ahead) >= VOCAL_ON) {
        out.push(spanEvent(sig, i * hop, null, "VOCAL_ENTRY", 0.35 + 0.4 * m, { presence: m }));
        singing = true;
      } else if (singing && Math.max(...ahead) <= VOCAL_OFF) {
        let back: number | null = null;
        for (let k = i + hold; k < v.length; k++) if (v[k] >= VOCAL_ON) { back = k; break; }
        out.push(spanEvent(sig, i * hop, back !== null ? back * hop : null, "VOCAL_PAUSE", 0.35 + 0.4 * (1 - m), { presence: m }));
        singing = false;
      }
    }
  }
  return out;
}

/** All the events, in time order (at the same moment: beats first, then the hits, then the stretches). */
export function songEvents(a: AudioAnalysis, y: Float32Array, sr: number, env: Float64Array): SongEvent[] {
  const sig = new Signal(y, sr, env);
  const order = (k: string) => { const i = HIT_TYPES.indexOf(k); return i < 0 ? 99 : i; };
  return [...hitEvents(a, sig), ...stretchEvents(a, sig)].filter((e) => e.time <= a.duration + 0.05)
    .map((e, i) => [e, i] as const).sort((x, y) => x[0].time - y[0].time || order(x[0].eventType) - order(y[0].eventType) || x[1] - y[1]).map(([e]) => e);
}
