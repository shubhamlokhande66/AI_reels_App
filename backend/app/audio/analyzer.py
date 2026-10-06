"""Audio analysis: decode, energy curve, sections, drops, and beat tracking."""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Callable

import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import uniform_filter1d

from app.audio.beat_detector import HOP, detect_beats, onset_envelope
from app.core.errors import CorruptedMedia
from app.core.ffmpeg import run_ffmpeg
from app.models.analysis import AudioAnalysis, Section

SR = 22050
MAX_SECONDS = 600  # analyse at most 10 minutes of a track
ENERGY_HOP = 0.1

StageFn = Callable[[str, float], None]  # (stage name, 0..1)


def load_audio(path: Path, max_seconds: int = MAX_SECONDS) -> tuple[np.ndarray, int]:
    """Decode any FFmpeg-readable audio to mono float32 at 22.05 kHz (also handles m4a/aac)."""
    with tempfile.TemporaryDirectory(prefix="reel_audio_") as tmp:
        wav = Path(tmp) / "decoded.wav"
        run_ffmpeg(
            ["-i", str(Path(path).resolve()), "-vn", "-ac", "1", "-ar", str(SR), "-t", str(max_seconds),
             "-c:a", "pcm_s16le", str(wav)],
            timeout=120, error_code="AUDIO_DECODE_FAILED",
        )  # fmt: skip
        y, sr = sf.read(str(wav), dtype="float32")
    if y.ndim > 1:
        y = y.mean(axis=1)
    if len(y) < sr:
        raise CorruptedMedia("The audio contains less than one second of sound.")
    if float(np.abs(y).max()) < 1e-4:
        raise CorruptedMedia("The audio track is silent.", code="SILENT_AUDIO")
    return y, sr


def compute_energy(y: np.ndarray, sr: int) -> np.ndarray:
    """RMS energy every ENERGY_HOP seconds, smoothed and normalised to 0..1."""
    hop = int(sr * ENERGY_HOP)
    rms = librosa.feature.rms(y=y, frame_length=hop * 4, hop_length=hop, center=True)[0]
    rms = uniform_filter1d(rms, size=3, mode="nearest")
    lo, hi = np.percentile(rms, 5), np.percentile(rms, 95)
    if hi - lo < 1e-9:
        return np.full_like(rms, 0.5)
    return np.clip((rms - lo) / (hi - lo), 0.0, 1.0)


def _runs(mask: np.ndarray, dt: float, min_len: float, max_gap: float) -> list[Section]:
    runs: list[list[int]] = []
    start = None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            runs.append([start, i])
            start = None
    if start is not None:
        runs.append([start, len(mask)])
    merged: list[list[int]] = []
    for r in runs:
        if merged and (r[0] - merged[-1][1]) * dt <= max_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [Section(start=round(a * dt, 2), end=round(b * dt, 2)) for a, b in merged if (b - a) * dt >= min_len]


def high_energy_sections(energy: np.ndarray, dt: float = ENERGY_HOP) -> list[Section]:
    if len(energy) == 0:
        return []
    smooth = uniform_filter1d(energy, size=max(int(1.0 / dt), 1), mode="nearest")
    thr = max(float(np.percentile(smooth, 60)), 0.5)
    return _runs(smooth >= thr, dt, min_len=2.0, max_gap=1.0)


def find_drops(energy: np.ndarray, beats: list[float], dt: float = ENERGY_HOP) -> list[float]:
    """Moments where energy jumps sharply (mean of next 2 s vs previous 2 s)."""
    w = int(2.0 / dt)
    if len(energy) < 2 * w + 1:
        return []
    csum = np.concatenate([[0.0], np.cumsum(energy)])
    idx = np.arange(w, len(energy) - w)
    before = (csum[idx] - csum[idx - w]) / w
    after = (csum[idx + w] - csum[idx]) / w
    jump = after - before
    drops: list[float] = []
    for i in np.argsort(jump)[::-1]:
        if jump[i] < 0.25:
            break
        t = float(idx[i] * dt)
        if all(abs(t - d) > 8.0 for d in drops):
            drops.append(t)
    return [round(min(beats, key=lambda b: abs(b - t)), 3) if beats else round(t, 2) for t in sorted(drops)]


ANALYSIS_VERSION = 4  # 2 = accents; 3 = accent strength vs a typical strong hit; 4 = labelled sections + curves (older caches are redone)


def find_accents(env: np.ndarray, sr: int) -> tuple[list[float], list[float]]:
    """Individual strong hits: peaks of the onset envelope well above their surroundings (>= 0.25 s apart).

    Strength is measured against a *typical strong hit* (the 97th percentile of the envelope), not the single loudest one:
    one huge hit in a song must not make every ordinary drum hit look weak. 1.0 = at least as strong as a strong hit.
    """
    if len(env) < 20 or float(env.max()) <= 0:
        return [], []
    scale = float(np.percentile(env, 97))
    if scale <= 1e-6:
        return [], []
    frames = librosa.util.peak_pick(env, pre_max=6, post_max=6, pre_avg=12, post_avg=12, delta=0.4 * scale, wait=10)
    times = librosa.frames_to_time(frames, sr=sr, hop_length=HOP)
    strengths = np.clip(env[frames] / scale, 0.0, 1.0) if len(frames) else np.array([])
    keep = [(round(float(t), 3), round(float(s), 3)) for t, s in zip(times, strengths) if s >= 0.35]
    return [t for t, _ in keep], [v for _, v in keep]


def find_sections(y: np.ndarray, sr: int, beats: list[float], duration: float) -> list[Section]:
    """Coarse structure via agglomerative clustering of MFCCs, snapped to beats."""
    if duration < 12:
        return [Section(start=0.0, end=round(duration, 2))]
    k = int(min(max(round(duration / 20), 2), 8))
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=HOP * 4)
    bounds_f = librosa.segment.agglomerative(mfcc, k)
    times = librosa.frames_to_time(bounds_f, sr=sr, hop_length=HOP * 4)
    edges = [0.0]
    for t in times:
        if t <= 0.5 or t >= duration - 0.5:
            continue
        edges.append(min(beats, key=lambda b: abs(b - t)) if beats else float(t))
    edges = sorted({round(float(e), 2) for e in edges}) + [round(duration, 2)]
    return [Section(start=a, end=b) for a, b in zip(edges[:-1], edges[1:]) if b - a > 1.0]


def analyze_audio(path: Path, on_stage: StageFn | None = None) -> AudioAnalysis:
    """Full analysis. Reports the ``analyzing_music`` then ``detecting_beats`` stages."""
    report = on_stage or (lambda *_: None)
    report("analyzing_music", 0.0)
    y, sr = load_audio(path)
    duration = len(y) / sr
    report("analyzing_music", 0.4)
    energy = compute_energy(y, sr)
    env = onset_envelope(y, sr)
    hi = high_energy_sections(energy)
    report("analyzing_music", 1.0)

    report("detecting_beats", 0.0)
    beat = detect_beats(y, sr, env)
    report("detecting_beats", 0.6)
    drops = find_drops(energy, beat.beats)
    sections = find_sections(y, sr, beat.beats, duration)
    report("detecting_beats", 1.0)

    accents, strengths = find_accents(env, sr)
    from app.audio.structure import CURVE_HOP, compute_curves, label_sections, structural_parts
    from app.models.analysis import SongSection

    curves = compute_curves(y, sr, beat.onsets)
    e_list = [float(e) for e in energy]
    labelled = label_sections(structural_parts(y, sr, beat.beats, duration, e_list, ENERGY_HOP, drops), e_list, ENERGY_HOP, drops, curves)
    return AudioAnalysis(
        bpm=beat.bpm,
        duration=round(duration, 3),
        beats=beat.beats,
        beat_confidence=beat.confidence,
        strong_beats=beat.strong_beats,
        onsets=beat.onsets,
        accents=accents,
        accent_strengths=strengths,
        analysis_version=ANALYSIS_VERSION,
        high_energy_sections=hi,
        sections=sections,
        drops=drops,
        energy_hop=ENERGY_HOP,
        energy=[round(float(e), 3) for e in energy],
        curve_hop=CURVE_HOP,
        loudness_db=curves.loudness_db,
        brightness=curves.brightness,
        density=curves.density,
        vocal=curves.vocal,
        song_sections=[SongSection(**r) for r in labelled],
    )
