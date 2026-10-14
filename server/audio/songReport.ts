import "server-only";
import { AppError } from "@/server/core/errors";
import { probe } from "@/server/core/ffmpeg";
import { g, round } from "@/server/core/py";
import { curveAt, energyAt, type AudioAnalysis } from "@/server/models/analysis";
import { analyzeWithSignal } from "./analyzer";
import { cutPlan } from "./beatmap";
import { decode } from "./decode";
import { amplitudeToDb1, onsetStrength, rmsS, rmsY, SR, spectralBandwidth, spectralCentroid, stftMag, timeToFrames, zeroCrossingRate } from "./dsp/spectral";
import { songEvents } from "./events";

/** The song report (was audio/song_report.py): everything measured in a song - tempo by section, every detected event,
 * fast sequences and gaps, sections with their measurements, repeating bar patterns - and, kept apart, the editing
 * segments and recommendations for a Reel. */

const HOP = 512, MAX_SECONDS = 3600, DEDUP = 0.05, FAST: [number, number] = [0.1, 0.25], FAST_MIN_HITS = 3, GAP_FACTOR = 1.75, SILENCE_DB = -50, SILENCE_MIN = 1, PATTERN_SIMILAR = 0.9, CALM_SECONDS = 3;
const ms = (t: number) => round(t, 3);
type Mat = ReturnType<typeof stftMag>;

/** librosa.feature.spectral_contrast (6 octave bands from 200 Hz + the top band, quantile 0.02), mean over bands. */
function spectralContrastMean(S: Mat, sr: number, nFft: number, fmin = 200, nBands = 6, quantile = 0.02): Float64Array {
  const bins = S.rows, freq = Array.from({ length: bins }, (_, i) => (i * sr) / nFft);
  const edges = [0, ...Array.from({ length: nBands + 1 }, (_, i) => fmin * 2 ** i)];
  const out = new Float64Array(S.cols);
  for (let k = 0; k < nBands + 1; k++) {
    const lo = edges[k], hi = edges[k + 1];
    let idx = freq.map((f, i) => (f >= lo && f <= hi ? i : -1)).filter((i) => i >= 0);
    if (k > 0 && idx.length) idx = [idx[0] - 1, ...idx];
    if (k === nBands) idx = Array.from({ length: bins - idx[0] }, (_, i) => idx[0] + i);
    idx = idx.filter((i) => i >= 0 && i < bins);
    if (!idx.length) continue;
    const q = Math.max(Math.round(quantile * idx.length), 1);
    for (let c = 0; c < S.cols; c++) {
      const v = idx.map((i) => S.data[i * S.cols + c]).sort((a, b) => a - b);
      const valley = v.slice(0, q).reduce((a, b) => a + b, 0) / q, peak = v.slice(-q).reduce((a, b) => a + b, 0) / q;
      out[c] += (10 * Math.log10(Math.max(peak, 1e-10)) - 10 * Math.log10(Math.max(valley, 1e-10))) / (nBands + 1);
    }
  }
  return out;
}

function features(y: Float32Array, sr: number): Record<string, [ArrayLike<number>, number]> {
  const hop = HOP * 2, S = stftMag(y, 2048, hop), dt = hop / sr;
  return { rms: [rmsS(S, 2048), dt], spectral_centroid_hz: [spectralCentroid(S, sr), dt], spectral_bandwidth_hz: [spectralBandwidth(S, sr), dt],
    spectral_contrast_db: [spectralContrastMean(S, sr, 2048), dt], zero_crossing_rate: [zeroCrossingRate(y, 2048, hop), dt] };
}
function meanOver(curve: ArrayLike<number>, dt: number, a: number, b: number) {
  const i = Math.trunc(a / dt), j = Math.max(Math.trunc(b / dt), i + 1);
  let s = 0, n = 0;
  for (let k = i; k < Math.min(j, curve.length); k++) { s += curve[k]; n++; }
  return n ? s / n : 0;
}
function silences(y: Float32Array, sr: number): [number, number][] {
  const hop = Math.trunc(sr * 0.05), db = amplitudeToDb1(rmsY(y, hop * 2, hop), 1), out: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i <= db.length; i++) {
    const q = i < db.length && db[i] < SILENCE_DB;
    if (q && start === null) start = i;
    else if (!q && start !== null) { if ((i - start) * 0.05 >= SILENCE_MIN) out.push([start * 0.05, i * 0.05]); start = null; }
  }
  return out;
}
function fastSequences(onsets: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  let run: number[] = [];
  for (const t of [...onsets, Infinity]) {
    if (run.length && t - run[run.length - 1] >= FAST[0] && t - run[run.length - 1] <= FAST[1]) { run.push(t); continue; }
    if (run.length >= FAST_MIN_HITS) out.push([run[0], run[run.length - 1], run.length]);
    run = Number.isFinite(t) ? [t] : [];
  }
  return out;
}
function patterns(a: AudioAnalysis, env: ArrayLike<number>, sr: number) {
  const starts = a.downbeats.filter((d) => d < a.duration);
  if (starts.length < 4) return [];
  const vecs: number[][] = [], bars: number[] = [];
  for (let k = 0; k + 1 < starts.length; k++) {
    const s = starts[k], e = starts[k + 1];
    const v = Array.from({ length: 16 }, (_, i) => {
      const f = Math.min(Math.max(timeToFrames(s + ((e - s) * i) / 16, sr, HOP), 0), env.length - 1);
      return Math.max(env[Math.max(f - 1, 0)], env[f], env[Math.min(f + 1, env.length - 1)]);
    });
    if (Math.max(...v) > 0) {
      const m = v.reduce((x, y) => x + y, 0) / 16, c = v.map((x) => x - m), nrm = Math.sqrt(c.reduce((x, y) => x + y * y, 0)) + 1e-9;
      vecs.push(c.map((x) => x / nrm)); bars.push(s);
    }
  }
  const groups: number[][] = [];
  vecs.forEach((v, i) => {
    const gp = groups.find((gr) => vecs[gr[0]].reduce((s, x, j) => s + x * v[j], 0) >= PATTERN_SIMILAR);
    if (gp) gp.push(i); else groups.push([i]);
  });
  const diffs = starts.slice(1).map((s, i) => s - starts[i]).sort((x, y) => x - y), n = diffs.length;
  const barLen = n ? (n % 2 ? diffs[(n - 1) / 2] : (diffs[n / 2 - 1] + diffs[n / 2]) / 2) : 0;
  return groups.filter((gr) => gr.length >= 3).map((gr, k) => ({ id: k + 1, bars: gr.map((i) => ms(bars[i])), bar_seconds: round(barLen, 3) }));
}
function rhythmRuns(a: AudioAnalysis) {
  const out: { start: number; end: number; kind: string; details: Record<string, number> }[] = fastSequences(a.onsets).map(([s, e, n]) => ({ start: ms(s), end: ms(e), kind: "fast_sequence", details: { hits: n, hits_per_second: round(n / Math.max(e - s, 0.1), 1) } }));
  for (const sec of a.tempoSections) {
    const period = 60 / sec.bpm, inside = a.beats.filter((b) => b >= sec.start && b < sec.end);
    for (let i = 0; i + 1 < inside.length; i++) {
      const x = inside[i], z = inside[i + 1];
      if (z - x >= GAP_FACTOR * period && !a.onsets.some((h) => h > x + DEDUP && h < z - DEDUP)) out.push({ start: ms(x), end: ms(z), kind: "gap", details: { seconds: round(z - x, 3), beats_long: round((z - x) / period, 2) } });
    }
  }
  return out.sort((p, q) => p.start - q.start);
}

/** Practical cut points (never a clip shorter than minClip) and recommendations, from the editor's own cut plan. */
export function editingSegments(a: AudioAnalysis, minClip = 0.4, start = 0, endIn: number | null = null, everyBeat = false) {
  const end = endIn === null ? a.duration : Math.min(endIn, a.duration);
  const rows = cutPlan(a, null, null, start, end, null, everyBeat, minClip) as Record<string, unknown>[];
  const shots = rows.filter((r) => r.kind === "cut");
  const segs = shots.flatMap((r) => {
    const t = r.t as number, dur = round((r.end as number) - t, 3);
    if (dur <= 0) return [];
    const why = String(r.why ?? ""), busy = curveAt(a, "density", t) >= 0.6 || why.includes("build") || String(r.shot ?? "").toLowerCase().includes("faster");
    return [{ start: ms(t), end: ms(r.end as number), duration: dur, style: dur < 0.6 && busy ? "fast_cut" : dur >= 1.5 ? "long_clip" : "normal_cut", transition: (r.transition as string) || "cut",
      effect: (r.effect as string) ?? "none", reason: why ? why[0].toUpperCase() + why.slice(1) : "Suitable rhythmic interval" }];
  });
  const recs: { start: number; end: number; type: string; reason: string }[] = [];
  for (const r of rows) if (r.kind === "ramp") recs.push({ start: ms(r.t as number), end: ms((shots.find((s) => (s.t as number) > (r.t as number))?.t as number) ?? (r.t as number)), type: "speed_ramp", reason: (r.why as string) || "a hard hit just before the cut" });
  let calmFrom: number | null = null;
  for (let t = start; t <= end; t += a.curveHop) {
    const calm = energyAt(a, t) < 0.45 && curveAt(a, "density", t) < 0.35;
    if (calm && calmFrom === null) calmFrom = t;
    if ((!calm || t + a.curveHop > end) && calmFrom !== null) { if (t - calmFrom >= CALM_SECONDS) recs.push({ start: ms(calmFrom), end: ms(t), type: "slow_motion", reason: "calm music: low energy and few hits" }); calmFrom = null; }
  }
  for (const ev of a.events) if (ev.type === "build_up" && ev.end && start <= ev.time && ev.time < end) recs.push({ start: ms(ev.time), end: ms(Math.min(ev.end, end)), type: "fast_cuts", reason: "the music builds up into a drop" });
  const firstHit = [...a.drops].sort((x, y) => x - y).find((d) => start <= d && d <= start + 3) ?? a.strongBeats.find((b) => b >= start) ?? start;
  recs.push({ start: ms(start), end: ms(Math.min(firstHit + 0.5, end)), type: "hook", reason: "the opening: show the hook before the first big hit" });
  for (const s of a.songSections) if (s.end > start && s.start < end && ["intro", "verse", "bridge", "outro"].includes(s.label) && s.end - s.start >= 2) recs.push({ start: ms(Math.max(s.start, start)), end: ms(Math.min(s.end, end)), type: "text_overlay", reason: `a calmer part (${s.label})` });
  return { segments: segs, recommendations: recs.sort((p, q) => p.start - q.start) };
}

export async function analyzeSong(file: string, minClip = 0.4, everyBeat = false, analysis: AudioAnalysis | null = null) {
  const info = await probe(file), original = Number(info.format?.duration ?? 0);
  if (!(info.streams ?? []).some((s) => s.codec_type === "audio")) throw new AppError("The file has no audio track.", { code: "NO_AUDIO_STREAM" });
  let a: AudioAnalysis, y: Float32Array, env: ArrayLike<number>;
  if (analysis) { a = analysis; y = await decode(file, SR, Math.ceil(a.duration)); env = onsetStrength(y, SR, HOP); }
  else { const r = await analyzeWithSignal(file, () => {}, MAX_SECONDS); a = r.analysis; y = r.y; env = r.env; }
  const feats = features(y, SR), warnings: string[] = [];
  if (original && original > a.duration + 1) warnings.push(`Only the first ${Math.round(a.duration)} s of ${Math.round(original)} s were analysed.`);
  if (a.beatConfidence < 0.5) warnings.push("The beat is irregular or weak: beat times are less reliable.");
  if (a.onsets.length < a.duration * 0.5) warnings.push("Little percussion: few attacks were found, so cuts follow the beat estimate.");
  if (a.downbeatConfidence < 0.3) warnings.push("Bar starts (downbeats) are uncertain: treat downbeats as estimates.");
  const changes = new Set(a.tempoSections.map((s) => round(s.bpm))).size > 1;
  if (changes) warnings.push("The tempo changes: " + a.tempoSections.map((s) => `${g(s.bpm)} BPM from ${s.start.toFixed(1)} s`).join(", ") + ".");
  const sil = silences(y, SR);
  if (sil.length) warnings.push(`${sil.length} silent stretch(es) of a second or more.`);
  const sections = a.songSections.map((s) => {
    const m: Record<string, number> = Object.fromEntries(Object.entries(feats).map(([k, [c, dt]]) => [k, round(meanOver(c, dt, s.start, s.end), 4)]));
    m.onset_strength = round(meanOver(env, HOP / SR, s.start, s.end), 4);
    m.onsets_per_second = round(a.onsets.filter((t) => s.start <= t && t < s.end).length / Math.max(s.end - s.start, 1e-6), 2);
    m.energy = round(s.energy, 3);
    return { start: ms(s.start), end: ms(s.end), label: s.label, measurements: m };
  });
  const events = songEvents(a, y, SR, Float64Array.from(env)), runs = rhythmRuns(a), counts: Record<string, number> = {};
  for (const e of events) counts[e.eventType] = (counts[e.eventType] ?? 0) + 1;
  const { segments, recommendations } = editingSegments(a, minClip, 0, null, everyBeat), pats = patterns(a, env, SR);
  return {
    audio: { duration_seconds: round(original || a.duration, 3), analysed_seconds: round(a.duration, 3), sample_rate: SR },
    tempo: { global_bpm: round(a.bpm, 2), changes, sections: a.tempoSections.map((s) => ({ start: ms(s.start), end: ms(s.end), estimated_bpm: s.bpm, confidence: s.confidence })) },
    events: events.map((e) => ({ time: e.time, event_type: e.eventType, confidence: e.confidence, onset_strength: e.onsetStrength, rms_energy: e.rmsEnergy, subdivision: e.subdivision, ...(e.end !== null ? { end: e.end } : {}), tags: e.tags, details: e.details })),
    rhythm: runs, sections, patterns: pats, editing_segments: segments, recommendations,
    analysis: { beat_count: a.beats.length, strong_beat_count: counts.STRONG_BEAT ?? 0, onset_count: a.onsets.length, possible_drop_count: counts.MUSIC_DROP ?? 0,
      fast_sequence_count: runs.filter((r) => r.kind === "fast_sequence").length, event_counts: counts, pattern_count: pats.length, min_clip_seconds: minClip, warnings },
  };
}
