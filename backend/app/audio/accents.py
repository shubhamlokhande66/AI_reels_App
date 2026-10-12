"""Which beats are strong: the bar starts, the backbeats, and how hard each beat really hits.

For every tracked beat, four measurements (all from librosa, no model):

- **kick**: the low-frequency attack (below KICK_HZ: kick drum, 808, dhol's bass side), the clearest sign of a strong beat
- **snare**: the attack in the snare / clap band (SNARE_BAND), the backbeat on beats 2 and 4
- **harmony change**: how much the chords change across the beat (chroma before vs after); new bars bring new chords
- **bass change**: whether the bass note changes on the beat

**Bar starts** (downbeats, 4/4): each of the four beat phases is scored by kick + harmony change + bass change, in
windows of WINDOW_BARS bars (a pickup bar or a shift in the bar is followed), and the windows agree or not: the
confidence is the margin of the winning phase times how consistently it wins. Section starts vote too.

**Exact times**: the tracker's beats sit on its tempo grid, often 10-40 ms off the drum hit. Each beat is moved onto
the real hit (the peak of a fine onset curve, ~6 ms frames with sub-frame interpolation, within HIT_WINDOW) when a
clear hit is there; a beat with no clear hit keeps its time and can only be weak.

**Strong / medium / weak**: strong = the strong beats below; medium = a beat with a clear hit that is a backbeat with
the snare, a bar start, or hits at least as hard as its neighbours; weak = the rest (left out of the markers).

**Levels**: 4 = a bar start with a hard kick, 3 = another bar start, 2 = a backbeat (2 and 4, the snare), 1 = any other
beat. **Strong beats** are judged against the beats around them (STRONG_CONTEXT beats either side: a soft intro still
has strong beats, a loud drop does not make every beat strong) and kept to about STRONG_SHARE of the beats.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

HOP = 512
KICK_HZ = 150.0
SNARE_BAND = (1800.0, 6000.0)
SEARCH = 2  # frames (~46 ms) around a beat where its attack may sit
WINDOW_BARS = 8
STRONG_CONTEXT = 8  # beats either side that a beat's strength is compared with
STRONG_SHARE = 0.28  # about 1 beat in 4 is strong
STRONG_RATIO = 1.25  # ... and only one that hits clearly harder than its neighbours
BEATS_PER_BAR = 4
FINE_HOP = 128  # ~5.8 ms at 22050 Hz: where exactly a hit lands
HIT_WINDOW = 0.05  # s either side of a tracked beat where its real hit may be
HIT_CLEAR = 1.5  # the hit's peak against the median of its window: below this there is no clear hit
MEDIUM_RATIO = 1.0  # a medium beat hits at least as hard as the beats around it


def snap_to_hits(y: np.ndarray, sr: int, beats: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Each beat moved onto its real hit (see the module doc); and whether a clear hit was there."""
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=FINE_HOP, n_fft=512)
    # the waveform's level (1 ms peaks): where an attack actually rises, which the onset curve only shows a few ms late
    ms = max(int(sr * 0.001), 1)
    amp = np.abs(y[: len(y) // ms * ms]).reshape(-1, ms).max(axis=1)
    if len(env) < 3:
        return beats.copy(), np.zeros(len(beats), dtype=bool)
    win = max(int(HIT_WINDOW * sr / FINE_HOP), 2)
    floor = float(np.median(env))
    out, clear = beats.copy(), np.zeros(len(beats), dtype=bool)
    for i, t in enumerate(beats):
        f = int(round(t * sr / FINE_HOP))
        lo, hi = max(f - win, 1), min(f + win + 1, len(env) - 1)
        if hi - lo < 3:
            continue
        seg = env[lo:hi]
        k = int(np.argmax(seg))
        peak = float(seg[k])
        if peak < HIT_CLEAR * max(float(np.median(seg)), 1e-9) or peak <= floor:
            continue
        j = lo + k  # sub-frame: the top of a parabola through the peak and its neighbours
        a, b, c = float(env[j - 1]), float(env[j]), float(env[j + 1])
        den = a - 2 * b + c
        shift = 0.5 * (a - c) / den if abs(den) > 1e-12 else 0.0
        tp = (j + float(np.clip(shift, -0.5, 0.5))) * FINE_HOP / sr
        out[i] = round(_attack(amp, tp, ms / sr), 3)
        clear[i] = True
    # never let two beats swap or touch
    for i in range(1, len(out)):
        if out[i] <= out[i - 1] + 0.05:
            out[i] = beats[i] if beats[i] > out[i - 1] + 0.05 else out[i - 1] + 0.05
    return out, clear


def _attack(amp: np.ndarray, tp: float, step: float) -> float:
    """The moment the hit near ``tp`` (the onset curve's peak, s) rises halfway from the level before it to its top:
    the attack itself (``amp`` = the waveform's level per ``step`` s, about 1 ms)."""
    k = int(round(tp / step))
    lo, hi = max(k - int(0.03 / step), 0), min(k + int(0.012 / step), len(amp))
    if hi - lo < 10:
        return tp
    base = float(np.median(amp[max(lo - int(0.02 / step), 0): lo + 5]))
    top_i = lo + int(np.argmax(amp[lo:hi]))
    top = float(amp[top_i])
    if top <= base * 1.3:
        return tp  # no clear rise: keep the onset time
    level = base + 0.5 * (top - base)
    i = top_i
    while i > lo and amp[i - 1] >= level:
        i -= 1
    return i * step


@dataclass
class Accents:
    downbeats: list[float]
    downbeat_confidence: float
    strong_beats: list[float]
    levels: list[int]  # one per beat
    kick: list[float]  # one per beat, 0..1 (against the song's hardest kicks)
    beats: list[float] | None = None  # the beats on their real hits (same count and order as given)
    medium_beats: list[float] | None = None


def _band_onset(S: np.ndarray, freqs: np.ndarray, lo: float, hi: float, sr: int) -> np.ndarray:
    band = S[(freqs >= lo) & (freqs < hi)]
    if band.size == 0:
        return np.zeros(S.shape[1])
    return librosa.onset.onset_strength(S=librosa.amplitude_to_db(band, ref=np.max), sr=sr, hop_length=HOP)


def _at(curve: np.ndarray, frames: np.ndarray) -> np.ndarray:
    return np.array([curve[max(f - SEARCH, 0): f + SEARCH + 1].max() if len(curve) else 0.0 for f in frames])


def _change(feat: np.ndarray, frames: np.ndarray, width: int) -> np.ndarray:
    """How different the feature (columns = frames) is just after each frame compared with just before (cosine)."""
    out = []
    for f in frames:
        a = feat[:, max(f - width, 0): f].mean(axis=1) if f > 0 else feat[:, :1].mean(axis=1)
        b = feat[:, f: f + width].mean(axis=1) if f < feat.shape[1] else feat[:, -1:].mean(axis=1)
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        out.append(0.0 if na < 1e-9 or nb < 1e-9 else 1.0 - float(np.dot(a, b) / (na * nb)))
    return np.array(out)


def _rel(x: np.ndarray, k: int) -> np.ndarray:
    """Each value against the median of the values around it (k either side)."""
    out = np.empty(len(x))
    for i in range(len(x)):
        seg = x[max(i - k, 0): i + k + 1]
        med = float(np.median(seg))
        out[i] = x[i] / med if med > 1e-9 else 1.0
    return out


def _z(x: np.ndarray) -> np.ndarray:
    s = float(np.std(x))
    return (x - float(np.mean(x))) / s if s > 1e-9 else np.zeros_like(x)


def analyze(y: np.ndarray, sr: int, beats: list[float], section_starts: list[float] | None = None) -> Accents:
    b = np.asarray(beats, dtype=float)
    n = len(b)
    if n < BEATS_PER_BAR * 2:
        return Accents([], 0.0, list(b), [1] * n, [0.0] * n)
    b, clear = snap_to_hits(y, sr, b)
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HOP)).astype(np.float32)
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    frames = np.clip(librosa.time_to_frames(b, sr=sr, hop_length=HOP), 0, S.shape[1] - 1)
    kick_on = _band_onset(S, freqs, 0.0, KICK_HZ, sr)
    snare_on = _band_onset(S, freqs, *SNARE_BAND, sr)
    chroma = librosa.feature.chroma_stft(S=S ** 2, sr=sr, hop_length=HOP)
    bass_chroma = librosa.feature.chroma_stft(S=(S * (freqs[:, None] < 250)) ** 2, sr=sr, hop_length=HOP)
    del S
    period = float(np.median(np.diff(b)))
    width = max(int(period * sr / HOP), 2)  # one beat of frames either side
    kick = _at(kick_on, frames)
    snare = _at(snare_on, frames)
    harm = _change(chroma, frames, width * 2)  # chords: compare two beats either side
    bass = _change(bass_chroma, frames, width)

    # bar starts: which of the 4 phases has the kick, the chord changes and the bass moves, window by window
    cue = 1.0 * _z(kick) + 0.8 * _z(harm) + 0.5 * _z(bass) - 0.3 * _z(snare)
    votes = np.zeros(n)
    for t in section_starts or []:  # a new section starts on a bar
        i = int(np.argmin(np.abs(b - t)))
        if abs(b[i] - t) <= period * 0.5:
            votes[i] += 1.0
    cue = cue + 0.8 * votes
    win = WINDOW_BARS * BEATS_PER_BAR
    phases, margins = [], []
    for start in range(0, n, win // 2):
        seg = range(start, min(start + win, n))
        if len(seg) < BEATS_PER_BAR * 2:
            break
        score = [float(np.mean([cue[i] for i in seg if (i - p) % BEATS_PER_BAR == 0] or [0.0])) for p in range(BEATS_PER_BAR)]
        order = np.argsort(score)[::-1]
        phases.append((start, int(order[0])))
        margins.append(score[order[0]] - score[order[1]])
    if not phases:
        return Accents([], 0.0, list(b), [1] * n, [0.0] * n, beats=[float(t) for t in b], medium_beats=[])
    main = max(set(p for _, p in phases), key=lambda q: sum(1 for _, p in phases if p == q))
    consistency = sum(1 for _, p in phases if p == main) / len(phases)
    margin = float(np.clip(np.median(margins) / 1.0, 0.0, 1.0))
    confidence = round(float(np.clip(margin * consistency * 1.2, 0.0, 1.0)), 2)
    # a window may follow a different phase (a pickup, a 2-beat bar) only when it wins there clearly
    phase_at = np.full(n, main)
    for (start, p), m in zip(phases, margins):
        if p != main and m > 0.6:
            phase_at[start: start + win] = p
    is_down = np.array([(i - phase_at[i]) % BEATS_PER_BAR == 0 for i in range(n)])
    is_back = np.array([(i - phase_at[i]) % BEATS_PER_BAR in (1, 3) for i in range(n)])

    # strength against the beats around it: kick first, the snare for backbeats
    kick_rel = _rel(kick, STRONG_CONTEXT)
    snare_rel = _rel(snare, STRONG_CONTEXT)
    hit = np.maximum(kick_rel, 0.8 * snare_rel)
    levels = []
    for i in range(n):
        if is_down[i]:
            levels.append(4 if kick_rel[i] >= STRONG_RATIO else 3)
        elif is_back[i] and snare_rel[i] >= 1.0:
            levels.append(2)
        else:
            levels.append(1)
    # strong: a hard-hitting bar start, or any beat that clearly out-hits its neighbours; capped at STRONG_SHARE
    score = hit + 0.35 * is_down + 0.15 * np.array([lv == 4 for lv in levels])
    target = max(int(round(n * STRONG_SHARE)), 1)
    candidates = [i for i in range(n) if levels[i] == 4 or hit[i] >= STRONG_RATIO]
    keep = sorted(candidates, key=lambda i: -score[i])[:target]
    if len(keep) < target * 0.6:  # every beat hits about as hard: the bar starts are the strong beats
        bars = sorted((i for i in range(n) if is_down[i] and i not in keep), key=lambda i: -score[i])
        keep += bars[: target - len(keep)]
    strong = sorted(float(b[i]) for i in keep)
    keep_set = set(keep)
    medium = [round(float(b[i]), 3) for i in range(n) if i not in keep_set and clear[i]
              and (levels[i] >= 2 or hit[i] >= MEDIUM_RATIO)]  # fmt: skip
    top = float(np.percentile(kick, 97)) or 1.0
    return Accents(
        downbeats=[round(float(b[i]), 3) for i in range(n) if is_down[i]],
        downbeat_confidence=confidence,
        strong_beats=[round(t, 3) for t in strong],
        levels=levels,
        kick=[round(float(min(k / top, 1.0)), 3) for k in kick],
        beats=[round(float(t), 3) for t in b],
        medium_beats=medium,
    )
