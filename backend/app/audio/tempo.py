"""Tempo that may change through the song, and how sure each beat is.

- **local tempo**: the song is read in overlapping windows (WINDOW seconds, every STEP seconds). Each window's tempo is
  measured twice, independently: from the spacing of the tracked beats, and from the onset-strength autocorrelation
  (tempogram). The tempogram reading is folded to the octave nearest the beats (half / double-time ambiguity), and the
  window's confidence is how well the two agree, how regular the beats are and how clear the tempogram peak is.
  Neighbouring windows at the same tempo (within SAME_TEMPO) are merged into sections.
- **beat confidence**: how strongly the music hits on the beat compared with its surroundings, and how close the beat
  sits to the local grid.
- **downbeats**: the 4-beat phase whose beats hit hardest, per section; its confidence is the margin over the next
  best phase. librosa has no reliable downbeat model: these are estimates, labelled as such.

Everything is measured from the audio; nothing here is a guess by an AI model.
"""

from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

HOP = 512
WINDOW = 12.0  # seconds of music per tempo reading
STEP = 6.0
SAME_TEMPO = 0.04  # windows within 4% are the same tempo
TEMPO_CHANGE = 0.08  # the song changes tempo when sections differ by more than 8%
MIN_BPM, MAX_BPM = 50.0, 220.0
SEARCH = 3  # frames (~70 ms) around a beat where its hit may sit
BETTER_FIT = 1.1  # another tempo is accepted for a window only if its pulse fits the music 10% better than the song's
RHYTHM_FIGURES = (3 / 4, 4 / 3, 2 / 3, 3 / 2)  # tempo readings at these ratios are dotted rhythms over the same beat


@dataclass
class TempoSection:
    start: float
    end: float
    bpm: float
    confidence: float


def _fold_near(bpm: float, ref: float) -> float:
    """``bpm`` at the octave (x2, /2) nearest ``ref``."""
    if bpm <= 0 or ref <= 0:
        return bpm
    while bpm < ref / 1.41:
        bpm *= 2
    while bpm > ref * 1.41:
        bpm /= 2
    return bpm


def _tempogram_bpm(env: np.ndarray, sr: int, a: int, b: int) -> tuple[float, float]:
    """(bpm, clarity 0..1) from the onset autocorrelation of frames a..b."""
    seg = env[a:b]
    if len(seg) < 64 or float(seg.max()) <= 0:
        return 0.0, 0.0
    ac = librosa.autocorrelate(seg - seg.mean())
    lags = np.arange(len(ac))
    with np.errstate(divide="ignore"):
        bpms = 60.0 * sr / HOP / np.maximum(lags, 1)
    ok = (bpms >= MIN_BPM) & (bpms <= MAX_BPM) & (lags > 0)
    if not ok.any() or ac[0] <= 0:
        return 0.0, 0.0
    i = int(np.argmax(np.where(ok, ac, -np.inf)))
    clarity = float(np.clip(ac[i] / ac[0], 0.0, 1.0)) * 2  # a clear periodic pulse correlates at ~0.3-0.5 of lag 0
    return float(bpms[i]), float(min(clarity, 1.0))


def _beat_bpm(beats: np.ndarray, a: float, b: float) -> tuple[float, float]:
    """(bpm, regularity 0..1) from the beats between a and b."""
    inside = beats[(beats >= a) & (beats < b)]
    if len(inside) < 4:
        return 0.0, 0.0
    d = np.diff(inside)
    med = float(np.median(d))
    if med <= 0:
        return 0.0, 0.0
    regular = float(max(0.0, 1.0 - np.median(np.abs(d - med)) / med * 4))
    steady = d[(d > 0.8 * med) & (d < 1.2 * med)]
    return 60.0 / float(steady.mean() if len(steady) else med), regular


def local_tempo(env: np.ndarray, sr: int, beats: np.ndarray, duration: float, global_bpm: float) -> list[TempoSection]:
    """The song's tempo, section by section (one section when it never changes)."""
    if duration <= 0:
        return []
    starts = np.arange(0.0, max(duration - WINDOW, 0.0) + 1e-6, STEP) if duration > WINDOW else np.array([0.0])
    readings: list[tuple[float, float, float, float]] = []  # (start, end, bpm, confidence)
    for s in starts:
        e = min(s + WINDOW, duration) if duration > WINDOW else duration
        a, b = (int(x) for x in librosa.time_to_frames([s, e], sr=sr, hop_length=HOP))
        if b - a < 64:
            continue
        # the window's own tempo, independent of the tracker (which can be wrong in one part of a song); librosa's
        # tempo prior picks the musical octave (100 BPM, not 200 or 50)
        tb = float(librosa.feature.tempo(onset_envelope=env[a:b], sr=sr, hop_length=HOP)[0])
        _, clarity = _tempogram_bpm(env, sr, a, b)
        bb, regular = _beat_bpm(beats, s, e)
        if tb <= 0:
            continue
        agree = 1.0 - min(abs(np.log2(_fold_near(bb, tb) / tb)) / 0.1, 1.0) if bb > 0 else 0.0
        conf = round(float(np.clip(0.4 * clarity + 0.35 * agree + 0.25 * regular, 0.0, 1.0)), 2)
        readings.append((float(s), float(e), tb, conf))
    if not readings:
        return [TempoSection(0.0, round(duration, 3), round(global_bpm, 1), 0.0)]
    # a window reading another tempo must fit the music clearly better than the song's own tempo does; a reading at
    # 3/4 or 5/4 of it (a common tempogram confusion) does not, and keeps the song's tempo
    fps = sr / HOP
    checked = []
    for s, e, bpm, conf in readings:
        if global_bpm > 0 and abs(bpm / global_bpm - 1) > TEMPO_CHANGE:
            a, b = int(s * fps), int(e * fps)
            own, main = _best_fit(env, a, b, bpm, fps), _best_fit(env, a, b, global_bpm, fps)
            ratio = bpm / global_bpm
            # 3 hits across 4 beats (or 2 across 3) is a dotted rhythm over the same beat, not a new tempo, when the
            # song's own pulse is still clearly there
            figure = any(abs(ratio / r - 1) < 0.03 for r in RHYTHM_FIGURES) and main >= 0.5 * own
            if own < main * BETTER_FIT or figure:
                bpm = global_bpm
        checked.append((s, e, bpm, conf))
    readings = checked
    # merge neighbours at the same tempo; each reading owns the middle of its window so sections do not overlap
    sections: list[list[float]] = []
    for k, (s, e, bpm, conf) in enumerate(readings):
        own_start = 0.0 if k == 0 else (s + readings[k - 1][1]) / 2 if readings[k - 1][1] > s else s
        if sections and abs(bpm - sections[-1][2]) / sections[-1][2] <= SAME_TEMPO:
            cur = sections[-1]
            n = cur[4]
            cur[1], cur[2], cur[3], cur[4] = e, (cur[2] * n + bpm) / (n + 1), (cur[3] * n + conf) / (n + 1), n + 1
        else:
            if sections:
                sections[-1][1] = own_start
            sections.append([own_start, e, bpm, conf, 1])
    sections[-1][1] = duration
    # a lone window straddling a tempo change reads an in-between tempo: it joins the neighbour nearest its tempo
    k = 1
    while 0 < k < len(sections) - 1:
        if sections[k][4] == 1:
            prev, cur, nxt = sections[k - 1], sections[k], sections[k + 1]
            if abs(cur[2] - prev[2]) <= abs(cur[2] - nxt[2]):
                prev[1] = cur[1]
            else:
                nxt[0] = cur[0]
            del sections[k]
            continue
        k += 1
    return [TempoSection(round(s, 3), round(e, 3), round(bpm, 1), round(c, 2)) for s, e, bpm, c, _ in sections if e - s > 0.5]


def _pulse_fit(env: np.ndarray, a: int, b: int, period: float) -> float:
    """How well frames a..b follow a steady pulse of ``period`` frames: the onset strength on the best-placed grid."""
    if b - a < period * 3:
        return 0.0
    best = 0.0
    for phase in np.arange(0.0, period, 1.0):
        idx = np.round(np.arange(a + phase, b, period)).astype(int)
        idx = idx[idx < len(env)]
        if len(idx):
            best = max(best, float(env[idx].mean()))
    return best


def _best_fit(env: np.ndarray, a: int, b: int, bpm: float, fps: float) -> float:
    """The pulse fit at the exact tempo near ``bpm`` (within 3%) that fits best: estimates come in coarse steps, and a
    pulse 2% off drifts off the music within a few bars, so comparing raw estimates would judge the error, not the music."""
    return max(_pulse_fit(env, a, b, 60.0 * fps / (bpm * (1 + k * 0.005))) for k in range(-6, 7))


def _change_point(env: np.ndarray, sr: int, near: float, before: float, after: float, lo_s: float, hi_s: float) -> float:
    """Where the tempo really changes from ``before`` to ``after`` BPM, searched within STEP of ``near``: the moment
    with the old pulse fitting best before it and the new pulse after it."""
    fps = sr / HOP
    pa, pb = 60.0 * fps / before, 60.0 * fps / after
    span = int(2 * STEP * fps)
    lo, hi = int(max(near - STEP, lo_s) * fps), int(min(near + STEP, hi_s) * fps)
    best_t, best = near, -1.0
    for f in range(lo, hi + 1, 2):
        score = _pulse_fit(env, max(f - span, 0), f, pa) + _pulse_fit(env, f, min(f + span, len(env)), pb)
        if score > best:
            best, best_t = score, f / fps
    return round(best_t, 3)


def refine(sections: list[TempoSection], beats: np.ndarray, env: np.ndarray | None = None, sr: int = 22050) -> list[TempoSection]:
    """Sharper sections: each boundary moved to where the pulse really changes (the reading windows are STEP apart),
    then each section's tempo from the spacing of its tracked beats (the tempogram works in coarse steps)."""
    if len(sections) < 2 or len(beats) < 8:
        return sections
    out = [TempoSection(s.start, s.end, s.bpm, s.confidence) for s in sections]

    def precise(margin: float) -> None:
        for sec in out:  # tempo from the beats well inside the section (a boundary may still be a little off)
            bpm, regular = _beat_bpm(beats, sec.start + margin, sec.end - margin)
            if bpm > 0 and abs(np.log2(bpm / sec.bpm)) < 0.1:  # same octave, just more precise
                sec.bpm = round(bpm, 1)
                sec.confidence = round(max(sec.confidence, 0.5 * sec.confidence + 0.5 * regular), 2)

    precise(STEP)
    if env is not None:
        for k in range(1, len(out)):
            t = _change_point(env, sr, out[k].start, out[k - 1].bpm, out[k].bpm, out[k - 1].start + 1.0, out[k].end - 1.0)
            out[k - 1].end = out[k].start = t
    precise(1.0)
    return out


def changes_tempo(sections: list[TempoSection], min_confidence: float = 0.5) -> bool:
    """True when confident sections differ by more than TEMPO_CHANGE (a real tempo change, not a wobble)."""
    sure = [s.bpm for s in sections if s.confidence >= min_confidence and s.end - s.start >= WINDOW]
    return len(sure) >= 2 and max(sure) / min(sure) - 1 > TEMPO_CHANGE


def tempo_curve(sections: list[TempoSection], n_frames: int, sr: int) -> np.ndarray:
    """A per-frame tempo (BPM) for librosa's beat tracker, following the sections."""
    times = librosa.frames_to_time(np.arange(n_frames), sr=sr, hop_length=HOP)
    curve = np.full(n_frames, sections[0].bpm if sections else 120.0)
    for s in sections:
        curve[(times >= s.start) & (times < s.end)] = s.bpm
    return curve


def _peak(env: np.ndarray, frames: np.ndarray) -> np.ndarray:
    return np.array([env[max(f - SEARCH, 0): f + SEARCH + 1].max() if len(env) else 0.0 for f in frames])


def beat_confidence(beats: np.ndarray, env: np.ndarray, sr: int, sections: list[TempoSection]) -> np.ndarray:
    """0..1 per beat: the hit on the beat against the music around it (60%), and the beat on the local grid (40%)."""
    if len(beats) == 0:
        return np.array([])
    frames = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(env) - 1)
    hit = _peak(env, frames)
    win = int(4.0 * sr / HOP)  # the music around: 4 s either side
    local = np.array([np.percentile(env[max(f - win, 0): f + win + 1], 90) for f in frames])
    strength = np.clip(hit / np.maximum(local, 1e-6), 0.0, 1.0)
    period = np.array([60.0 / next((s.bpm for s in sections if s.start <= t < s.end), sections[-1].bpm if sections else 120.0) for t in beats])
    gaps = np.diff(beats)
    near = np.minimum(np.r_[gaps, np.inf], np.r_[np.inf, gaps])  # the nearer neighbour
    off = np.abs(near / period - np.round(np.maximum(near / period, 0.5) * 2) / 2)  # beats sit on the grid or half of it
    on_grid = np.clip(1.0 - np.nan_to_num(off, nan=1.0, posinf=1.0) * 4, 0.0, 1.0)
    return np.round(0.6 * strength + 0.4 * on_grid, 2)


def downbeats(beats: np.ndarray, env: np.ndarray, sr: int, per_bar: int = 4) -> tuple[np.ndarray, float]:
    """(downbeat times, confidence 0..1): the 4-beat phase whose beats hit hardest. Confidence is the margin over the
    next best phase; near 0 means the bars could start on any beat (a guess)."""
    if len(beats) < per_bar * 2:
        return np.array([]), 0.0
    frames = np.clip(librosa.time_to_frames(beats, sr=sr, hop_length=HOP), 0, len(env) - 1)
    hit = _peak(env, frames)
    scores = np.array([hit[p::per_bar].mean() for p in range(per_bar)])
    order = np.argsort(scores)[::-1]
    best, second = float(scores[order[0]]), float(scores[order[1]])
    conf = float(np.clip((best - second) / max(best, 1e-6) * 3, 0.0, 1.0))
    return beats[int(order[0])::per_bar], round(conf, 2)
