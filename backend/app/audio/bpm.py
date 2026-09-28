"""Tempo estimation helpers."""

from __future__ import annotations

import numpy as np

MIN_BPM = 70.0
MAX_BPM = 180.0


def fold_bpm(bpm: float, lo: float = MIN_BPM, hi: float = MAX_BPM) -> float:
    """Fold half/double-time estimates into a musically sensible range."""
    if bpm <= 0:
        return 0.0
    while bpm < lo:
        bpm *= 2
    while bpm > hi:
        bpm /= 2
    return bpm


def bpm_from_beats(beats: np.ndarray | list[float]) -> tuple[float, float]:
    """(bpm, confidence) from the median inter-beat interval; confidence = grid regularity."""
    b = np.asarray(beats, dtype=float)
    if len(b) < 3:
        return 0.0, 0.0
    d = np.diff(b)
    med = float(np.median(d))
    if med <= 0:
        return 0.0, 0.0
    regularity = float(max(0.0, 1.0 - np.median(np.abs(d - med)) / med * 4))
    # Beat times are quantised to analysis frames, so the median interval can land on either
    # side of the true period. The mean of the consistent intervals averages that jitter out.
    steady = d[(d > 0.8 * med) & (d < 1.2 * med)]
    period = float(steady.mean()) if len(steady) else med
    return 60.0 / period, min(regularity, 1.0)


def backfill_beats(beats: list[float], bpm: float, confidence: float, min_confidence: float = 0.6) -> list[float]:
    """Extend a regular beat grid backwards to t=0 (trackers usually miss the first beats)."""
    if not beats or bpm <= 0 or confidence < min_confidence:
        return beats
    period = 60.0 / bpm
    first = beats[0]
    extra = []
    t = first - period
    while t >= -0.05:
        extra.append(round(max(t, 0.0), 3))
        t -= period
    return sorted(extra) + beats if extra else beats
