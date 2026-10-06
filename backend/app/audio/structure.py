"""Music intelligence beyond beats: what each part of the song IS, and how an editor should cut it.

Deterministic signal processing (librosa / numpy), no AI:

* curves every ``CURVE_HOP`` seconds: loudness (dBFS), brightness (spectral centroid, 0..1), rhythmic density (onsets
  per second, 0..1) and vocal presence (0..1, an *estimate*: harmonic energy in the voice band that is not flat noise);
* labelled sections: intro, build, drop, chorus, verse, bridge, outro, from the coarse MFCC sections plus energy,
  energy slope, density, repetition and position in the song;
* a cut strategy per section label: what the cuts in that part land on (phrase, bar, beat, half beat, accent,
  silence ...). The Creative Director reads it as guidance; it may break it when the story needs.

Vocal presence is a heuristic (no source separation): good enough to tell "someone is singing" from "drums and synths",
not a lyric aligner. It says so in the analysis (``vocal_method``).
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

CURVE_HOP = 0.5  # seconds between curve samples
LABELS = ("intro", "build", "drop", "chorus", "verse", "bridge", "outro")
# How an editor cuts each kind of section (the Director's default; it may intentionally break it).
CUT_STRATEGY = {
    "intro": "phrase",      # let the opening breathe: change shot on phrase / bar starts
    "verse": "bar",
    "build": "beat",        # tighten as tension rises (half beats in its last bar)
    "drop": "accent",       # hit the strong accents; the first shot lands exactly on the drop
    "chorus": "beat",
    "bridge": "bar",        # a calmer contrast: longer holds, cuts on bars or off-beat for feel
    "outro": "phrase",      # wind down: long final shot, end on the last strong beat
}


@dataclass
class Curves:
    loudness_db: list[float]
    brightness: list[float]
    density: list[float]
    vocal: list[float]


def _norm(x: np.ndarray, lo_p: float = 5, hi_p: float = 95) -> np.ndarray:
    lo, hi = np.percentile(x, lo_p), np.percentile(x, hi_p)
    if hi - lo < 1e-9:
        return np.full_like(x, 0.5, dtype=float)
    return np.clip((x - lo) / (hi - lo), 0.0, 1.0)


def _resample(x: np.ndarray, src_hop: float, n: int) -> np.ndarray:
    """Average a frame-level feature into ``n`` cells of CURVE_HOP seconds."""
    per = max(int(round(CURVE_HOP / src_hop)), 1)
    out = np.zeros(n)
    for i in range(n):
        seg = x[i * per:(i + 1) * per]
        out[i] = float(seg.mean()) if seg.size else (out[i - 1] if i else 0.0)
    return out


def compute_curves(y: np.ndarray, sr: int, onsets: list[float], hop: int = 512) -> Curves:
    duration = len(y) / sr
    n = max(int(np.ceil(duration / CURVE_HOP)), 1)
    fh = hop / sr
    rms = librosa.feature.rms(y=y, frame_length=hop * 4, hop_length=hop)[0]
    loud = 20 * np.log10(np.maximum(_resample(rms, fh, n), 1e-5))
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0]
    bright = _norm(_resample(centroid, fh, n))

    counts = np.zeros(n)
    for t in onsets:
        k = int(t / CURVE_HOP)
        if 0 <= k < n:
            counts[k] += 1
    window = max(int(2.0 / CURVE_HOP), 1)  # onsets per second over 2 s
    dens = np.convolve(counts, np.ones(window) / (window * CURVE_HOP), mode="same")
    dens = np.clip(dens / 8.0, 0.0, 1.0)  # 8 onsets per second = as busy as it gets

    # vocal estimate: harmonic part (HPSS), energy share in the voice band, and not noise-like
    H, _ = librosa.decompose.hpss(S)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = (freqs >= 250) & (freqs <= 3500)
    share = H[band].sum(axis=0) / np.maximum(S.sum(axis=0), 1e-9)
    flat = librosa.feature.spectral_flatness(S=H)[0]
    tonal = np.clip(1.0 - flat * 20, 0.0, 1.0)
    vocal = _resample(np.clip(share * 1.6, 0.0, 1.0) * tonal, fh, n)
    vocal = np.convolve(vocal, np.ones(3) / 3, mode="same")
    quiet = loud < (np.max(loud) - 35)
    vocal[quiet] = 0.0
    return Curves([round(float(v), 1) for v in loud], [round(float(v), 3) for v in bright],
                  [round(float(v), 3) for v in dens], [round(float(min(max(v, 0.0), 1.0)), 3) for v in vocal])  # fmt: skip


@dataclass
class Part:
    start: float
    end: float


MIN_PART = 4.0  # seconds: shorter pieces are merged into a neighbour


def structural_parts(y: np.ndarray, sr: int, beats: list[float], duration: float, energy: list[float], energy_hop: float, drops: list[float] | None = None,
                     hop: int = 512) -> list[Part]:  # fmt: skip
    """Finer song structure than the coarse sections: timbre (MFCC) + loudness clustering, about one part per 8 s,
    boundaries on beats, nothing shorter than ``MIN_PART``."""
    if duration < 2 * MIN_PART:
        return [Part(0.0, round(duration, 2))]
    k = int(min(max(round(duration / 8), 3), 12))
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13, hop_length=hop * 4)
    loud = np.interp(np.arange(mfcc.shape[1]) * hop * 4 / sr, np.arange(len(energy)) * energy_hop, energy)
    feats = np.vstack([librosa.util.normalize(mfcc, axis=1), 3.0 * loud[None, :]])  # loudness weighs like timbre
    bounds = librosa.frames_to_time(librosa.segment.agglomerative(feats, k), sr=sr, hop_length=hop * 4)
    edges = [0.0]
    for t in sorted(float(b) for b in bounds):
        if t <= 0.5 or t >= duration - 0.5:
            continue
        snapped = min(beats, key=lambda b: abs(b - t)) if beats else t
        if snapped - edges[-1] >= MIN_PART:
            edges.append(round(float(snapped), 2))
    if duration - edges[-1] < MIN_PART and len(edges) > 1:
        edges.pop()
    edges.append(round(duration, 2))
    for d in drops or []:  # a drop always starts a part: move the nearest boundary onto it, or add one
        if not 0 < d < duration:
            continue
        near = min(range(1, len(edges) - 1), key=lambda i: abs(edges[i] - d), default=None)
        if near is not None and abs(edges[near] - d) <= MIN_PART and edges[near - 1] + 1.0 < d < edges[near + 1] - 1.0:
            edges[near] = round(d, 2)
        elif all(abs(e - d) >= MIN_PART for e in edges):
            edges = sorted(edges + [round(d, 2)])
    return [Part(a, b) for a, b in zip(edges[:-1], edges[1:])]


def _mean(curve: list[float] | np.ndarray, a: float, b: float, hop: float) -> float:
    i, j = int(a / hop), max(int(b / hop), int(a / hop) + 1)
    seg = curve[i:j]
    return float(np.mean(seg)) if len(seg) else 0.0


def _slope(energy: list[float], a: float, b: float, hop: float) -> float:
    i, j = int(a / hop), max(int(b / hop), int(a / hop) + 2)
    seg = np.asarray(energy[i:j], dtype=float)
    if seg.size < 4:
        return 0.0
    x = np.linspace(0, 1, seg.size)
    return float(np.polyfit(x, seg, 1)[0])  # energy gained over the section (0..1 scale)


def label_sections(sections, energy: list[float], energy_hop: float, drops: list[float], curves: Curves) -> list[dict]:
    """``sections``: objects with start/end (seconds). Returns dicts {start, end, label, energy, density, vocal, confidence}."""
    if not sections:
        return []
    rows = []
    song_mean = float(np.mean(energy)) if energy else 0.5
    for s in sections:
        e = _mean(energy, s.start, s.end, energy_hop)
        rows.append({"start": round(s.start, 2), "end": round(s.end, 2), "energy": round(e, 3),
                     "slope": round(_slope(energy, s.start, s.end, energy_hop), 3),
                     "density": round(_mean(curves.density, s.start, s.end, CURVE_HOP), 3),
                     "vocal": round(_mean(curves.vocal, s.start, s.end, CURVE_HOP), 3)})  # fmt: skip
    hi = max(r["energy"] for r in rows)
    n = len(rows)
    for i, r in enumerate(rows):
        starts_on_drop = any(abs(d - r["start"]) <= 1.5 for d in drops)
        loud = r["energy"] >= max(0.75 * hi, song_mean)
        nxt = rows[i + 1] if i + 1 < n else None
        if starts_on_drop and loud:
            label, conf = "drop", 0.85
        elif i == 0 and r["energy"] < 0.8 * hi and n > 1:
            label, conf = "intro", 0.8
        elif i == n - 1 and n > 1 and (r["slope"] < -0.05 or r["energy"] < 0.8 * hi):
            label, conf = "outro", 0.75
        elif nxt is not None and (r["slope"] > 0.12 or (nxt["energy"] > r["energy"] * 1.25 and any(abs(d - nxt["start"]) <= 1.5 for d in drops))):
            label, conf = "build", 0.7
        elif loud:
            label, conf = "chorus", 0.6
        elif 0 < i < n - 1 and r["energy"] < 0.7 * song_mean and rows[i - 1]["energy"] > r["energy"] * 1.3:
            label, conf = "bridge", 0.55
        else:
            label, conf = "verse", 0.5
        r.update(label=label, confidence=conf, cut_on=CUT_STRATEGY[label])
        r.pop("slope", None)
    return rows
