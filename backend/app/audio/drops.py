"""Candidate music events: drops, build-ups, breakdowns and entries after silence.

No single loudness threshold: every moment is judged on five measurements at once, each against the music around it
(adaptive, so a quiet song and a loud one are treated alike):

- **energy** (RMS) - how loud
- **bass** (energy below 150 Hz) - many drops are the bass and kick coming in
- **flux** (onset strength) - how much new sound arrives
- **density** (onsets per second) - how busy the rhythm is
- **brightness** (spectral centroid) - how much high end (hi-hats, cymbals, synths open up)

For each, the change from the JUMP seconds before to the JUMP seconds after is compared with how much that measurement
normally changes over JUMP seconds in the LOCAL seconds around it (a robust z-score: median absolute deviation). A
**possible drop** is a moment where the combined change stands out, energy or bass rises with at least one other
measurement agreeing, and the music lands loud (an intro busy with hits can lose flux at its drop); an **entry** is
the same out of near silence; a **breakdown** is the mirror (the music falls away); a **build-up** is a stretch of
steadily rising energy and density that leads into a drop. Each event carries its confidence and the measurements
behind it. These are estimates: the person (or the editor) has the last word.
"""

from __future__ import annotations

import librosa
import numpy as np
from scipy.ndimage import uniform_filter1d

from app.models.analysis import MusicEvent

HOP_S = 0.1  # seconds per measurement point
JUMP = 2.0  # seconds compared before / after a moment
LOCAL = 30.0  # seconds of context that define "normal variation"
MIN_GAP = 8.0  # two drops are at least this far apart (closer in a short song: a sixth of it, at least 3 s)
WEIGHTS = {"energy": 0.35, "bass": 0.3, "flux": 0.2, "density": 0.1, "brightness": 0.05}
LOUDNESS = ("energy", "bass")  # a drop needs one of these rising
BASS_HZ = 150.0
DROP_Z = 1.5  # combined change (weighted, in units of normal variation) a drop needs at least
AGREE_Z = 1.5  # a measurement "agrees" when its own change is at least this
MIN_SPREAD = 0.06  # the smallest "normal variation" (6% of the loud level): steadier music still needs a real change
LOUD_AFTER = 50  # a drop lands at least as loud as this percentile of the song ...
BIG_RISE = 0.3  # ... or this much louder than just before it (0..1 energy)
QUIET_BEFORE = 15  # an entry comes out of music quieter than this percentile
BUILD_MIN, BUILD_MAX = 3.0, 16.0  # seconds a build-up lasts
DROP_CONFIDENCE = 0.5  # events at least this sure count as the song's drops


def _norm(x: np.ndarray) -> np.ndarray:
    """0..1 against the song's loud level (its 95th percentile). Not stretched min-to-max: in a steady song that would
    blow small wobbles up into big changes."""
    top = np.percentile(x, 95)
    return np.clip(x / top, 0.0, 1.0) if top > 1e-9 else np.zeros_like(x)


def measurements(y: np.ndarray, sr: int, env: np.ndarray, onsets: list[float], hop: int = 512) -> dict[str, np.ndarray]:
    """The five curves, every HOP_S seconds, each 0..1."""
    n = max(int(len(y) / sr / HOP_S), 1)
    step = int(sr * HOP_S)
    rms = librosa.feature.rms(y=y, frame_length=step * 4, hop_length=step, center=True)[0][:n]
    t_env = librosa.frames_to_time(np.arange(len(env)), sr=sr, hop_length=hop)
    flux = np.array([env[(t_env >= k * HOP_S) & (t_env < (k + 1) * HOP_S)].mean() if len(env) else 0.0 for k in range(n)])
    flux = np.nan_to_num(flux)
    counts = np.bincount(np.clip((np.asarray(onsets) / HOP_S).astype(int), 0, n - 1), minlength=n)[:n] if len(onsets) else np.zeros(n)
    density = uniform_filter1d(counts.astype(float), size=int(1.0 / HOP_S), mode="nearest") / HOP_S
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=step))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    bass = np.sqrt((S[freqs <= BASS_HZ] ** 2).mean(axis=0))[:n]
    centroid = librosa.feature.spectral_centroid(S=S, sr=sr)[0][:n]
    curves = {"energy": rms, "bass": bass, "flux": flux, "density": density, "brightness": centroid}
    return {k: _norm(uniform_filter1d(np.pad(v, (0, n - len(v)), mode="edge") if len(v) < n else v, size=3, mode="nearest"))
            for k, v in curves.items()}  # fmt: skip


def _jumps(x: np.ndarray, w: int) -> np.ndarray:
    """mean(after) - mean(before) at every point (0 where the window does not fit)."""
    c = np.concatenate([[0.0], np.cumsum(x)])
    out = np.zeros(len(x))
    i = np.arange(w, len(x) - w)
    out[i] = (c[i + w] - c[i]) / w - (c[i] - c[i - w]) / w
    return out


def _local_spread(jumps: np.ndarray, w: int) -> np.ndarray:
    """How much a 2-second change normally is around each point: 1.4826 x the median absolute deviation of the
    changes within w points, plus their median size (a robust standard deviation)."""
    a = np.abs(jumps)
    out = np.empty(len(a))
    for i in range(len(a)):
        seg = a[max(i - w, 0): i + w + 1]
        med = np.median(seg)
        out[i] = med + 1.4826 * np.median(np.abs(seg - med))
    return np.maximum(out, MIN_SPREAD)


def detect_events(curves: dict[str, np.ndarray], beats: list[float]) -> list[MusicEvent]:
    n = len(curves["energy"])
    w, local = int(JUMP / HOP_S), int(LOCAL / HOP_S / 2)
    if n < 2 * w + 1:
        return []
    jumps = {k: _jumps(v, w) for k, v in curves.items()}
    z = {k: jumps[k] / _local_spread(jumps[k], local) for k in curves}
    # rises and falls are scored apart: at a drop the bass can arrive while the hits of a busy intro stop, and a
    # measurement moving the other way must not cancel the ones that rise
    rising = sum(WEIGHTS[k] * np.clip(z[k], 0, None) for k in WEIGHTS)
    falling = sum(WEIGHTS[k] * np.clip(-z[k], 0, None) for k in WEIGHTS)
    combined = rising - falling
    energy = curves["energy"]
    loud, quiet = np.percentile(energy, LOUD_AFTER), np.percentile(energy, QUIET_BEFORE)
    smooth_before = np.array([energy[max(i - w, 0): i].mean() if i else energy[0] for i in range(n)])
    smooth_after = np.array([energy[i: i + w].mean() for i in range(n)])

    def snap(t: float) -> float:
        near = min(beats, key=lambda b: abs(b - t)) if beats else t
        return round(near if abs(near - t) <= 0.25 else t, 3)

    gap = min(MIN_GAP, max(3.0, n * HOP_S / 6))
    others = [k for k in WEIGHTS if k not in LOUDNESS]

    def event(i: int, kind: str, sign: float) -> MusicEvent:
        # energy and bass moving together is the event itself; the other measurements agreeing make it surer
        loud_agree = sum(1 for k in LOUDNESS if sign * z[k][i] >= AGREE_Z) / len(LOUDNESS)
        other_agree = sum(1 for k in others if sign * z[k][i] >= AGREE_Z) / len(others)
        score = rising[i] if sign > 0 else falling[i]
        sure = float(np.clip((score - DROP_Z) / (DROP_Z / 2), 0.0, 1.0))
        conf = round(0.5 * sure + 0.3 * loud_agree + 0.2 * other_agree, 2)
        return MusicEvent(time=snap(i * HOP_S), type=kind, strength=round(float(smooth_after[i] if sign > 0 else smooth_before[i]), 2),
                          confidence=conf, measurements={**{f"{k}_change": round(float(z[k][i]), 2) for k in WEIGHTS},
                                                         "combined": round(float(score), 2),
                                                         "energy_before": round(float(smooth_before[i]), 2),
                                                         "energy_after": round(float(smooth_after[i]), 2)})  # fmt: skip

    def peaks(sign: float) -> list[int]:
        score = rising if sign > 0 else falling
        found: list[int] = []
        for i in np.argsort(score)[::-1]:
            if score[i] < DROP_Z:
                break
            if all(abs(int(i) - j) * HOP_S >= gap for j in found):
                found.append(int(i))
        return sorted(found)

    events: list[MusicEvent] = []
    for i in peaks(+1.0):
        if smooth_after[i] < loud and smooth_after[i] - smooth_before[i] < BIG_RISE:  # louder, but does not land loud
            continue
        agree = sum(1 for k in WEIGHTS if z[k][i] >= AGREE_Z)
        if agree < 2 or not any(z[k][i] >= AGREE_Z for k in LOUDNESS):  # one measurement alone is not a drop
            continue
        events.append(event(i, "entry" if smooth_before[i] <= quiet else "possible_drop", +1.0))
    for i in peaks(-1.0):
        if smooth_after[i] <= np.percentile(energy, 50) and sum(1 for k in WEIGHTS if -z[k][i] >= AGREE_Z) >= 2:
            ev = event(i, "breakdown", -1.0)
            back = next((k for k in range(i + w, n) if energy[k] >= smooth_before[i] * 0.9), n - 1)
            ev.end = round(back * HOP_S, 3)
            events.append(ev)
    # build-ups: energy and density rising steadily into a drop
    rise = uniform_filter1d(curves["energy"] * 0.6 + curves["density"] * 0.4, size=int(1.0 / HOP_S), mode="nearest")
    for d in [e for e in events if e.type == "possible_drop"]:
        i = int(round(d.time / HOP_S))
        k = i - 1
        while k > 0 and i - k < BUILD_MAX / HOP_S and rise[k - 1] <= rise[k] + 0.01:
            k -= 1
        span = (i - k) * HOP_S
        if span >= BUILD_MIN and rise[i - 1] - rise[k] >= 0.15:
            events.append(MusicEvent(time=snap(k * HOP_S), end=d.time, type="build_up", strength=round(float(rise[i - 1] - rise[k]), 2),
                                     confidence=round(min(d.confidence, 0.4 + (rise[i - 1] - rise[k])), 2),
                                     measurements={"seconds": round(span, 2), "rise": round(float(rise[i - 1] - rise[k]), 2)}))  # fmt: skip
    return sorted(events, key=lambda e: e.time)


def drops_from(events: list[MusicEvent]) -> list[float]:
    """The song's drops: the sure drops and entries (a build-up or breakdown is not one)."""
    return sorted({e.time for e in events if e.type in ("possible_drop", "entry") and e.confidence >= DROP_CONFIDENCE})
