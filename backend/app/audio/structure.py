"""Music intelligence beyond beats: what each part of the song IS, and how an editor should cut it.

Deterministic signal processing (librosa / numpy), no AI:

* curves every ``CURVE_HOP`` seconds: loudness (dBFS), brightness (spectral centroid, 0..1), rhythmic density (onsets
  per second, 0..1) and vocal presence (0..1, an *estimate*: a tonal partial in the voice range whose pitch wavers the
  way a voice does, which held synth / pad notes do not);
* labelled sections: intro, build, drop, chorus, verse, bridge, outro, from the coarse MFCC sections plus energy,
  energy slope, density, repetition and position in the song;
* a cut strategy per section label: what the cuts in that part land on (phrase, bar, beat, half beat, accent,
  silence ...). The Creative Director reads it as guidance; it may break it when the story needs.

Vocal presence is a heuristic (no source separation): good enough to tell "someone is singing" from "drums and synths",
not a lyric aligner, and the Reel plan says so.
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


VOICE_LO, VOICE_HI = 150.0, 1000.0  # Hz: where a sung melody's strongest partial sits


def _pitch_motion(S: np.ndarray, freqs: np.ndarray, fh: float) -> np.ndarray:
    """Per frame, how much the strongest tonal partial in the voice range *wavers* (0..1).

    Singing never holds a pitch still: vibrato and glides move it by a fraction of a semitone, continuously. Pads,
    synths and most instruments hold a note dead steady, and drums have no stable partial at all. So: track the
    strongest clear peak (sub-bin accurate), drop note changes (jumps over 1.5 semitones), and measure the remaining
    back-and-forth movement over ~0.4 s (a one-way slide, like a kick drum's falling pitch, does not count). Frames without a clear peak score 0."""
    band = np.where((freqs >= VOICE_LO) & (freqs <= VOICE_HI))[0]
    B = S[band]
    k = np.argmax(B, axis=0)
    peak = B[k, np.arange(B.shape[1])]
    clear = peak > 6.0 * np.maximum(np.median(B, axis=0), 1e-9)
    # parabolic interpolation around the peak bin -> sub-bin frequency
    kk = np.clip(k, 1, len(band) - 2)
    a, b, c = (np.log(np.maximum(B[kk + d, np.arange(B.shape[1])], 1e-9)) for d in (-1, 0, 1))
    den = a - 2 * b + c
    off = np.where(np.abs(den) > 1e-9, 0.5 * (a - c) / np.where(np.abs(den) > 1e-9, den, 1.0), 0.0)
    f = freqs[band][kk] + np.clip(off, -0.5, 0.5) * (freqs[1] - freqs[0])
    semis = 12 * np.log2(np.maximum(f, 1.0) / 440.0)
    d = np.diff(semis, prepend=semis[:1])
    step = np.abs(d)
    ok = clear & np.roll(clear, 1) & (step < 1.5)
    moving = np.where(ok, np.clip((step - 0.03) / 0.12, 0.0, 1.0), 0.0)  # 0.03-0.15 semitone per frame = a voice wavering
    signed = np.where(ok, np.sign(d) * moving, 0.0)
    w = max(int(round(0.4 / fh)), 1)
    ones = np.ones(w)
    held = np.convolve(ok.astype(float), ones, mode="same")
    # wavering = back-and-forth movement; a one-way slide (a kick's pitch drop, a riser) cancels out here
    wobble = np.maximum(np.convolve(moving, ones, mode="same") - np.abs(np.convolve(signed, ones, mode="same")), 0.0)
    return np.where(held > 0, wobble / np.maximum(held, 1.0), 0.0) * (held / w)


def compute_curves(y: np.ndarray, sr: int, onsets: list[float], hop: int = 1024) -> Curves:
    duration = len(y) / sr
    n = max(int(np.ceil(duration / CURVE_HOP)), 1)
    fh = hop / sr
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop)[0]
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

    # vocal estimate: a wavering tonal partial in the voice range, weighted by how much energy sits in the voice band
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    band = (freqs >= 250) & (freqs <= 3500)
    share = np.clip(S[band].sum(axis=0) / np.maximum(S.sum(axis=0), 1e-9) * 1.5, 0.0, 1.0)
    vocal = _resample(np.clip(_pitch_motion(S, freqs, fh) * 1.5, 0.0, 1.0) * (0.4 + 0.6 * share), fh, n)
    vocal = np.convolve(vocal, np.ones(3) / 3, mode="same")
    vocal[loud < (np.max(loud) - 35)] = 0.0
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
