"""Learning from many trending Reels, and editing like them.

* ``group_videos``: sorts dozens of measured reference Reels into a few editing styles (k-means on their rhythm and look:
  shot length, cuts per 10 s, beat sync, hook length, brightness, colour), so 50 different Reels do not average into one
  bland middle. Each style gets a plain-language name from its numbers ("Fast · beat-synced · vivid").
* ``recency_weight``: newer Reels count more (trends change): a Reel's weight halves every ``HALF_LIFE_DAYS``.
* ``apply_trend``: turns a learned style into the editing rules for *this* song: seconds per shot in loud and calm parts
  become beats at the song's tempo; the shortest / longest shot, beat accents, transitions, hook priority and colour
  follow the trend. Deterministic, so a trend shapes the Reel even when no AI is available.
* ``best_match``: for "auto", the learned style that fits this Reel best (the user's words, the song's tempo, the length).
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any

import numpy as np

from app.styles.base import EditingStyle

HALF_LIFE_DAYS = 45.0
MIN_PER_GROUP = 4  # a style needs a few Reels to be a style, not one odd video
MAX_GROUPS = 6
MIN_STYLE_GAP = 0.45  # how different two styles must be (e.g. shots ~1.6x longer, or a clearly different beat sync)
MIN_MATCH = 1.0  # "auto" uses a learned style only when it fits at least this well (words, tempo, length)


def recency_weight(added_at: Any, now: datetime | None = None) -> float:
    """1.0 for a Reel added today, 0.5 after HALF_LIFE_DAYS, never below 0.15 (old Reels still count a little)."""
    if not added_at:
        return 1.0
    if isinstance(added_at, str):
        try:
            added_at = datetime.fromisoformat(added_at.replace("Z", "+00:00"))
        except ValueError:
            return 1.0
    if added_at.tzinfo is None:
        added_at = added_at.replace(tzinfo=timezone.utc)
    days = max(((now or datetime.now(timezone.utc)) - added_at).total_seconds() / 86400, 0.0)
    return max(0.5 ** (days / HALF_LIFE_DAYS), 0.15)


# ---------------------------------------------------------------------- grouping
def features(v: dict[str, Any]) -> list[float]:
    """What makes an edit feel the way it does, on comparable scales."""
    look = v.get("look") or {}
    beat = v.get("on_beat_share")
    return [
        math.log(max(v.get("median_shot") or v.get("avg_shot") or 2.0, 0.15)),
        math.log(max(v.get("hook_seconds") or 2.0, 0.15)) * 0.6,
        (beat if beat is not None else 0.5) * 2.0,
        float(look.get("brightness", 0.5)) * 1.5,
        float(look.get("saturation", 0.4)) * 1.5,
        {"rising": 0.5, "peak_in_middle": 0.25, "steady": 0.0, "falling": -0.5}.get(v.get("energy_curve", "steady"), 0.0),
    ]


def _kmeans(x: np.ndarray, k: int, seed: int = 7, iters: int = 60) -> tuple[np.ndarray, np.ndarray]:
    """Plain k-means with k-means++ starts (deterministic for a seed)."""
    rng = np.random.default_rng(seed)
    centers = [x[rng.integers(len(x))]]
    for _ in range(1, k):
        d = np.min([((x - c) ** 2).sum(1) for c in centers], axis=0)
        centers.append(x[rng.choice(len(x), p=d / d.sum())] if d.sum() > 0 else x[rng.integers(len(x))])
    c = np.array(centers)
    labels = np.zeros(len(x), int)
    for _ in range(iters):
        labels = np.argmin(((x[:, None, :] - c[None]) ** 2).sum(2), axis=1)
        new = np.array([x[labels == j].mean(0) if (labels == j).any() else c[j] for j in range(k)])
        if np.allclose(new, c):
            break
        c = new
    return labels, c


def _silhouette(x: np.ndarray, labels: np.ndarray) -> float:
    d = np.sqrt(((x[:, None, :] - x[None]) ** 2).sum(2))
    scores = []
    for i in range(len(x)):
        same = labels == labels[i]
        if same.sum() <= 1:
            scores.append(0.0)
            continue
        a = d[i, same].sum() / (same.sum() - 1)
        b = min((d[i, labels == j].mean() for j in set(labels.tolist()) if j != labels[i]), default=0.0)
        scores.append((b - a) / max(a, b, 1e-9))
    return float(np.mean(scores))


def group_videos(videos: list[dict[str, Any]]) -> list[list[int]]:
    """Indices of the videos in each editing style, biggest style first. Few videos (or one clear style) = one group."""
    n = len(videos)
    if n < 2 * MIN_PER_GROUP:
        return [list(range(n))] if n else []
    # the features are already on comparable, meaningful scales: no per-feature rescaling (it would blow tiny random
    # differences between Reels of one style up into fake "styles")
    x = np.array([features(v) for v in videos], float)
    best: tuple[float, np.ndarray] | None = None
    for k in range(2, min(MAX_GROUPS, n // MIN_PER_GROUP) + 1):
        labels, centers = _kmeans(x, k)
        sizes = np.bincount(labels, minlength=k)
        if sizes.min() < MIN_PER_GROUP:
            continue
        gaps = [np.sqrt(((centers[i] - centers[j]) ** 2).sum()) for i in range(k) for j in range(i + 1, k)]
        if min(gaps) < MIN_STYLE_GAP:
            continue  # two of the groups are really the same style
        s = _silhouette(x, labels)
        if best is None or s > best[0]:
            best = (s, labels)
    if best is None or best[0] < 0.25:  # no clear separation: it is really one style
        return [list(range(n))]
    labels = best[1]
    groups = [np.flatnonzero(labels == j).tolist() for j in sorted(set(labels.tolist()))]
    return sorted(groups, key=len, reverse=True)


def name_for(profile: dict[str, Any]) -> str:
    """A plain-language name from the numbers, e.g. "Fast · beat-synced · vivid"."""
    shot = profile.get("median_shot") or profile.get("avg_shot") or 2.0
    parts = ["Very fast" if shot <= 0.6 else "Fast" if shot <= 1.2 else "Balanced" if shot <= 2.4 else "Slow cinematic"]
    beat = profile.get("on_beat_share")
    if beat is not None:
        parts.append("beat-synced" if beat >= 0.65 else "free rhythm" if beat < 0.35 else "")
    if (profile.get("hook_seconds") or 9) <= 1.0:
        parts.append("quick hook")
    look = profile.get("look") or {}
    if look.get("saturation", 0.4) >= 0.5:
        parts.append("vivid")
    elif look.get("brightness", 0.5) <= 0.35:
        parts.append("moody")
    elif look.get("brightness", 0.5) >= 0.62:
        parts.append("bright")
    return " · ".join(p for p in parts if p)


# ---------------------------------------------------------------------- applying a trend
def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def apply_trend(style: EditingStyle, trend: dict[str, Any], bpm: float | None) -> tuple[EditingStyle, str]:
    """The editing rules for this song, shaped like the learned trend (see the module docstring). ``trend``: the compact
    form (trends.reference.for_ai)."""
    base = trend.get("median_shot") or trend.get("avg_shot")
    if not base:
        return style, ""
    loud = trend.get("loud_avg_shot") or base * 0.85
    calm = trend.get("calm_avg_shot") or base * 1.3
    period = 60.0 / bpm if bpm and 50 <= bpm <= 220 else 0.5
    high = int(_clamp(round(loud / period), 1, 8))
    low = int(_clamp(round(calm / period), high, 12))
    min_seg = round(_clamp(base * 0.45, 0.25, 2.0), 2)
    max_seg = round(_clamp(max(calm * 1.8, base * 2.2), min_seg + 0.6, 8.0), 2)
    over: dict[str, Any] = {"cut_beats_high": high, "cut_beats_low": low, "min_segment": min_seg, "max_segment": max_seg,
                            "section_pacing": False}  # the trend's loud / calm numbers already say how it cuts in each part
    beat = trend.get("on_beat_share")
    if beat is not None:
        over["accent_hits"] = beat >= 0.6
    tr = (trend.get("traits") or {}).get("transition_style")
    if tr == "mostly_hard_cut":
        over["max_transition_ratio"] = min(style.max_transition_ratio, 0.12)
    elif tr == "transition_heavy":
        over["max_transition_ratio"] = max(style.max_transition_ratio, 0.5)
    if (trend.get("hook_seconds") or 9) <= 1.2:
        over["hook_priority"] = max(style.hook_priority, 0.6)
    look = trend.get("look") or {}
    if look:
        sat = round(1 + _clamp((float(look.get("saturation", 0.4)) - 0.4) * 0.8, -0.15, 0.25), 2)
        bri = round(_clamp((float(look.get("brightness", 0.5)) - 0.5) * 0.15, -0.05, 0.05), 3)
        if abs(sat - 1) >= 0.03 or abs(bri) >= 0.01:
            eq = f"eq=saturation={sat}:brightness={bri}"
            over["grade_filter"] = f"{style.grade_filter},{eq}" if style.grade_filter else eq
    note = (f"Edited like your learned style '{trend.get('name', 'trend')}': about {loud:.1f} s per shot in loud parts ({high} beat"
            f"{'s' if high > 1 else ''}) and {calm:.1f} s in calm parts ({low} beats) at this song's {round(bpm or 120)} BPM"
            + (f", {round(beat * 100)}% of cuts on the beat" if beat is not None else "") + ".")  # fmt: skip
    return style.with_overrides(**over), note


_WORD = re.compile(r"[a-zऀ-ॿ]{3,}")


def best_match(trends: list[dict[str, Any]], text: str, bpm: float | None, duration: float) -> dict[str, Any] | None:
    """For "auto": the learned style that fits this Reel best. Words the user wrote that appear in a style's name or
    notes count most; then the song's tempo against the tempo of the style's Reels, and the length."""
    if not trends:
        return None
    words = set(_WORD.findall((text or "").lower()))

    def score(t: dict[str, Any]) -> float:
        own = set(_WORD.findall(f"{t.get('name', '')} {t.get('notes', '')}".lower()))
        s = 2.0 * len(words & own)
        if bpm and t.get("bpm"):
            ratio = max(bpm, t["bpm"]) / min(bpm, t["bpm"])
            ratio = min(ratio, abs(ratio - 2) + 1)  # half / double time feels the same
            s += max(0.0, 1.5 - (ratio - 1) * 4)
        if t.get("seconds_per_video"):
            s += max(0.0, 0.5 - abs(math.log(max(duration, 1) / t["seconds_per_video"])) * 0.4)
        s += min(math.log1p(t.get("videos") or 1) * 0.15, 0.5)  # a style learned from more Reels is steadier
        return s

    best = max(trends, key=score)
    # only a style that really fits: a fast food-Reel rhythm is not forced onto a slow wedding song
    return best if score(best) >= MIN_MATCH else None
