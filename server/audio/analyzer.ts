import "server-only";
import fs from "node:fs";
import path from "node:path";
import { round } from "@/server/core/py";
import type { AudioAnalysis, Section } from "@/server/models/analysis";
import { withDefaults } from "@/server/models/analysis";
import * as cache from "@/server/services/analysisCache";
import { localPath, mediaPath } from "@/server/storage/local";
import { detectBeats } from "./beats";
import { checkAudio, decode } from "./decode";
import { detectEvents, dropsFrom, measurements } from "./drops";
import { agglomerative } from "./dsp/segment";
import * as sp from "./dsp/spectral";
import { argsortDesc, percentile, uniformFilter1d, vec } from "./dsp/util";
import { BEAT_THIS_SR, beatThis } from "./beatThis";
import { essentiaBeats, essentiaOnsets, essentiaPercivalBpm } from "./essentia";
import { computeCurves, CURVE_HOP, labelSections, structuralParts } from "./structure";
import { detectTransients, mergedHits } from "./transients";

/** The whole song analysis: decode, energy, Essentia's beats (kept exactly as detected), two independent tempo estimates,
 * SuperFlux onsets, transients per band, drops, sections, curves and labelled parts. Beats, onsets and transients are
 * separate lists: a transient is not a beat, and an onset is not necessarily an attack. Cached by the song's content. */

export const SR = 22050;
export const ESSENTIA_SR = 44100;
export const MAX_SECONDS = 600;
export const ENERGY_HOP = 0.1;
/** 11 = beats and bar starts from the neural tracker Beat This! (Essentia as the fallback), beat positions in the bar;
 * 10 = Essentia's beats never changed afterwards, PercivalBpmEstimator as a second tempo estimate, transients per band
 * (impacts), bars only with evidence; 9 = beats moved onto nearby hits (older caches are redone) */
export const ANALYSIS_VERSION = 11;

export type StageFn = (stage: string, progress: number) => void;

/** RMS every ENERGY_HOP s, smoothed and normalised to 0..1. */
export function computeEnergy(y: Float32Array, sr: number): Float64Array {
  const hop = Math.trunc(sr * ENERGY_HOP);
  const rms = uniformFilter1d(sp.rmsY(y, hop * 4, hop), 3);
  const lo = percentile(rms, 5), hi = percentile(rms, 95);
  if (hi - lo < 1e-9) return vec(rms.length).fill(0.5);
  return rms.map((v) => Math.min(Math.max((v - lo) / (hi - lo), 0), 1));
}

function runs(mask: boolean[], dt: number, minLen: number, maxGap: number): Section[] {
  const rs: [number, number][] = [];
  let start: number | null = null;
  mask.forEach((m, i) => {
    if (m && start === null) start = i;
    else if (!m && start !== null) { rs.push([start, i]); start = null; }
  });
  if (start !== null) rs.push([start, mask.length]);
  const merged: [number, number][] = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (last && (r[0] - last[1]) * dt <= maxGap) last[1] = r[1];
    else merged.push([r[0], r[1]]);
  }
  return merged.filter(([a, b]) => (b - a) * dt >= minLen).map(([a, b]) => ({ start: round(a * dt, 2), end: round(b * dt, 2) }));
}

export function highEnergySections(energy: Float64Array, dt = ENERGY_HOP): Section[] {
  if (!energy.length) return [];
  const smooth = uniformFilter1d(energy, Math.max(Math.trunc(1 / dt), 1));
  const thr = Math.max(percentile(smooth, 60), 0.5);
  return runs(Array.from(smooth, (v) => v >= thr), dt, 2, 1);
}

const nearest = (xs: number[], t: number) => xs.reduce((best, b) => (Math.abs(b - t) < Math.abs(best - t) ? b : best), xs[0]);

/** Moments where energy jumps sharply (the fallback when the drop detector has too little song). */
/** [cut points (the nearest beat), measured times] of sudden energy rises */
export function findDrops(energy: Float64Array, beats: number[], dt = ENERGY_HOP): [number[], number[]] {
  const w = Math.trunc(2 / dt);
  if (energy.length < 2 * w + 1) return [[], []];
  const c = vec(energy.length + 1);
  for (let i = 0; i < energy.length; i++) c[i + 1] = c[i] + energy[i];
  const idx = Array.from({ length: energy.length - 2 * w }, (_, k) => k + w);
  const jump = idx.map((i) => (c[i + w] - c[i]) / w - (c[i] - c[i - w]) / w);
  const drops: number[] = [];
  for (const i of argsortDesc(jump)) {
    if (jump[i] < 0.25) break;
    const t = idx[i] * dt;
    if (drops.every((d) => Math.abs(t - d) > 8)) drops.push(t);
  }
  drops.sort((a, b) => a - b);
  return [drops.map((t) => (beats.length ? round(nearest(beats, t), 3) : round(t, 2))), drops.map((t) => round(t, 2))];
}

/** Individual strong hits: onset peaks well above their surroundings, strength against a typical strong hit (97th pct). */
export function findAccents(env: Float64Array, sr: number): [number[], number[]] {
  if (env.length < 20 || Math.max(...env) <= 0) return [[], []];
  const scale = percentile(env, 97);
  if (scale <= 1e-6) return [[], []];
  const frames = sp.peakPick(env, 6, 6, 12, 12, 0.4 * scale, 10);
  const keep = frames.map((f) => [round(sp.framesToTime(f, sr), 3), round(Math.min(Math.max(env[f] / scale, 0), 1), 3)] as const).filter(([, s]) => s >= 0.35);
  return [keep.map(([t]) => t), keep.map(([, s]) => s)];
}

/** Coarse structure: agglomerative clustering of MFCCs, snapped to beats. */
export function findSections(y: Float32Array, sr: number, beats: number[], duration: number): Section[] {
  if (duration < 12) return [{ start: 0, end: round(duration, 2) }];
  const k = Math.trunc(Math.min(Math.max(round(duration / 20), 2), 8));
  const times = agglomerative(sp.mfcc(y, sr, 13, 512 * 4), k).map((f) => sp.framesToTime(f, sr, 512 * 4));
  const edges = [0];
  for (const t of times) {
    if (t <= 0.5 || t >= duration - 0.5) continue;
    edges.push(beats.length ? nearest(beats, t) : t);
  }
  const uniq = [...new Set(edges.map((e) => round(e, 2)))].sort((a, b) => a - b);
  uniq.push(round(duration, 2));
  return uniq.slice(0, -1).map((a, i) => ({ start: a, end: uniq[i + 1] })).filter((s) => s.end - s.start > 1);
}

export async function analyzeAudio(file: string, onStage: StageFn = () => {}, maxSeconds = MAX_SECONDS): Promise<AudioAnalysis> {
  return (await analyzeWithSignal(file, onStage, maxSeconds)).analysis;
}

/** The analysis and the decoded song it came from (the analysis JSON reads both). */
export async function analyzeWithSignal(file: string, onStage: StageFn = () => {}, maxSeconds = MAX_SECONDS): Promise<{ analysis: AudioAnalysis; y: Float32Array; env: Float64Array }> {
  onStage("analyzing_music", 0);
  const [y, y44, yMean] = await Promise.all([decode(file, SR, maxSeconds), decode(file, ESSENTIA_SR, maxSeconds), decode(file, BEAT_THIS_SR, maxSeconds, "mean")]);
  checkAudio(y, SR);
  // Essentia's beat tracker and onsets run in their own threads while this one measures the rest
  const essBeats = essentiaBeats(y44);
  const essOnsets = essentiaOnsets(y44);
  const essPercival = essentiaPercivalBpm(y44).catch(() => null); // a second opinion only: the analysis goes on without it
  // the beats and bar starts: the neural tracker; if it cannot run, Essentia's beats are used instead
  const net = beatThis(yMean).catch((e) => { console.warn(`Beat This! failed, using Essentia's beats: ${e}`); return null; });
  const duration = y.length / SR;
  onStage("analyzing_music", 0.4);
  const energy = computeEnergy(y, SR);
  const env = sp.onsetStrength(y, SR, 512);
  const hi = highEnergySections(energy);
  onStage("analyzing_music", 1);
  onStage("detecting_beats", 0);
  const beat = detectBeats(await essBeats, await essOnsets, env, duration, await essPercival, { y, sr: SR }, await net);
  const transients = detectTransients(y, SR);
  onStage("detecting_beats", 0.6);
  const events = detectEvents(measurements(y, SR, env, beat.onsets), beat.beats);
  const [drops, dropTimes] = events.length ? [dropsFrom(events), dropsFrom(events)] : findDrops(energy, beat.beats); // events are measured times
  const sections = findSections(y, SR, beat.beats, duration);
  onStage("detecting_beats", 1);
  const [accents, strengths] = mergedHits(transients); // impacts: the attacks found in any band
  const curves = computeCurves(y, SR, beat.onsets);
  const e = Array.from(energy);
  const labelled = labelSections(structuralParts(y, SR, beat.beats, duration, e, ENERGY_HOP, drops), e, ENERGY_HOP, drops, curves);
  const analysis = withDefaults({
    bpm: beat.bpm, duration: round(duration, 3), beats: beat.beats, beatConfidence: beat.confidence, beatSource: beat.beatSource,
    essentiaConfidence: beat.essentiaConfidence, beatPositions: beat.beatPositions, bpmEstimates: beat.bpmEstimates, bpmAgreement: beat.bpmAgreement, meter: beat.meter,
    // the bar starts, only when the bar phase is clear (no per-beat strong / medium labels)
    strongBeats: beat.downbeats, onsets: beat.onsets, transients, accents, accentStrengths: strengths,
    analysisVersion: ANALYSIS_VERSION, highEnergySections: hi, sections, drops, dropTimes, energyHop: ENERGY_HOP, energy: e.map((v) => round(v, 3)),
    curveHop: CURVE_HOP, loudnessDb: curves.loudnessDb, brightness: curves.brightness, density: curves.density, vocal: curves.vocal, songSections: labelled,
    tempoSections: beat.tempoSections, beatConfidences: beat.beatConfidences, downbeats: beat.downbeats, downbeatConfidence: beat.downbeatConfidence, events,
  });
  return { analysis, y, env };
}

const audioKey = (projectId: string, mediaId: string) => `projects/${projectId}/analysis/audio_${mediaId}.json`;

/** A project's song analysis: the project's own copy, else the shared one (the same song analysed anywhere before),
 * else analysed now - and kept in both. */
export async function analyzeMusic(projectId: string, audio: { id: string; key: string }, onStage: StageFn = () => {}): Promise<AudioAnalysis> {
  const own = localPath(audioKey(projectId, audio.id));
  try {
    const doc = JSON.parse(fs.readFileSync(own, "utf8")) as AudioAnalysis;
    if ((doc.analysisVersion ?? 1) >= ANALYSIS_VERSION) {
      onStage("analyzing_music", 1);
      onStage("detecting_beats", 1);
      return withDefaults(doc);
    }
  } catch { /* none yet */ }
  const digest = await cache.contentHash(audio.key);
  const hit = cache.load<AudioAnalysis>(digest, "audio", ANALYSIS_VERSION);
  const a = hit ? withDefaults(hit) : await analyzeAudio(await mediaPath(audio.key), onStage);
  fs.mkdirSync(path.dirname(own), { recursive: true });
  fs.writeFileSync(own, JSON.stringify(a));
  if (!hit) cache.save(digest, "audio", ANALYSIS_VERSION, a);
  onStage("analyzing_music", 1);
  onStage("detecting_beats", 1);
  return a;
}
