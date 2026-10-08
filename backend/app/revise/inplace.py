"""Change the style or the pace of a finished Reel *in place*: the Director edits its blueprint instead of starting over.

* restyle: every shot, its footage and its cut point are kept; effects, transitions and the look are chosen again for
  the new style (the same rules the editor uses for a fresh edit, driven by the music under each shot).
* faster: long shots are split on their strongest beat; the footage carries on, nothing repeats.
* calmer: a short shot is merged into the one before it, which simply plays on (only where that clip has the footage).

Manual edits, the voice-over, captions and on-screen text all stay. One undoable step; the old version stays in Versions.
"""

from __future__ import annotations

import random

from app.director.music_map import MusicMap
from app.models.timeline import Timeline, Transition
from app.styles import get_style
from app.video.timeline import Slot, assign_effects, assign_transitions

ENERGY_VALUE = {"low": 0.25, "medium": 0.5, "high": 0.75, "very_high": 0.95}
FAST_SHOT = 1.6  # a faster Reel splits shots longer than this (seconds)
CALM_SHOT = 4.5  # a calmer Reel merges neighbours up to this length


def _slots(tl: Timeline, mm: MusicMap | None) -> list[Slot]:
    out = []
    for i, s in enumerate(tl.segments):
        e = ENERGY_VALUE.get(mm.energy_at(s.timeline_start), 0.5) if mm else 0.5
        out.append(Slot(i, s.timeline_start, s.timeline_end, e, on_strong=bool(mm and mm.level_at(s.timeline_start) >= 3)))
    return out


def restyle(tl: Timeline, style_id: str, mm: MusicMap | None, seed: int = 0) -> list[str]:
    style = get_style(style_id)
    rng = random.Random(seed)
    slots = _slots(tl, mm)
    kept = {s.id: (s.effect, s.transition_in.model_copy()) for s in tl.segments if s.locked}  # shots the person set by hand
    assign_effects(tl.segments, slots, style, rng)
    assign_transitions(tl.segments, slots, style, rng)
    tl.style, tl.color_grade = style.id, None  # the new style's own colour grade
    for s in tl.segments:
        if s.id in kept:
            s.effect, s.transition_in = kept[s.id]
            continue
        s.reason = (s.reason or f"{s.video}:").split(" Restyled")[0] + f" Restyled as {style.name}: same shot, new effect and transition."
    return [f"Restyled as {style.name}: the same {len(tl.segments)} shots and cuts, with its effects, transitions and colour grade."]


def _split(tl: Timeline, mm: MusicMap | None, longest: float) -> int:
    n = 0
    i = 0
    while i < len(tl.segments):
        s = tl.segments[i]
        if s.length > longest and not s.locked:
            inner = [b.t for b in (mm.beats if mm else []) if s.timeline_start + 0.5 < b.t < s.timeline_end - 0.5]
            mid = (s.timeline_start + s.timeline_end) / 2
            cut = max(inner, key=lambda b: (mm.level_at(b), -abs(b - mid))) if inner else round(mid, 3)
            second = s.model_copy(deep=True)
            second.id = f"{s.id[:9]}s{n:02d}"
            second.timeline_start = round(cut, 3)
            second.source_start = round(s.source_start + (cut - s.timeline_start) * s.speed, 3)
            second.transition_in = Transition(type="cut", duration=0.0)
            second.effect = "punch" if s.effect in ("none", "zoom_in", "zoom_out") else s.effect
            second.reason = f"{s.video}: Split on the beat for a faster pace; the footage carries on, nothing repeats."
            s.timeline_end = second.timeline_start
            s.source_end = second.source_start
            tl.segments.insert(i + 1, second)
            n += 1
            continue  # the first half may still be long
        i += 1
    return n


def _merge(tl: Timeline, clip_lengths: dict[str, float], longest: float) -> int:
    n = 0
    i = 1
    while i < len(tl.segments):
        a, b = tl.segments[i - 1], tl.segments[i]
        total = a.length + b.length
        room = clip_lengths.get(a.clip_id, 0.0)
        need_end = a.source_start + total * a.speed
        if total <= longest and need_end <= room + 1e-6 and len(tl.segments) > 2 and not (a.locked or b.locked):
            a.timeline_end = b.timeline_end
            a.source_end = round(need_end, 3)
            a.reason = f"{a.video}: Plays on for a calmer pace (fewer cuts)."
            tl.segments.pop(i)
            n += 1
            i += 1  # leave the next pair alone so the rhythm does not collapse into one long shot
        else:
            i += 1
    return n


def repace(tl: Timeline, pace: str, mm: MusicMap | None, clip_lengths: dict[str, float]) -> list[str]:
    before = len(tl.segments)
    if pace == "fast":
        k = _split(tl, mm, FAST_SHOT)
        return [f"Faster: {k} long shot(s) split on the beat ({before} -> {len(tl.segments)} shots), same footage, nothing repeated."] if k else \
            ["Already fast: no shot was long enough to split."]  # fmt: skip
    if pace == "calm":
        k = _merge(tl, clip_lengths, CALM_SHOT)
        return [f"Calmer: {k} cut(s) removed ({before} -> {len(tl.segments)} shots); those shots play on instead."] if k else \
            ["Could not calm it further without repeating footage; try a calmer style instead."]  # fmt: skip
    return []


def apply_style_pace(tl: Timeline, *, style: str | None, pace: str | None, mm: MusicMap | None,
                     clip_lengths: dict[str, float]) -> tuple[Timeline, list[str]]:  # fmt: skip
    """A copy of the timeline with the new style and/or pace (style first, so a faster pace gets the new style's punch)."""
    out = tl.model_copy(deep=True)
    notes: list[str] = []
    if style:
        notes += restyle(out, style, mm)
    if pace in ("fast", "calm"):
        notes += repace(out, pace, mm, clip_lengths)
    return out, notes
