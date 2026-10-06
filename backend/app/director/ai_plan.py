"""The safety layer between the AI director and the Timeline.

``plan_to_timeline`` turns a ``ReelDirectorPlan`` (a proposal) into a valid EDL, deterministically:

* only known clip aliases, only usable clips; source windows clamped into the clip (and moved into a usable window when
  the proposed moment is outside all of them);
* no negative or reversed times; every shot 0.4-6 s; durations rescaled so the Reel is exactly the requested length;
* every interior cut snapped onto a beat / strong hit / drop near the proposed time;
* speed clamped to 0.5-2x (and lowered if the clip is too short for the shot);
* effects and transitions mapped onto the registries (closest supported one), transitions shortened to fit both
  neighbouring shots, never the same transition twice in a row;
* crop / focus values validated; grade and style checked against the catalogues;
* overlays trimmed to the word limit, kept inside the Reel, never stacked.

One bad instruction is repaired or dropped and reported; it never crashes the render. A plan too broken to repair raises
``DirectorPlanRejected`` and the caller builds the Reel with the rule-based editor instead.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field

from app.ai import prompts
from app.ai.reel_director import PURPOSES, ReelDirectorPlan
from app.core.errors import AppError
from app.director.music_map import PACE_SCALE, MusicMap, loud_limit
from app.models.analysis import UsableWindow
from app.models.timeline import OVERLAY_ANIMATIONS, OVERLAY_POSITIONS, OVERLAY_ROLES, CropSpec, Segment, TextOverlay, Timeline, Transition
from app.styles.base import EditingStyle
from app.video import effects as fx
from app.video import footage, grades
from app.video.overlays import normalize, tidy_text
from app.video.timeline import ClipInput

MIN_SHOT = 0.4
MIN_SPLIT = 0.6  # a shot split to follow a loud part keeps at least this much on each side of the new cut
MAX_SHOT = 6.0
SPEED_MIN, SPEED_MAX = 0.5, 2.0
SNAP_TOL = 0.3  # a proposed cut moves onto a beat this close to it
SPEED_FIT = 0.92  # a shot a few frames short of footage for an on-beat cut plays at >= this speed (invisible) instead
EDGE = 0.08  # seconds: rounding slack at the edge of a good part
BEAT_REACH = 1.2  # when no beat is that close (the shot lengths must still fit), the nearest beat up to this far away
MAX_SCALE = 2.2  # durations further than this from the requested length mean the plan did not understand the Reel
SLIDE = 1.0  # seconds: a shot that runs past the end of its good part may start this much earlier than the AI asked
FILL_MIN = 1.0  # seconds: the shortest piece of unused footage worth adding as a shot
FILL_MARGIN = 0.5  # seconds of spare footage kept so the cuts can still move onto the beat
_TAG = re.compile(r"[^0-9A-Za-z_]")


class DirectorPlanRejected(AppError):
    status_code = 422
    code = "AI_DIRECTOR_PLAN_REJECTED"


@dataclass
class DirectedReel:
    timeline: Timeline
    fixes: list[str] = field(default_factory=list)  # what the safety layer repaired (shown as notes)
    post_copy: dict | None = None
    purposes: list[str] = field(default_factory=list)
    log: list[dict] = field(default_factory=list)  # per shot: what the AI asked for, what was used, and why anything changed
    problems: list[str] = field(default_factory=list)  # plan-level problems for the AI's revision round (with concrete hints)
    pace: str = "balanced"  # the pace the Reel was cut at (the user's, else the one the AI chose)
    ai_log: dict | None = None  # the whole record (provider, idea, shots, texts), filled in by the pipeline


def _alias(raw: str, alias: dict[str, str]) -> str | None:
    key = str(raw or "").strip().lower()
    if key in alias:
        return alias[key]
    m = re.search(r"c\s*(\d+)", key) or re.fullmatch(r"(\d+)", key)
    return alias.get(f"c{m.group(1)}") if m else None


def _snap(t: float, points: list[float], lo: float, hi: float) -> float:
    """Nearest snap point within SNAP_TOL that keeps the shot bounds [lo, hi]; else t."""
    best, err = t, SNAP_TOL + 1e-9
    for p in points:
        if lo <= p <= hi and abs(p - t) < err:
            best, err = p, abs(p - t)
    return best


def _window_for(t: float, windows: list[UsableWindow]) -> UsableWindow | None:
    for w in windows:
        if w.start - 1e-6 <= t <= w.end + 1e-6:
            return w
    return None


def _good_windows(clip: ClipInput) -> list[UsableWindow]:
    """The clip's good parts. The analyzer cuts long continuous shots into pieces of at most 6 s; touching pieces of the
    same continuous shot are joined again here, so a shot may run across the seam instead of being told the footage is
    too short."""
    return [w for w in footage.joined(clip.analysis.windows, EDGE) if w.end - w.start > 0.2]


def _pick_footage(
    clip: ClipInput, asked: float, length: float, speed: float, used: dict[str, list[tuple[float, float]]],
    clips: list[ClipInput], uses: dict[str, int],
) -> tuple[ClipInput, float, float, float, list[str]]:
    """(clip, source start, source end, speed, what changed). Only good parts (usable windows), never a moment already
    shown. Order: the moment the AI asked for -> another fresh good part of the same clip -> a fresh good part of another
    clip (least used first) -> an unused part stretched with slow motion -> a slow-motion replay (the one allowed repeat,
    and the only case the AI itself may ask for by choosing slow motion)."""
    why: list[str] = []
    need = length * speed
    asked = asked if asked == asked else 0.0  # NaN-safe
    windows = _good_windows(clip)
    if not windows:  # no quality windows at all: the whole clip is the only choice
        dur = clip.analysis.metadata.duration
        s0 = min(max(asked, 0.0), max(dur - need, 0.0))
        return clip, round(s0, 3), round(min(s0 + need, dur), 3), speed, why

    inside = next((w for w in windows if w.start - EDGE <= asked and asked + need <= w.end + EDGE), None)
    if inside is None:  # the AI ran a little past the end of a good part (often the clip's end): start earlier, keep its length
        w = next((w for w in windows if w.start - EDGE <= asked <= w.end), None)
        if w is not None and w.end - w.start >= need - 1e-6 and asked + need - w.end <= SLIDE + EDGE:
            asked, inside = max(w.end - need, w.start), w
    if inside is not None:  # keep the moment; stay inside the good part (a rounding overshoot is trimmed off the start)
        asked = min(max(asked, inside.start), max(inside.end - need, inside.start))
    fresh = footage.is_fresh(asked, asked + need, used[clip.clip_id])
    if inside is not None and (fresh or speed <= 0.75):  # as asked (a slowed-down repeat is a deliberate replay)
        if not fresh:
            why.append("slow-motion replay of a moment already shown (asked by the AI)")
        return clip, round(asked, 3), round(asked + need, 3), speed, why

    spot = footage.place(windows, need, used[clip.clip_id], near=asked)
    if spot is not None:
        a, b, _ = spot
        if abs(a - asked) >= EDGE:  # a move of a few milliseconds is not worth reporting
            why.append(f"moment {asked:.1f}s -> {a:.1f}s ({'already shown' if inside is not None else 'not a good part of the clip'})")
        return clip, round(a, 3), round(b, 3), speed, why

    others = sorted((c for c in clips if c.clip_id != clip.clip_id and c.analysis.usable),
                    key=lambda c: (uses.get(c.clip_id, 0), -c.analysis.quality_score))  # fmt: skip
    for other in others:
        spot = footage.place(_good_windows(other), need, used[other.clip_id])
        if spot is not None:
            a, b, _ = spot
            if used[clip.clip_id]:
                reason = f"{clip.name} has no unused good footage left"
            else:
                longest = max(w.end - w.start for w in windows)
                reason = f"the good parts of {clip.name} are shorter ({longest:.1f}s) than this {need:.1f}s shot"
            why.append(f"{reason} -> {other.name} {a:.1f}-{b:.1f}s")
            return other, round(a, 3), round(b, 3), speed, why

    stretch = [(c, f) for c in [clip, *others] if (f := footage.longest_free(_good_windows(c), used[c.clip_id])) is not None
               and f[1] - f[0] >= length * footage.MIN_SLOW - 1e-6]  # fmt: skip
    if stretch:
        c, (a, b, _) = max(stretch, key=lambda cf: cf[1][1] - cf[1][0])
        new_speed = round(max((b - a) / length, footage.MIN_SLOW), 3)
        why.append(f"no unused footage long enough: {c.name} {a:.1f}s plays at {new_speed:g}x so nothing repeats")
        return c, round(a, 3), round(a + length * new_speed, 3), new_speed, why

    replay = footage.REPLAY_SPEED
    spot = footage.place(windows, length * replay, [], near=asked) or footage.place(windows, min(length * replay, max(w.end - w.start for w in windows)), [])
    a, b, _ = spot if spot is not None else (windows[0].start, windows[0].end, windows[0])
    why.append("every good moment is already used: shown again as a slow-motion replay")
    return clip, round(a, 3), round(min(b, a + length * replay), 3), round((min(b, a + length * replay) - a) / length, 3), why


def _asked_from(s) -> float:
    return min(float(s.source_start or 0.0), float(s.source_end or 0.0))


def _speed(s) -> float:
    return min(max(float(s.speed) if s.speed == s.speed else 1.0, SPEED_MIN), SPEED_MAX)


def _caps(shots: list) -> list[float]:
    """The longest each shot can be at its speed and still fit inside one good part of its clip, without running into
    the moment another shot of the same clip starts at."""
    starts: dict[str, list[float]] = {}
    for s, clip, _ in shots:
        starts.setdefault(clip.clip_id, []).append(_asked_from(s))
    out = []
    for s, clip, _ in shots:
        windows = _good_windows(clip)
        asked = _asked_from(s)
        at = next((w for w in windows if w.start - EDGE <= asked < w.end), None)
        if at is not None:  # up to SLIDE earlier than asked is still the AI's moment (see ``_pick_footage``)
            end = min([at.end, *(t for t in starts[clip.clip_id] if asked + EDGE < t < at.end)])
            room = end - max(asked - SLIDE, at.start)
        else:
            room = max((w.end - w.start for w in windows), default=clip.analysis.metadata.duration)
        out.append(min(room / _speed(s), MAX_SHOT))
    return out


def _alias_of(alias: dict[str, str]) -> dict[str, str]:
    return {cid: a for a, cid in alias.items() if re.fullmatch(r"c\d+", a)}


def _unused_footage(shots: list, clips: list[ClipInput]) -> list[tuple[ClipInput, float, float]]:
    """Good footage no shot of the plan can reach (each shot claims from its moment up to its cap): clips the plan uses
    least first, then the longest pieces."""
    claimed: dict[str, list[tuple[float, float]]] = {c.clip_id: [] for c in clips}
    uses: dict[str, int] = {}
    for (s, clip, _), cap in zip(shots, _caps(shots)):
        a = _asked_from(s)
        claimed.setdefault(clip.clip_id, []).append((a - SLIDE, a + cap * _speed(s)))
        uses[clip.clip_id] = uses.get(clip.clip_id, 0) + 1
    spans = [(c, a, b) for c in clips if c.analysis.usable for a, b, _ in footage.free_spans(_good_windows(c), claimed[c.clip_id])
             if b - a >= FILL_MIN]  # fmt: skip
    return sorted(spans, key=lambda x: (uses.get(x[0].clip_id, 0), -(x[2] - x[1]), -x[0].analysis.quality_score))


def _fill_shortfall(shots: list, duration: float, clips: list[ClipInput], alias: dict[str, str]) -> tuple[list, list, list[str]]:
    """When the plan's shots cannot fill the Reel with their own good footage (they would be stretched past it, slowed
    down or repeated), add shots from footage nothing uses yet, spread through the middle of the Reel (the hook stays
    first, the ending stays last). Returns (shots, the added shots, hints for the AI's revision round)."""
    names = _alias_of(alias)
    have = sum(_caps(shots))
    if have >= duration + FILL_MARGIN:
        return shots, [], []
    hints = [f"the shots can only fill {have:.1f}s of the {duration:g}s Reel with their own good footage (no stretching, "
             f"no slow motion): add more shots"]  # fmt: skip
    free = _unused_footage(shots, clips)
    if free:
        hints.append("unused good footage: " + ", ".join(f"{names.get(c.clip_id, c.name)} {a:.1f}-{b:.1f}s" for c, a, b in free[:10]))
    typical = sorted(d for *_, d in shots)[len(shots) // 2]
    target = min(max(typical, FILL_MIN), 3.5)
    tmpl = shots[len(shots) // 2][0]
    added: list = []
    while have < duration + FILL_MARGIN and (free := _unused_footage(shots + added, clips)):
        clip, a, b = free[0]
        d = min(b - a, target, MAX_SHOT)
        s = tmpl.model_copy(update={
            "clip": names.get(clip.clip_id, clip.clip_id), "source_start": round(a, 3), "source_end": round(a + d, 3), "duration": round(d, 3),
            "purpose": "detail", "effect": "none", "transition": "cut", "speed": 1.0, "beat_alignment": "strong",
        })  # fmt: skip
        added.append((s, clip, d))
        have = sum(_caps(shots + added))
    # spread the added shots through the middle, not next to a shot of the same clip when that can be avoided
    out = list(shots)
    for i, new in enumerate(added):
        pos = max(1, min(len(out) - 1, round((i + 1) * len(out) / (len(added) + 1))))
        for p in sorted(range(1, len(out)), key=lambda p: abs(p - pos)):
            if out[p - 1][1].clip_id != new[1].clip_id and out[p][1].clip_id != new[1].clip_id:
                pos = p
                break
        out.insert(pos, new)
    return out, added, hints


def _fit_lengths(shots: list, duration: float) -> list[float]:
    """Shot lengths that add up to ``duration``. Shortening is even (a shorter shot always still fits its footage). Extra
    time goes first to shots whose clip has spare good footage beyond what the AI asked for, so a shot the AI sized to a
    short good part keeps fitting it; only what no clip can absorb is spread evenly."""
    caps = _caps(shots)
    # a shot longer than its clip's good footage is first trimmed to fit it (the AI's choice of clip is kept)
    asked = [min(d, c) if c >= MIN_SHOT else d for (*_, d), c in zip(shots, caps)]
    total = sum(asked)
    if total >= duration - 1e-6:
        return [d * duration / total for d in asked]
    extra = duration - total
    slack = [max(c - d, 0.0) for c, d in zip(caps, asked)]
    room = sum(slack)
    if room >= extra:
        return [d + extra * sl / room for d, sl in zip(asked, slack)]
    # the project has less good footage than the Reel (``_fill_shortfall`` already added every unused piece): each shot
    # takes all of its footage and the rest is shared out (those shots are slowed down a little, and reported)
    grown = [d + sl for d, sl in zip(asked, slack)]
    return [g * duration / sum(grown) for g in grown]


def plan_to_timeline(
    plan: ReelDirectorPlan, alias: dict[str, str], clips: list[ClipInput], mm: MusicMap, audio_start: float, duration: float,
    style: EditingStyle, *, style_ids: set[str], keep_style: bool, seed: int = 0, hook_text: str = "", cta_text: str = "",
    pace: str = "auto",
) -> DirectedReel:
    by_id = {c.clip_id: c for c in clips}
    fixes: list[str] = []
    mapped_fx: set[str] = set()
    mapped_tr: set[str] = set()

    # ---- 1. shots: known, usable clips only; sane durations
    shots = []
    for i, s in enumerate(plan.shots[:120]):
        cid = _alias(s.clip, alias)
        clip = by_id.get(cid or "")
        if clip is None or not clip.analysis.usable:
            fixes.append(f"Shot {i + 1} used an unknown or unusable clip ('{prompts.clean(s.clip, 12)}'); it was dropped.")
            continue
        d = s.duration if s.duration == s.duration and s.duration > 0 else (s.source_end - s.source_start) / max(s.speed or 1.0, 0.1)
        shots.append((s, clip, min(max(float(d), MIN_SHOT), MAX_SHOT)))
    if not shots:
        raise DirectorPlanRejected("The AI plan had no usable shots.")

    # ---- 2. exact length: rescale, then snap every interior cut onto the music
    total = sum(d for *_, d in shots)
    scale = duration / total
    if not (1 / MAX_SCALE <= scale <= MAX_SCALE):
        raise DirectorPlanRejected(f"The AI plan lasted {total:.1f}s for a {duration:.1f}s Reel.")
    ai_count = len(shots)
    shots, added, problems = _fill_shortfall(shots, duration, clips, alias)
    added_ids = {id(s) for s, *_ in added}
    if added:
        fixes.append(f"The AI's shots could not fill the {duration:g}s Reel with their own good footage, so {len(added)} shot(s) of "
                     "unused footage were added: " + ", ".join(f"{c.name} {s.source_start:.1f}-{s.source_end:.1f}s" for s, c, _ in added[:6])
                     + ".")  # fmt: skip
    if sum(_caps(shots)) < duration - 1e-6:
        fixes.append("The project has less good footage than this Reel length: some shots play slightly slowed down.")
    lengths = _fit_lengths(shots, duration)
    trimmed = {id(s): c for (s, _, d), c in zip(shots, _caps(shots)) if MIN_SHOT <= c <= d - 0.1}
    if abs(scale - 1) > 0.03:
        how = "the extra time went to shots whose clips have spare good footage" if scale > 1 else "every shot was shortened evenly"
        fixes.append(f"Shot lengths were scaled by {scale:.2f} so the Reel is exactly {duration:g}s ({how}).")
    if max(lengths) > MAX_SHOT * 1.25:
        raise DirectorPlanRejected("The AI plan had too few shots for this Reel length.")
    points_all = sorted(set(mm.snap_points) | set(mm.drops))
    points_strong = sorted({b.t for b in mm.beats if b.level >= 3} | {t for t, st in mm.accents if st >= 0.6} | set(mm.drops))
    caps = _caps(shots)
    rest = [sum(caps[k:]) for k in range(len(caps) + 1)]  # footage the shots from k on can still hold
    bounds = [0.0]
    fitted = [0.0]  # each cut after the length fit, before the beat snap (so the timing note shows only the snap itself)
    t = 0.0
    snapped = 0
    for k, length in enumerate(lengths[:-1]):
        t += length
        fitted.append(t)
        s = shots[k + 1][0]
        lo, hi = bounds[-1] + MIN_SHOT, duration - MIN_SHOT * (len(lengths) - k - 1)
        lo_soft = min(max(lo, duration - rest[k + 1] / SPEED_FIT), hi)  # later shots may play a touch slower for a beat
        lo = min(max(lo, duration - rest[k + 1]), hi)  # never leave the later shots more time than their footage holds
        capped = min(hi, bounds[-1] + caps[k]) if bounds[-1] + caps[k] >= lo else hi
        if any(lo <= p_ <= capped and abs(p_ - t) <= BEAT_REACH for p_ in points_all):
            hi = capped  # a beat exists within the clip's good footage: never snap past it
        pts = points_strong if s.beat_alignment == "strong" and points_strong else points_all
        cut = _snap(t, pts, lo, hi) if s.beat_alignment != "free" else t
        if cut == t and pts is points_strong:
            cut = _snap(t, points_all, lo, hi)
        cut = min(max(cut, lo), hi)
        if cut not in points_all:  # nothing close enough: the nearest beat that still fits beats an off-beat cut
            in_range = [p for p in points_all if lo <= p <= hi and abs(p - t) <= BEAT_REACH]
            if in_range:
                cut = min(in_range, key=lambda p: abs(p - t))
        if cut not in points_all:  # still off the beat: a beat slightly earlier, if the later shots can stretch invisibly
            in_range = [p for p in points_all if lo_soft <= p < lo and abs(p - t) <= BEAT_REACH]
            if in_range:
                cut = max(in_range)
        snapped += cut != t
        bounds.append(round(cut, 3))
        # the next cut is measured from where the plan put it, not from this snapped cut: small snaps never add up
    bounds.append(round(duration, 3))
    if lo_bad := [k for k in range(len(bounds) - 1) if bounds[k + 1] - bounds[k] < MIN_SHOT - 1e-6]:
        raise DirectorPlanRejected(f"The AI plan could not be fitted to the music ({len(lo_bad)} shots too short).")

    # ---- 2b. the cuts follow the song's energy: a shot far too long for a loud part is split on a beat, the second half
    # with unused footage; with no footage left it reacts to every hit instead (beat_punch)
    cut_pace = pace if pace in PACE_SCALE else (plan.pace if plan.pace in PACE_SCALE else "balanced")
    split_ids: dict[int, str] = {}
    forced_fx: dict[int, str] = {}
    names = _alias_of(alias)
    k = len(shots) - 1
    while k >= 0:
        a, b = bounds[k], bounds[k + 1]
        lim = loud_limit(mm, a, b, cut_pace)
        if lim is None or b - a <= lim[1] * 1.15:
            k -= 1
            continue
        level = lim[0].replace("_", " ")
        if not any(p.startswith(f"shot {k + 1} lasted") for p in problems):
            problems.append(f"shot {k + 1} lasted {b - a:.1f}s in a {level} part of the song ({a:.1f}-{b:.1f}s): cut faster "
                            f"there (at most {lim[1]:.1f}s per shot at a {cut_pace} pace)")  # fmt: skip
        cands = [p for p in points_all if a + MIN_SPLIT <= p <= b - MIN_SPLIT]
        cut = min(cands, key=lambda p: abs(p - (a + min(lim[1], (b - a) / 2)))) if cands else None
        near = {shots[k][1].clip_id, *([shots[k + 1][1].clip_id] if k + 1 < len(shots) else [])}
        piece = next(((c, x, y) for c, x, y in _unused_footage(shots, clips) if c.clip_id not in near and y - x >= b - (cut or b) - 1e-6),
                     None) if cut is not None else None  # fmt: skip
        if piece is None:
            s0 = shots[k][0]
            if fx.resolve_effect(s0.effect)[0] in ("none", "zoom_in", "zoom_out", "ken_burns") and id(s0) not in forced_fx:
                forced_fx[id(s0)] = f"the music is {level} here and no unused footage was left for another cut: the shot pulses on every hit (beat_punch)"
            k -= 1
            continue
        c, x, _ = piece
        need = round(b - cut, 3)
        new = shots[k][0].model_copy(update={
            "clip": names.get(c.clip_id, c.clip_id), "source_start": round(x, 3), "source_end": round(x + need, 3), "duration": need,
            "effect": "beat_punch" if need >= 1.5 else "none", "transition": "cut", "speed": 1.0, "beat_alignment": "strong",
        })  # fmt: skip
        shots.insert(k + 1, (new, c, need))
        bounds.insert(k + 1, round(cut, 3))
        fitted.insert(k + 1, cut)
        caps.insert(k + 1, need)
        split_ids[id(new)] = f"the music is {level} at {cut:.1f}s, so the {b - a:.1f}s shot before was cut here"
        fixes.append(f"Shot {k + 1} was {b - a:.1f}s long in a {level} part of the song: cut on the beat at {cut:.1f}s with {c.name}.")
        k += 1  # check the new shot, then shot k again (either may still need another cut)

    asked_starts = [0.0]  # where the AI wanted each cut, before scaling and beat-snapping
    for *_, d in shots[:-1]:
        asked_starts.append(asked_starts[-1] + d)

    # ---- 3. segments
    rng = random.Random(seed)
    log: list[dict] = []
    used: dict[str, list[tuple[float, float]]] = {c.clip_id: [] for c in clips}  # moments already shown, per clip
    uses: dict[str, int] = {}
    segments: list[Segment] = []
    purposes: list[str] = []
    prev_tr = "cut"
    for k, (s, clip, _) in enumerate(shots):
        start, end = bounds[k], bounds[k + 1]
        length = end - start
        why: list[str] = []
        if id(s) in added_ids:
            why.append(f"shot added by the safety check from unused footage (the AI's {ai_count} shots could not fill the Reel)")
        if id(s) in split_ids:
            why.append(f"shot added on the beat: {split_ids[id(s)]}")
        if id(s) in forced_fx:
            why.append(forced_fx[id(s)])
        if id(s) in trimmed:
            why.append(f"shot shortened to fit the {trimmed[id(s)]:.1f}s of good footage in {clip.name} (asked {float(s.duration):.1f}s)")
        speed = min(max(float(s.speed) if s.speed == s.speed else 1.0, SPEED_MIN), SPEED_MAX)
        if speed != s.speed:
            why.append(f"speed {s.speed:g}x -> {speed:g}x (allowed {SPEED_MIN}-{SPEED_MAX}x)")
            fixes.append(f"Shot {k + 1}: speed {s.speed:g}x is outside {SPEED_MIN}-{SPEED_MAX}x; used {speed:g}x.")
        speed_note = None
        if caps[k] + 1e-3 < length <= caps[k] / SPEED_FIT:  # a few frames short for the on-beat cut: an invisible speed fit
            speed = round(speed * caps[k] / length, 3)
            speed_note = f"plays at {speed:g}x so the cut lands on the beat"
        clip_dur = clip.analysis.metadata.duration
        if length * speed > clip_dur + 1e-3 and round(clip_dur / length, 3) < speed:  # the clip is too short for the shot at this speed: slow it down (as the rules do)
            speed = max(SPEED_MIN, round(clip_dur / length, 3))
            fixes.append(f"Shot {k + 1}: {clip.name} is short, so it plays at {speed:g}x to fill {length:.1f}s.")
            why.append(f"clip too short: plays at {speed:g}x")
        asked_from = min(float(s.source_start or 0.0), float(s.source_end or 0.0))
        clip, src_start, src_end, speed, moved = _pick_footage(clip, asked_from, length, speed, used, clips, uses)
        why += moved
        fixes += [f"Shot {k + 1}: {m}" for m in moved]
        used[clip.clip_id].append((src_start, src_end))
        uses[clip.clip_id] = uses.get(clip.clip_id, 0) + 1
        effect, m = fx.resolve_effect("beat_punch" if id(s) in forced_fx else s.effect)
        if m:
            mapped_fx.add(f"{prompts.clean(s.effect, 20)}->{effect}")
            why.append(f"effect '{prompts.clean(s.effect, 20)}' is not supported -> {effect}")
        kind, m = fx.resolve_transition(s.transition)
        if m:
            mapped_tr.add(f"{prompts.clean(s.transition, 20)}->{kind}")
            why.append(f"transition '{prompts.clean(s.transition, 20)}' is not supported -> {kind}")
        if k == 0 and kind != "cut":
            kind = "cut"
            why.append("the first shot has nothing to transition from -> cut")
        elif kind == prev_tr and kind != "cut":
            why.append(f"{kind} twice in a row -> cut")
            kind = "cut"
        tr_dur = 0.0
        if kind != "cut":
            tr_dur = round(min(max(style.transition_duration, 0.15), 0.45 * (bounds[k] - bounds[k - 1]), 0.45 * length, 0.6), 3)
            if tr_dur < 0.06:
                why.append(f"{kind} does not fit such short shots -> cut")
                kind, tr_dur = "cut", 0.0
        timing = None  # moving a cut onto the beat is fine-tuning, not a correction: reported on its own
        if k > 0 and abs(start - fitted[k]) > 0.02:
            timing = f"cut {fitted[k]:.2f}s -> {start:.2f}s ({'onto the beat' if start in points_all else 'kept a shot long enough'})"
        if speed_note:
            timing = f"{timing}; {speed_note}" if timing else speed_note
        crop_mode = s.crop if s.crop in ("auto", "fill", "fit") else "auto"
        fxv = s.focus_x if s.focus_x is not None and 0.0 <= s.focus_x <= 1.0 else None
        fyv = s.focus_y if s.focus_y is not None and 0.0 <= s.focus_y <= 1.0 else None
        crop = CropSpec(framing=crop_mode, focus_x=fxv if crop_mode == "fill" else None, focus_y=fyv if crop_mode == "fill" and fxv is not None else None)
        w = _window_for(src_start, clip.analysis.windows)
        segments.append(Segment(
            id=f"{rng.getrandbits(48):012x}", clip_id=clip.clip_id, video=clip.name, source_start=src_start, source_end=src_end,
            timeline_start=round(start, 3), timeline_end=round(end, 3), speed=round(speed, 3), effect=effect,
            focus_x=w.focus_x if w else 0.5, focus_y=w.focus_y if w else 0.5, focus_source=w.focus_source if w else "center",
            crop=crop, transition_in=Transition(type=kind, duration=tr_dur),
            reason=f"{clip.name}: {prompts.clean(s.why, 160)}" if prompts.clean(s.why, 160)
            else f"{clip.name}: the AI director's {s.purpose if s.purpose in PURPOSES else 'main'} shot.",
        ))  # fmt: skip
        purposes.append(s.purpose if s.purpose in PURPOSES else "main")
        log.append({
            "shot": k + 1, "clip": clip.name, "purpose": purposes[-1], "beatAlignment": s.beat_alignment,
            "asked": {"start": round(asked_starts[k], 2), "seconds": round(float(s.duration), 2), "from": round(float(s.source_start or 0.0), 2),
                      "to": round(float(s.source_end or 0.0), 2), "effect": s.effect, "transition": s.transition, "speed": s.speed, "crop": s.crop},
            "used": {"start": round(start, 2), "end": round(end, 2), "from": src_start, "to": src_end, "effect": effect, "transition": kind,
                     "transitionSeconds": tr_dur, "speed": round(speed, 3), "crop": crop_mode},
            "changes": why, "timing": timing,
        })  # fmt: skip
        prev_tr = kind
    if mapped_fx:
        fixes.append("Effects mapped to supported ones: " + ", ".join(sorted(mapped_fx)[:6]) + ".")
    if mapped_tr:
        fixes.append("Transitions mapped to supported ones: " + ", ".join(sorted(mapped_tr)[:6]) + ".")

    # ---- 4. style, grade, overlays, music
    style_id = style.id if keep_style else (plan.style if plan.style in style_ids else style.id)
    if not keep_style and plan.style not in style_ids:
        fixes.append(f"The AI chose an unknown style ('{prompts.clean(plan.style, 20)}'); kept {style.id}.")
    grade = grades.resolve_grade(plan.grade)
    raw_overlays: list[TextOverlay] = []
    for o in plan.overlays[:12]:
        text = tidy_text(o.text)
        if not text:
            continue
        raw_overlays.append(TextOverlay(
            text=text, start=max(float(o.start), 0.0), end=max(float(o.end), 0.0),
            role=o.role if o.role in OVERLAY_ROLES else "text", position=o.position if o.position in OVERLAY_POSITIONS else "top",
            animation=o.animation if o.animation in OVERLAY_ANIMATIONS else "fade",
        ))  # fmt: skip
    if hook_text and not any(o.role == "hook" for o in raw_overlays) and tidy_text(hook_text):
        raw_overlays.append(TextOverlay(text=tidy_text(hook_text), start=0.3, end=min(2.3, duration), role="hook", animation="slide_up"))
    cta = tidy_text(cta_text or plan.cta)
    if cta_text and not any(o.role == "cta" for o in raw_overlays) and cta:
        raw_overlays.append(TextOverlay(text=cta, start=max(duration - 2.2, 0.0), end=duration, role="cta", position="center", animation="scale"))
    overlays, text_notes = normalize(raw_overlays, duration)
    fixes += text_notes
    music_volume = 1.0
    if plan.music_volume is not None and plan.music_volume == plan.music_volume:
        music_volume = round(min(max(plan.music_volume, 0.3), 1.5), 2)

    timeline = Timeline(duration=round(duration, 3), bpm=mm.bpm, audio_start=audio_start, style=style_id, segments=segments,
                        color_grade=grade, overlays=overlays, music_volume=music_volume)  # fmt: skip
    if snapped:
        fixes.append(f"{snapped} cut(s) were moved onto the nearest beat.")
    return DirectedReel(timeline=timeline, fixes=fixes, post_copy=_post_copy(plan), purposes=purposes, log=log, problems=problems, pace=cut_pace)


def _post_copy(plan: ReelDirectorPlan) -> dict | None:
    title = prompts.clean(plan.title, 60)
    description = prompts.clean(plan.description, 200)
    tags: list[str] = []
    for t in plan.hashtags:
        tag = _TAG.sub("", str(t))[:30]
        if tag and tag.lower() not in {x.lower() for x in tags}:
            tags.append(tag)
    if not title and not description:
        return None
    return {"title": title, "description": description, "hashtags": tags[:8]}
