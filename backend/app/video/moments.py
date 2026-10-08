"""Best moments: the instants of a clip worth cutting to, and short ready-made spans built around them.

Events are found in the per-sample measurements the analyzer already took (no extra decoding, no AI):

* action_peak     the movement inside the picture peaks (a hand move, a turn, a pour)
* camera_settles  a camera move comes to rest: it has arrived at what it was travelling to
* face_appears    a face turns up / turns toward the camera
* focus_peak      the picture snaps sharp after being soft (a focus pull lands)
* subject_close   the subject fills the most of the frame (the camera reached the product)
* reveal          the picture goes from empty / dark to showing something

Only moments inside usable windows count (never in a dark, blurry or shaky stretch). The Creative Director receives
them as facts and uses them instead of whole clips; the rule-based editor and the reviewer read the same numbers.
"""

from __future__ import annotations

from typing import Sequence

import numpy as np

from app.models.analysis import BestSegment, Moment, UsableWindow

MAX_MOMENTS = 12
MAX_SEGMENTS = 6
MIN_GAP = 0.6  # seconds between two moments of the same clip
SEG_BEFORE, SEG_AFTER = 0.7, 1.3  # a span starts a little before its event and lets it play out
PLAIN_SEG = 2.0  # length of a "best-looking stretch" span when a window has no event
PRODUCT_CATEGORIES = ("product", "jewelry", "fashion", "beauty")

REASONS = {
    "action_peak": "the movement peaks",
    "camera_settles": "the camera move arrives and settles",
    "face_appears": "a face turns up",
    "focus_peak": "the picture snaps into focus",
    "subject_close": "the subject fills the frame",
    "reveal": "the picture goes from empty to showing something",
}


def _window_at(windows: Sequence[UsableWindow], t: float) -> UsableWindow | None:
    return next((w for w in windows if w.start - 1e-6 <= t <= w.end + 1e-6), None)


def _local_peaks(x: np.ndarray, min_rise: float) -> list[int]:
    out = []
    for i in range(1, len(x) - 1):
        if x[i] >= x[i - 1] and x[i] > x[i + 1]:
            lo = min(x[max(i - 4, 0):i].min(), x[i + 1:i + 5].min())
            if x[i] - lo >= min_rise:
                out.append(i)
    return out


def detect_moments(times: Sequence[float], subj_motion: Sequence[float], camera: Sequence[float], faces: Sequence[bool],
                   sharp: Sequence[float], area: Sequence[float], empty: Sequence[bool], windows: Sequence[UsableWindow],
                   scene_cuts: Sequence[bool] = ()) -> list[Moment]:  # fmt: skip
    """All series are per analysis sample (same length as ``times``). ``subj_motion`` is the raw movement inside the
    picture (any scale: it is judged against the clip's own typical movement); camera/sharp/area are 0..1."""
    n = len(times)
    if n < 3 or not windows:
        return []
    t = np.asarray(times, dtype=float)
    sm, cam, sh, ar = (np.asarray(v, dtype=float) for v in (subj_motion, camera, sharp, area))
    cuts = list(scene_cuts) if len(scene_cuts) == n else [False] * n
    raw: list[tuple[float, str, float]] = []  # (t, kind, strength 0..1)

    # an action peak stands out from the clip's OWN movement: wind in leaves, handheld wobble and compression noise move
    # every frame a little, so only peaks well above the clip's typical movement count (a car passing, a hand gesture)
    typical = float(np.median(sm)) + 1e-4
    rel = sm / typical
    peaks = [i for i in _local_peaks(rel, 0.6) if rel[i] >= 1.8 and sm[i] >= 0.004]
    for i in sorted(peaks, key=lambda i: -rel[i])[: max(2, int((t[-1] - t[0]) / 3))]:  # about one per 3 s at most
        raw.append((t[i], "action_peak", float(min(0.4 + 0.15 * rel[i], 1.0))))
    for i in range(2, n):  # moving for a while, then still
        if cuts[i] or cuts[i - 1]:
            continue
        before = cam[max(i - 4, 0):i]
        if before.size >= 2 and before.mean() >= 0.35 and cam[i] < 0.15:
            raw.append((t[i], "camera_settles", float(min(before.mean() + 0.3, 1.0))))
    for i in range(1, n):
        if faces[i] and not any(faces[max(i - 3, 0):i]) and not cuts[i]:
            raw.append((t[i], "face_appears", 0.8))
    for i in _local_peaks(sh, 0.2):
        if sh[max(i - 4, 0):i].min() < 0.55:  # it was soft before: a focus pull or a move into focus
            raw.append((t[i], "focus_peak", float(sh[i])))
    if ar.max() > 0.12:  # only the clear biggest framings count: small wobbles of the subject box are not events
        top = [i for i in _local_peaks(ar, 0.12) if ar[i] >= 0.85 * ar.max() and ar[i] - float(np.median(ar)) >= 0.1]
        for i in sorted(top, key=lambda i: -ar[i])[:2]:
            raw.append((t[i], "subject_close", float(min(ar[i] * 1.5, 1.0))))
    for i in range(2, n):
        if not empty[i] and all(empty[max(i - 3, 0):i]) and not cuts[i]:
            raw.append((t[i], "reveal", 0.75))

    out: list[Moment] = []
    for tm, kind, strength in sorted(raw, key=lambda r: -r[2]):
        w = _window_at(windows, tm)
        if w is None:
            continue  # only usable footage
        if any(abs(m.t - tm) < MIN_GAP for m in out):
            continue
        out.append(Moment(t=round(float(tm), 3), kind=kind, score=round(float(strength * (0.5 + 0.5 * w.quality)), 3),  # type: ignore[arg-type]
                          reason=REASONS[kind]))  # fmt: skip
        if len(out) >= MAX_MOMENTS:
            break
    return sorted(out, key=lambda m: m.t)


def _span_value(w: UsableWindow) -> float:
    return 0.45 * w.quality + 0.25 * w.composition + 0.2 * w.subject + 0.1 * (1 - w.empty)


def best_segments(windows: Sequence[UsableWindow], moments: Sequence[Moment]) -> list[BestSegment]:
    """Short spans (about 1-3 s), each inside one usable window, best first, never overlapping."""
    cands: list[BestSegment] = []
    for m in moments:
        w = _window_at(windows, m.t)
        if w is None:
            continue
        a, b = max(m.t - SEG_BEFORE, w.start), min(m.t + SEG_AFTER, w.end)
        if b - a < 0.5:
            continue
        score = 0.55 * _span_value(w) + 0.45 * m.score
        cands.append(BestSegment(start=round(a, 2), end=round(b, 2), score=round(score, 3), moment=m.kind,
                                 reason=f"{REASONS[m.kind]} at {m.t:.1f}s"))  # fmt: skip
    for w in windows:  # every window also offers its best-looking stretch (around its motion peak when it has one)
        if w.end - w.start < 0.5:
            continue
        mid = (w.start + w.end) / 2
        if w.motion_curve:
            k = int(np.argmax(w.motion_curve))
            mid = w.start + k * w.curve_dt
        half = min(PLAIN_SEG, w.end - w.start) / 2
        a = min(max(mid - half, w.start), w.end - 2 * half)
        cands.append(BestSegment(start=round(a, 2), end=round(a + 2 * half, 2), score=round(0.85 * _span_value(w), 3),
                                 reason=f"{w.shot_size} shot, clean picture" if w.shot_size != "unknown" else "clean picture"))  # fmt: skip
    out: list[BestSegment] = []
    for c in sorted(cands, key=lambda c: -c.score):
        if all(c.end <= o.start + 0.1 or c.start >= o.end - 0.1 for o in out):
            out.append(c)
        if len(out) >= MAX_SEGMENTS:
            break
    return out


def product_visibility(windows: Sequence[UsableWindow], category: str | None) -> float | None:
    """How clearly the product is on screen, for clips the vision model says show a product; None otherwise.
    The best usable window counts (one clear close-up is enough), lifted by close framing and composition."""
    if category not in PRODUCT_CATEGORIES or not windows:
        return None
    best = 0.0
    for w in windows:
        framing = {"close": 1.0, "medium": 0.8, "wide": 0.5}.get(w.shot_size, 0.6)
        best = max(best, (0.5 * w.subject + 0.2 * w.composition + 0.3 * w.quality) * framing * (1 - 0.7 * w.empty))
    return round(min(best * 1.15, 1.0), 3)
