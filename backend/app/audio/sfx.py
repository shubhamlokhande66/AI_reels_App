"""Sound effects, synthesised on this computer (no sound library, no licences): whoosh, impact, riser and pop.

``synth_track`` renders every effect of a Reel into one stereo track at its timeline position; the renderer mixes it
under the music. Deterministic: the same events give the same samples (seeded noise).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

SR = 48000
SFX_TYPES = ("whoosh", "impact", "riser", "pop")
LENGTH = {"whoosh": 0.45, "impact": 0.7, "riser": 1.5, "pop": 0.12}  # seconds each sound lasts


def _env(n: int, attack: float, release: float) -> np.ndarray:
    t = np.linspace(0, 1, n, endpoint=False)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    r = np.clip((1 - t) / max(release, 1e-4), 0, 1)
    return a * r


def _noise(n: int, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n)


def _lowpass(x: np.ndarray, cutoff: np.ndarray | float) -> np.ndarray:
    """One-pole low-pass; ``cutoff`` (Hz) may change sample by sample (for sweeps)."""
    c = np.broadcast_to(np.asarray(cutoff, dtype=float), x.shape)
    alpha = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha[i] * (x[i] - acc)
        y[i] = acc
    return y


def whoosh(seed: int = 0) -> np.ndarray:
    n = int(LENGTH["whoosh"] * SR)
    sweep = np.geomspace(400, 6000, n) * np.hanning(n * 2)[n // 2: n // 2 + n] + 300
    x = _lowpass(_noise(n, seed), sweep) * _env(n, 0.55, 0.45)
    return x * 0.9


def impact(seed: int = 0) -> np.ndarray:
    n = int(LENGTH["impact"] * SR)
    t = np.arange(n) / SR
    freq = 55 + 70 * np.exp(-t * 18)  # a falling thump
    body = np.sin(2 * np.pi * np.cumsum(freq) / SR) * np.exp(-t * 6)
    click = _lowpass(_noise(n, seed), 2500) * np.exp(-t * 60)
    return 0.9 * body + 0.35 * click


def riser(seed: int = 0) -> np.ndarray:
    n = int(LENGTH["riser"] * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * np.cumsum(np.geomspace(180, 1400, n)) / SR)
    air = _lowpass(_noise(n, seed), np.geomspace(500, 9000, n))
    grow = (t / t[-1]) ** 2.2
    return (0.35 * tone + 0.65 * air) * grow * _env(n, 0.05, 0.03)


def pop(seed: int = 0) -> np.ndarray:
    n = int(LENGTH["pop"] * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * (900 - 2500 * t) * t) * np.exp(-t * 45) * 0.7


_MAKERS = {"whoosh": whoosh, "impact": impact, "riser": riser, "pop": pop}


def synth_track(events, duration: float, out: Path) -> Path:
    """Write every effect (objects with ``type``, ``at`` seconds, ``volume`` 0..1) into one stereo WAV of ``duration``."""
    import soundfile as sf

    total = int(duration * SR) + 1
    track = np.zeros(total)
    for i, e in enumerate(events):
        snd = _MAKERS[e.type](seed=i) * float(e.volume)
        a = int(max(e.at, 0.0) * SR)
        b = min(a + len(snd), total)
        if b > a:
            track[a:b] += snd[: b - a]
    peak = float(np.max(np.abs(track))) if track.size else 0.0
    if peak > 0.98:
        track *= 0.98 / peak
    sf.write(str(out), np.stack([track, track], axis=1).astype(np.float32), SR)
    return out
