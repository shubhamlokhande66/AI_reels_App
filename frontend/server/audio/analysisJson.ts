import "server-only";
import { AppError } from "@/server/core/errors";
import { probe } from "@/server/core/ffmpeg";
import { round } from "@/server/core/py";
import { analyzeWithSignal, SR } from "./analyzer";
import * as sp from "./dsp/spectral";
import { clip, max as vmax, mean, percentile } from "./dsp/util";
import { songEvents } from "./events";

/** The song analysis as one JSON document - what was measured, nothing decided yet (was backend/app/audio/
 * analysis_json.py): tempo, beats, onsets, frame features, events, silences, candidate changes. Plus the agreed shape
 * and schema 1.0 (what video editing needs, small). */

const HOP = 512, FRAME_LENGTH = 2048, MAX_SECONDS = 3600, ROLL_GAP: [number, number] = [0.1, 0.25], ROLL_HITS = 3;
const CHANGE_TYPES = ["SECTION_CHANGE", "TEMPO_CHANGE"];
const SOURCE: Record<string, string> = {
  MAIN_BEAT: "essentia_rhythm_extractor", STRONG_BEAT: "essentia_rhythm_extractor", WEAK_BEAT: "essentia_rhythm_extractor",
  SUB_BEAT: "essentia_superflux", ONSET: "essentia_superflux", IMPACT: "essentia_superflux", PERCUSSION_HIT: "hpss",
  BASS_HIT: "low_band_onset", SILENCE: "rms_threshold", REVERB_TAIL: "rms_decay", MUSIC_DROP: "multi_feature_change", BUILD_UP: "multi_feature_change",
  ENERGY_RISE: "energy_trend", ENERGY_DROP: "energy_trend", FILL: "onset_run", ROLL: "onset_run", PHRASE_END: "downbeat_estimate",
  VOCAL_ENTRY: "vocal_heuristic", VOCAL_PAUSE: "vocal_heuristic", SECTION_CHANGE: "mfcc_segmentation", TEMPO_CHANGE: "local_tempogram",
};

type Doc = Record<string, unknown> & {
  status: string; audio: Record<string, unknown>; analysis_config: Record<string, unknown>; tempo: Record<string, unknown>;
  beats: Record<string, unknown>[]; onsets: Record<string, unknown>[]; frame_features: Record<string, unknown>[]; events: Record<string, unknown>[];
  silence_regions: Record<string, unknown>[]; candidate_changes: Record<string, unknown>[]; errors: string[];
  energy?: { hop_sec: number; values: number[] }; song_sections?: Record<string, unknown>[];
};

const r = (x: number | null | undefined, nd = 3) => (x === null || x === undefined ? null : round(x, nd));

function failed(message: string, duration = 0): Doc {
  return {
    status: "failed", audio: { duration_sec: r(duration, 2), sample_rate: SR, channels_analyzed: 1 }, analysis_config: { hop_length: HOP, frame_length: FRAME_LENGTH },
    tempo: { bpm: null, beat_interval_sec: null }, beats: [], onsets: [], frame_features: [], events: [], silence_regions: [], candidate_changes: [], errors: [message],
    energy: { hop_sec: 0.1, values: [] }, song_sections: [],
  };
}

function frameFeatures(y: Float32Array, env: Float64Array, step = 1) {
  const S = sp.stftMag(y, FRAME_LENGTH, HOP);
  const n = Math.min(S.cols, env.length);
  const rms = sp.rmsS(S, FRAME_LENGTH), centroid = sp.spectralCentroid(S, SR), bandwidth = sp.spectralBandwidth(S, SR), rolloff = sp.spectralRolloff(S, SR, undefined, 0.85);
  const zcr = sp.zeroCrossingRate(y, FRAME_LENGTH, HOP);
  const scale = percentile(env, 99) || 1;
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i += step) {
    out.push({
      time_sec: r(sp.framesToTime(i)), rms: r(rms[i], 4), spectral_centroid_hz: r(centroid[i], 1), spectral_bandwidth_hz: r(bandwidth[i], 1),
      spectral_rolloff_hz: r(rolloff[i], 1), zero_crossing_rate: r(zcr[Math.min(i, zcr.length - 1)], 4), onset_strength: r(Math.min(env[i] / scale, 1), 3),
    });
  }
  return out;
}

function rolls(onsets: number[], strength: (t: number) => number) {
  const out: Record<string, unknown>[] = [];
  let run: number[] = [];
  for (const t of [...[...onsets].sort((a, b) => a - b), Infinity]) {
    if (run.length && ROLL_GAP[0] <= t - run[run.length - 1] && t - run[run.length - 1] <= ROLL_GAP[1]) { run.push(t); continue; }
    if (run.length >= ROLL_HITS) {
      out.push({
        type: "ROLL", time_sec: null, start_sec: r(run[0]), end_sec: r(run[run.length - 1]), strength: r(mean(run.map(strength)), 2), confidence: 0.8,
        source: SOURCE.ROLL, rms_energy: null, subdivision: false, tags: [], details: { hits: run.length, hits_per_second: round(run.length / Math.max(run[run.length - 1] - run[0], 0.1), 1) },
      });
    }
    run = t !== Infinity ? [t] : [];
  }
  return out;
}

/** The analysis document for a song file; a bad file is status "failed" with the reason (never throws). */
export async function analyzeToJson(file: string, frameStep = 1): Promise<Doc> {
  let info, a, y: Float32Array, env: Float64Array;
  try {
    info = await probe(file);
    if (!(info.streams ?? []).some((s) => s.codec_type === "audio")) return failed("The file has no audio track.");
    ({ analysis: a, y, env } = await analyzeWithSignal(file, () => {}, MAX_SECONDS));
  } catch (e) {
    if (e instanceof AppError) return failed(e.message);
    throw e;
  }
  const errors: string[] = [];
  const original = Number(info.format?.duration || a.duration);
  if (original > a.duration + 1) errors.push(`Only the first ${a.duration.toFixed(0)} s of ${original.toFixed(0)} s were analysed.`);
  const scale = percentile(env, 99) || 1;
  const strength = (t: number) => {
    const f = clip(sp.timeToFrames(t), 0, env.length - 1);
    return Math.min(vmax(env, Math.max(f - 2, 0), Math.min(f + 3, env.length)) / scale, 1);
  };
  const confs = a.beatConfidences.length === a.beats.length ? a.beatConfidences : a.beats.map(() => a.beatConfidence);
  const beats = a.beats.map((t, i) => ({ time_sec: r(t), beat_index: i + 1, strength: r(strength(t), 2), confidence: r(confs[i], 2) }));
  const onsets = a.onsets.map((t) => ({ time_sec: r(t), strength: r(strength(t), 2) }));
  const events: Record<string, unknown>[] = [], changes: Record<string, unknown>[] = [], silences: Record<string, unknown>[] = [];
  for (const e of songEvents(a, y, SR, env)) {
    const span = e.end !== null;
    const row = {
      type: e.eventType, time_sec: span ? null : r(e.time), start_sec: span ? r(e.time) : null, end_sec: span ? r(e.end) : null, strength: r(e.onsetStrength, 2),
      confidence: r(e.confidence, 2), source: SOURCE[e.eventType] ?? "custom_classifier", rms_energy: r(e.rmsEnergy, 2), subdivision: e.subdivision, tags: e.tags, details: e.details,
    };
    if (e.eventType === "SILENCE") silences.push({ start_sec: r(e.time), end_sec: r(e.end), duration_sec: r((e.end ?? e.time) - e.time) });
    (CHANGE_TYPES.includes(e.eventType) ? changes : events).push(row);
  }
  events.push(...rolls(a.onsets, strength));
  const at = (x: Record<string, unknown>) => (x.time_sec !== null ? (x.time_sec as number) : (x.start_sec as number));
  const ordered = events.map((e, i) => [e, i] as const).sort((p, q) => at(p[0]) - at(q[0]) || p[1] - q[1]).map(([e]) => e);
  return {
    status: "completed",
    audio: { duration_sec: r(original, 2), analysed_sec: r(a.duration, 2), sample_rate: SR, channels_analyzed: 1 },
    analysis_config: { hop_length: HOP, frame_length: FRAME_LENGTH, frame_step: frameStep, frame_sec: r(HOP / SR, 5) },
    tempo: {
      bpm: r(a.bpm, 1), beat_interval_sec: a.bpm ? r(60 / a.bpm, 5) : null, confidence: r(a.beatConfidence, 2),
      sections: a.tempoSections.map((s) => ({ start_sec: r(s.start), end_sec: r(s.end), bpm: s.bpm, confidence: s.confidence })), downbeat_confidence: r(a.downbeatConfidence, 2),
    },
    beats, onsets, frame_features: frameFeatures(y, env, frameStep), events: ordered, silence_regions: silences, candidate_changes: changes, errors,
    energy: { hop_sec: a.energyHop, values: a.energy.map((v) => round(v, 3)) },
    song_sections: a.songSections.map((x) => ({ label: x.label, start_sec: r(x.start), end_sec: r(x.end), energy: r(x.energy, 3), confidence: r(x.confidence ?? 0.5, 2) })),
  };
}

const EVENT_KEYS = ["type", "time_sec", "start_sec", "end_sec", "strength", "confidence", "source"];
const pick = (e: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, e[k] ?? null]));

/** Exactly the agreed keys; frame features and onsets only when asked for. */
export function agreedShape(doc: Doc, frames = false, withOnsets = false) {
  const a = doc.audio, cfg = doc.analysis_config, tempo = doc.tempo;
  return {
    status: doc.status,
    audio: { duration_sec: a.duration_sec ?? null, sample_rate: a.sample_rate ?? null, channels_analyzed: a.channels_analyzed ?? null },
    analysis_config: { hop_length: cfg.hop_length ?? null, frame_length: cfg.frame_length ?? null },
    tempo: { bpm: tempo.bpm ?? null, beat_interval_sec: tempo.beat_interval_sec ?? null },
    beats: doc.beats.map((b) => pick(b, ["time_sec", "beat_index", "strength"])),
    onsets: withOnsets ? doc.onsets.map((o) => pick(o, ["time_sec", "strength"])) : [],
    frame_features: frames ? doc.frame_features.map((f) => pick(f, ["time_sec", "rms", "spectral_centroid_hz", "spectral_bandwidth_hz", "spectral_rolloff_hz", "zero_crossing_rate", "onset_strength"])) : [],
    events: doc.events.map((e) => pick(e, EVENT_KEYS)),
    silence_regions: doc.silence_regions.map((s) => pick(s, ["start_sec", "end_sec", "duration_sec"])),
    candidate_changes: doc.candidate_changes.map((c) => pick(c, EVENT_KEYS)),
    errors: [...doc.errors],
  };
}

export const SCHEMA_VERSION = "1.0";
const ENERGY_STEP = 0.25, HIGH = 0.65, LOW = 0.35;
const VIDEO_EVENTS = ["MUSIC_DROP", "BUILD_UP", "ROLL", "FILL", "IMPACT", "STRONG_BEAT", "ENERGY_RISE", "ENERGY_DROP", "VOCAL_ENTRY", "VOCAL_PAUSE", "SILENCE", "TEMPO_CHANGE", "PHRASE_END", "REVERB_TAIL"];

function energyCurve(energy: { hop_sec?: number; values?: number[] } | undefined, duration: number): number[] {
  const hop = Number(energy?.hop_sec || 0.1), values = energy?.values ?? [];
  if (!values.length) return [];
  const per = Math.max(round(ENERGY_STEP / hop), 1);
  const n = Math.ceil(Math.min(duration, values.length * hop) / ENERGY_STEP);
  return Array.from({ length: n }, (_, k) => { const seg = values.slice(k * per, (k + 1) * per); return round(mean(seg.length ? seg : [values[values.length - 1]]), 3); });
}

/** Schema 1.0: the song as video editing needs it, small. */
export function videoShape(doc: Doc, withOnsets = false) {
  const tempo = doc.tempo;
  const bpm = tempo.bpm as number | null;
  const downs = new Set(doc.events.filter((e) => ((e.tags as string[] | undefined) ?? []).includes("DOWNBEAT") && e.time_sec !== null).map((e) => e.time_sec));
  let pos: number | null = null;
  const beats = doc.beats.map((b) => {
    const down = downs.has(b.time_sec);
    pos = down ? 1 : pos !== null ? pos + 1 : null;
    return { time_sec: b.time_sec, strength: b.strength, confidence: b.confidence ?? null, downbeat: down, beat_in_bar: pos };
  });
  let events = [...doc.events, ...doc.candidate_changes].filter((e) => VIDEO_EVENTS.includes(e.type as string))
    .map((e) => pick(e, ["type", "time_sec", "start_sec", "end_sec", "strength", "confidence"]));
  const fills = new Set(events.filter((e) => e.type === "FILL").map((e) => `${e.start_sec}|${e.end_sec}`));
  events = events.filter((e) => !(e.type === "ROLL" && fills.has(`${e.start_sec}|${e.end_sec}`)));
  const at = (e: Record<string, unknown>) => (e.time_sec !== null ? (e.time_sec as number) : (e.start_sec as number));
  events = events.map((e, i) => [e, i] as const).sort((p, q) => at(p[0]) - at(q[0]) || p[1] - q[1]).map(([e]) => e);
  const sections = (doc.song_sections ?? []).map((x) => ({
    type: String(x.label).toUpperCase(), start_sec: x.start_sec, end_sec: x.end_sec,
    energy_level: (x.energy as number) >= HIGH ? "HIGH_ENERGY" : (x.energy as number) <= LOW ? "LOW_ENERGY" : "MEDIUM_ENERGY", energy: x.energy, confidence: x.confidence,
  }));
  const duration = Number(doc.audio.analysed_sec || doc.audio.duration_sec || 0);
  return {
    schema_version: SCHEMA_VERSION, status: doc.status,
    audio: { duration_sec: doc.audio.duration_sec ?? null, sample_rate: doc.audio.sample_rate ?? null, channels_analyzed: doc.audio.channels_analyzed ?? null },
    tempo: {
      bpm, alternative_bpm: bpm ? (bpm >= 100 ? round(bpm / 2, 1) : round(bpm * 2, 1)) : null, beat_interval_sec: tempo.beat_interval_sec ?? null, confidence: tempo.confidence ?? null,
      sections: ((tempo.sections as Record<string, unknown>[] | undefined) ?? []).map((x) => pick(x, ["start_sec", "end_sec", "bpm", "confidence"])),
    },
    beats, onsets: withOnsets ? doc.onsets.map((o) => pick(o, ["time_sec", "strength"])) : [],
    energy_curve: { sample_interval_sec: ENERGY_STEP, values: energyCurve(doc.energy, duration) }, sections, candidate_events: events, errors: [...doc.errors],
  };
}

export type AnalysisDoc = Doc;
