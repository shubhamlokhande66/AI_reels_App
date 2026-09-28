"""Beat, onset and strong-beat detection built on librosa."""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

from app.audio.bpm import backfill_beats, bpm_from_beats, fold_bpm

HOP = 512


@dataclass
class BeatResult:
    bpm: float
    confidence: float
    beats: list[float]
    strong_beats: list[float]
    onsets: list[float]


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

    bpm_b, confidence = bpm_from_beats(beats)
    bpm = fold_bpm(bpm_b if bpm_b > 0 else raw_tempo)
    if bpm_b > 0 and bpm > 0:
        ratio = bpm_b / bpm
        if ratio > 1.5:  # tracker locked to double time: keep every 2nd beat
            beats = beats[:: int(round(ratio))]
    if len(beats) < 4 or bpm <= 0:
        bpm = fold_bpm(raw_tempo) or 120.0
        beats = np.array(_uniform_grid(bpm, duration))
        confidence = 0.0

    beats = np.array(backfill_beats([float(t) for t in beats], bpm, confidence))

    onset_frames = librosa.onset.onset_detect(onset_envelope=env, sr=sr, hop_length=HOP, backtrack=False)
    onsets = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)

    strong = _strong_beats(np.asarray(beats), env, sr)
    return BeatResult(
        bpm=round(float(bpm), 2),
        confidence=round(float(confidence), 3),
        beats=[round(float(t), 3) for t in beats],
        strong_beats=[round(float(t), 3) for t in strong],
        onsets=[round(float(t), 3) for t in onsets],
    )


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
