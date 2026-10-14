/** A song's analysis (was backend/app/models/analysis.AudioAnalysis): the shape stored in the cache and read by the
 * planners, camelCase like its JSON. */

export interface Section { start: number; end: number }

export interface SongSection {
  start: number; end: number; label: string; energy: number; density: number; vocal: number; confidence: number; cutOn: string;
}

export interface TempoSection { start: number; end: number; bpm: number; confidence: number }

export interface MusicEvent {
  time: number; type: string; strength: number; confidence: number; end: number | null; measurements: Record<string, number>;
}

export interface Transient { t: number; band: "low" | "mid" | "high"; strength: number }
export interface AudioAnalysis {
  bpm: number;
  duration: number;
  /** Essentia's beats exactly as detected (or an even grid when it found none: beatSource says which) */
  beats: number[];
  beatSource: "essentia" | "inferred_grid";
  /** the tracker's GLOBAL confidence (Essentia's, scaled to 0..1): a score, not a measured timing error */
  beatConfidence: number;
  /** Essentia's own confidence, 0..5.32 */
  essentiaConfidence: number;
  /** independent tempo estimates; they are compared, not averaged */
  bpmEstimates: { rhythmExtractor: number; percival: number | null; beatIntervals: number | null };
  /** agree | octave (half / double or 2:3: a metrical-level ambiguity) | disagree | unknown */
  bpmAgreement: "agree" | "octave" | "disagree" | "unknown";
  /** beats per bar, only when the bar phase is clear */
  meter: 3 | 4 | null;
  /** attacks of percussive hits per band (low = kick, mid = snare / clap, high = hi-hat), separate from beats and onsets */
  transients: Transient[];
  strongBeats: number[];
  onsets: number[];
  accents: number[];
  accentStrengths: number[];
  analysisVersion: number;
  highEnergySections: Section[];
  sections: Section[];
  /** where to cut for each drop (the nearest beat) */
  drops: number[];
  /** when each drop was measured to happen (same order as drops) */
  dropTimes: number[];
  energyHop: number;
  energy: number[];
  curveHop: number;
  loudnessDb: number[];
  brightness: number[];
  density: number[];
  vocal: number[];
  songSections: SongSection[];
  tempoSections: TempoSection[];
  beatConfidences: number[];
  downbeats: number[];
  downbeatConfidence: number;
  beatLevels: number[];
  mediumBeats: number[];
  beatKick: number[];
  events: MusicEvent[];
}

/** Defaults for fields an older stored analysis may lack (Pydantic filled them the same way). */
export function withDefaults(doc: Partial<AudioAnalysis> & { bpm: number; duration: number; beats: number[] }): AudioAnalysis {
  return {
    beatConfidence: 0, strongBeats: [], onsets: [], accents: [], accentStrengths: [], analysisVersion: 1, highEnergySections: [], sections: [],
    drops: [], energyHop: 0.1, energy: [], curveHop: 0.5, loudnessDb: [], brightness: [], density: [], vocal: [], songSections: [], tempoSections: [],
    beatConfidences: [], downbeats: [], downbeatConfidence: 0, beatLevels: [], mediumBeats: [], beatKick: [], events: [], beatSource: "essentia",
    essentiaConfidence: 0, bpmEstimates: { rhythmExtractor: doc.bpm, percival: null, beatIntervals: null }, bpmAgreement: "unknown", meter: null, transients: [], dropTimes: doc.drops ?? [], ...doc,
  } as AudioAnalysis;
}

export function curveAt(a: AudioAnalysis, name: "loudnessDb" | "brightness" | "density" | "vocal", t: number): number {
  const c = a[name];
  if (!c.length) return 0;
  return c[Math.min(Math.max(Math.trunc(t / a.curveHop), 0), c.length - 1)];
}

export function sectionAt(a: AudioAnalysis, t: number): SongSection | null {
  for (const s of a.songSections) if (s.start - 1e-6 <= t && t < s.end) return s;
  return a.songSections[a.songSections.length - 1] ?? null;
}

export function energyAt(a: AudioAnalysis, t: number): number {
  if (!a.energy.length) return 0.5;
  return a.energy[Math.min(Math.max(Math.trunc(t / a.energyHop), 0), a.energy.length - 1)];
}

export function meanEnergy(a: AudioAnalysis, start: number, end: number): number {
  if (!a.energy.length) return 0.5;
  const i = Math.max(Math.trunc(start / a.energyHop), 0);
  const j = Math.max(Math.min(Math.trunc(end / a.energyHop) + 1, a.energy.length), i + 1);
  const seg = a.energy.slice(i, j);
  return seg.length ? seg.reduce((x, y) => x + y, 0) / seg.length : 0.5;
}
