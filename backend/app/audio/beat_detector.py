"""Beat, onset and strong-beat detection built on librosa.

The tracker assumes one tempo. When the song really changes tempo (audio/tempo.py measures it window by window,
independently of the tracker), the beats are tracked again with a tempo that follows the song, the section boundaries
are sharpened and the beats tracked once more. Then half / double-time mistakes are fixed, and every beat gets a
confidence."""

from __future__ import annotations

from dataclasses import dataclass, field

import librosa
import numpy as np

from app.audio import tempo as tempo_mod
from app.audio.bpm import backfill_beats, bpm_from_beats, fold_bpm

HOP = 512


@dataclass
class BeatResult:
    bpm: float
    confidence: float
    beats: list[float]
    strong_beats: list[float]
    onsets: list[float]
    tempo_sections: list[tempo_mod.TempoSection] = field(default_factory=list)
    beat_confidences: list[float] = field(default_factory=list)
    downbeats: list[float] = field(default_factory=list)
    downbeat_confidence: float = 0.0


def onset_envelope(y: np.ndarray, sr: int) -> np.ndarray:
    return librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)


def _uniform_grid(bpm: float, duration: float) -> list[float]:
    period = 60.0 / bpm
    return [round(i * period, 3) for i in range(int(duration / period) + 1)]


def detect_beats(y: np.ndarray, sr: int, env: np.ndarray | None = None) -> BeatResult:
    duration = len(y) / sr
    env = onset_envelope(y, sr) if env is None else env
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=HOP, tightness=120)
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    raw_tempo = float(np.atleast_1d(tempo)[0])
    sections = tempo_mod.local_tempo(env, sr, beats, duration, fold_bpm(raw_tempo) or 120.0)
    opening_bpm = 0.0  # the tempo of the first section, when the song changes tempo
    if tempo_mod.changes_tempo(sections):  # one tempo does not fit this song: follow its tempo
        for sharpen in (True, False):
            _, frames = librosa.beat.beat_track(onset_envelope=env, sr=sr, hop_length=HOP, tightness=120,
                                                bpm=tempo_mod.tempo_curve(sections, len(env), sr))  # fmt: skip
            beats = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
            sections = tempo_mod.refine(sections, beats, env if sharpen else None, sr)
        opening_bpm = sections[0].bpm

    bpm_b, confidence = bpm_from_beats(beats)
    bpm = fold_bpm(bpm_b if bpm_b > 0 else raw_tempo)
    if bpm_b > 0 and bpm > 0:
        ratio = bpm_b / bpm
        if ratio > 1.5:  # tracker locked to double time: keep every 2nd beat
            beats = beats[:: int(round(ratio))]
        elif ratio < 0.67:  # locked to half time (a dhol / kick on every 2nd beat): add the beats it skipped
            filled = _fill_half_time(beats, env, sr)
            if len(filled) > len(beats):
                beats = filled
                bpm_b, confidence = bpm_from_beats(beats)
                bpm = fold_bpm(bpm_b)
    if len(beats) < 4 or bpm <= 0:
        bpm = fold_bpm(raw_tempo) or 120.0
        beats = np.array(_uniform_grid(bpm, duration))
        confidence = 0.0

    # beats before the first tracked one follow the opening's tempo (the song's average tempo would misplace them)
    beats = np.array(backfill_beats([float(t) for t in beats], opening_bpm or bpm, confidence))

    onset_frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=HOP, backtrack=False)
    onsets = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)

    strong = _strong_beats(np.asarray(beats), env, sr)
    beats = np.asarray(beats, dtype=float)
    # the tempo sections reported: measured again on the final beats (one section when the tempo never changes)
    final = tempo_mod.local_tempo(env, sr, beats, duration, float(bpm))
    if not tempo_mod.changes_tempo(final):
        _, regular = tempo_mod._beat_bpm(beats, 0.0, duration)
        conf = round(float(np.mean([s.confidence for s in final])) if final else regular, 2)
        final = [tempo_mod.TempoSection(0.0, round(duration, 3), round(float(bpm), 1), conf)]
    else:
        final = tempo_mod.refine(final, beats, env, sr)
    bar_starts, bar_conf = tempo_mod.downbeats(beats, env, sr)
    return BeatResult(
        bpm=round(float(bpm), 2),
        confidence=round(float(confidence), 3),
        beats=[round(float(t), 3) for t in beats],
        strong_beats=[round(float(t), 3) for t in strong],
        onsets=[round(float(t), 3) for t in onsets],
        tempo_sections=final,
        beat_confidences=[float(c) for c in tempo_mod.beat_confidence(beats, env, sr, final)],
        downbeats=[round(float(t), 3) for t in bar_starts],
        downbeat_confidence=bar_conf,
    )


HALF_TIME_OVER_TYPICAL = 2.0  # a skipped beat must hit this much harder than a typical moment of the song
HALF_TIME_MIN_SHARE = 0.25  # ... and at least this share of the tracked beats' own strength
HALF_TIME_SEARCH = 3  # frames (~70 ms) either side of the halfway point where the skipped beat's hit may sit


def _fill_half_time(beats: np.ndarray, env: np.ndarray, sr: int) -> np.ndarray:
    """The tracker kept only every second beat. Each gap is judged on its own: a beat is added only where the music
    really hits between the two (a quiet intro keeps its own beats), at the time of that hit, not the computed middle."""
    if len(beats) < 2:
        return beats
    frames = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(env) - 1)
    on = float(np.median([env[max(f - HALF_TIME_SEARCH, 0): f + HALF_TIME_SEARCH + 1].max() for f in frames]))
    need = max(HALF_TIME_OVER_TYPICAL * float(np.median(env)), HALF_TIME_MIN_SHARE * on)
    added = []
    for x, z in zip(beats[:-1], beats[1:]):
        f = int(librosa.time_to_frames((x + z) / 2, sr=sr, hop_length=HOP))
        lo = max(f - HALF_TIME_SEARCH, 0)
        window = env[lo: f + HALF_TIME_SEARCH + 1]
        if len(window) and float(window.max()) >= need:
            added.append(float(librosa.frames_to_time(lo + int(np.argmax(window)), sr=sr, hop_length=HOP)))
    return np.sort(np.concatenate([beats, np.array(added)])) if added else beats


def _strong_beats(beats: np.ndarray, env: np.ndarray, sr: int) -> np.ndarray:
    """Bar downbeats (best 4-beat phase) plus beats with unusually strong onsets."""
    if len(beats) < 4:
        return beats
    frames = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(env) - 1)
    strength = env[frames]
    phase_scores = [strength[p::4].sum() for p in range(4)]
    downbeats = np.arange(int(np.argmax(phase_scores)), len(beats), 4)
    loud = np.nonzero(strength >= np.percentile(strength, 75))[0]
    return beats[np.union1d(downbeats, loud)]
