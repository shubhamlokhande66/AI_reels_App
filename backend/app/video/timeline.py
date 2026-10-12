"""Editing engine: audio beats + clip analyses + style -> Timeline.

Pure functions (no I/O, no FFmpeg) so the whole edit is deterministic and unit-testable.
The same seed gives the same edit; a different seed gives a different version.
"""

from __future__ import annotations

import bisect
import math
import random
import re
from dataclasses import dataclass
from typing import Mapping

from app.ai.understanding import ClipSemantic
from app.models.analysis import AudioAnalysis, ClipAnalysis, UsableWindow
from app.models.timeline import Segment, Timeline, Transition
from app.styles.base import EditingStyle
from app.video import footage

MIN_SLOW_SPEED = 0.4
HIGH_ENERGY = 0.6
LOW_ENERGY = 0.4
START_STEPS = 6  # candidate start offsets tried inside each window
ACCENT_MIN_STRENGTH = 0.55  # relative to the strongest hit in the song
ACCENT_MIN_SHOT = 1.4  # only shots at least this long (seconds) are split at a hit
ACCENT_EDGE = 0.45  # a hit must be at least this far from both ends of its shot
ACCENT_GAP = 0.8  # and from another hit in the same shot
ACCENT_FRAME = 1 / 24
ACCENT_SNAP_TOL = 0.12  # a cut this close to a strong accent moves onto it (measured against real, professionally-edited Reels)
ACCENT_SNAP_MIN = 0.6  # relative accent strength (1.0 = the strongest hit in the song) needed to pull a cut onto it


@dataclass
class ClipInput:
    clip_id: str
    name: str
    analysis: ClipAnalysis
    semantic: ClipSemantic | None = None  # what the clip shows (vision model), when analysed


@dataclass
class Slot:
    index: int
    start: float
    end: float
    energy: float
    on_strong: bool = False  # begins on a strong beat / drop

    @property
    def length(self) -> float:
        return self.end - self.start


# ----------------------------------------------------------------------------- music window
def choose_music_window(
    audio: AudioAnalysis, duration: float, warnings: list[str] | None = None, start: float | None = None
) -> tuple[float, float]:
    """(audio_start, effective_duration). Starts on a beat, preferring energetic stretches.

    ``start`` is the part of the song the user picked: it is used as given (kept inside the song).
    """
    warnings = warnings if warnings is not None else []
    usable = audio.duration - 0.05
    if usable < duration:
        eff = max(int(usable), 1) if usable >= 1 else usable
        warnings.append(
            f"The song is only {audio.duration:.1f}s long, shorter than the requested "
            f"{duration:g}s; the Reel was shortened to {eff:g}s."
        )
        return 0.0, float(eff)
    if start is not None:
        latest = round(audio.duration - duration - 0.05, 3)
        chosen = min(max(start, 0.0), latest)
        if chosen < start - 0.05:
            warnings.append(
                f"The part of the song you chose starts at {start:.1f}s, but a {duration:g}s Reel needs to start by "
                f"{latest:.1f}s to fit inside the {audio.duration:.1f}s song, so it starts at {chosen:.1f}s."
            )
        return round(chosen, 3), float(duration)
    if audio.duration - duration < 1.0 or not audio.beats:
        return 0.0, float(duration)
    parts = rank_music_windows(audio, duration, k=1)
    return (parts[0]["start"] if parts else 0.0), float(duration)


def _window_score(audio: AudioAnalysis, b: float, duration: float, strong: set[float]) -> tuple[float, list[str]]:
    e = audio.mean_energy(b, b + duration)
    score, why = e, [f"{'very high' if e >= 0.75 else 'high' if e >= 0.55 else 'medium' if e >= 0.35 else 'low'} energy"]
    if b in strong:
        score += 0.03
        why.append("starts on a strong beat")
    drop = next((d for d in audio.drops if b <= d <= b + duration * 0.4), None)
    if drop is not None:
        score += 0.10
        why.append(f"the drop hits {drop - b:.1f}s in")
    if b < 0.3:
        score += 0.05  # starting from the beginning of a song feels natural
        why.append("the start of the song")
    sec = audio.section_at(b + duration / 2) if audio.song_sections else None
    if sec is not None:
        why.append(f"mostly the {sec.label}")
    return score, why


def rank_music_windows(audio: AudioAnalysis, duration: float, k: int = 5) -> list[dict]:
    """The best parts of the song for a ``duration``-second Reel, best first, each clearly different from the others
    (they overlap by less than half). Each: {start, end, score, reasons}. The first is what the editor uses by default."""
    if audio.duration - duration < 1.0 or not audio.beats:
        return [{"start": 0.0, "end": round(min(duration, audio.duration), 3), "score": 0.0, "reasons": ["the whole song"]}]
    candidates = [b for b in audio.beats if b + duration <= audio.duration - 0.05]
    if 0.0 not in candidates:
        candidates.insert(0, 0.0)
    strong = set(audio.strong_beats)
    scored = []
    for i, b in enumerate(candidates):  # stable: equal scores keep the earlier start, as before
        sc, why = _window_score(audio, b, duration, strong)
        scored.append((-sc, i, b, why, sc))
    out: list[dict] = []
    for _, _, b, why, sc in sorted(scored):
        if all(abs(b - o["start"]) >= duration * 0.5 for o in out):
            out.append({"start": round(b, 3), "end": round(b + duration, 3), "score": round(sc, 3), "reasons": why})
        if len(out) >= k:
            break
    return out


# ----------------------------------------------------------------------------- cut planning
def _grid_beats(audio: AudioAnalysis, start: float, duration: float) -> list[float]:
    """Beat times relative to the reel start, always beginning at 0 and covering ``duration``."""
    rel = [round(b - start, 3) for b in audio.beats if -0.03 <= b - start <= duration + 0.03]
    period = 60.0 / audio.bpm if audio.bpm > 0 else 0.5
    expected = duration / period
    if len(rel) < 0.6 * expected or len(rel) < 3:
        rel = [round(i * period, 3) for i in range(int(duration / period) + 1)]
    rel = [max(b, 0.0) for b in rel]
    if not rel or rel[0] > 0.05:
        rel.insert(0, 0.0)
    else:
        rel[0] = 0.0
    return sorted(set(rel))


def _snap_to_accent(t: float, accents_rel: list[tuple[float, float]], tol: float = ACCENT_SNAP_TOL, min_strength: float = ACCENT_SNAP_MIN) -> float:
    """Real edits cut on the transient, not the metronome: a strong hit within ``tol`` of a planned cut replaces it.

    Measured against two real Instagram Reels (a product reveal, a store tour): their cuts landed within 0.06-0.34s of the
    plain beat grid, but almost every one had a strong accent within 0.15s. This is what makes a cut feel "on the beat".
    """
    near = [(a, s) for a, s in accents_rel if abs(a - t) <= tol and s >= min_strength]
    return min(near, key=lambda pair: abs(pair[0] - t))[0] if near else t


def plan_slots(audio: AudioAnalysis, audio_start: float, duration: float, style: EditingStyle) -> list[Slot]:
    """Cut points on beats (snapped onto a real accent nearby, when there is one); pace follows the music energy and the style."""
    beats = _grid_beats(audio, audio_start, duration)
    strong_rel = {round(b - audio_start, 3) for b in audio.strong_beats}
    drops_rel = [d - audio_start for d in audio.drops]
    accents_rel = [(round(t - audio_start, 3), s) for t, s in zip(audio.accents, audio.accent_strengths)]
    period = 60.0 / audio.bpm if audio.bpm > 0 else 0.5

    def t_at(i: int) -> float:
        # Beats beyond the grid extend by the tempo; the final cut is always the reel end.
        return beats[i] if i < len(beats) else beats[-1] + (i - len(beats) + 1) * period

    slots: list[Slot] = []
    i, t = 0, 0.0
    while duration - t > 1e-3:
        e = audio.mean_energy(audio_start + t, audio_start + min(t + 2 * period, duration))
        n = style.cut_beats_high if e >= HIGH_ENERGY else style.cut_beats_low
        sec = audio.section_at(audio_start + t) if audio.song_sections else None
        if sec is not None and style.section_pacing:  # cut like the part of the song it is: intro/outro/bridge breathe, a drop tightens
            if sec.label in ("intro", "outro", "bridge"):
                n *= 2
            elif sec.label == "drop" and n >= 2:
                n //= 2
        n = max(n, 1)
        # Prefer ending on a strong beat when one is within +/-1 beat of the target.
        best_j, best_pen = i + n, 1.0
        for j in (i + n, i + n - 1, i + n + 1):
            if j <= i:
                continue
            length = t_at(j) - t
            if length < style.min_segment * 0.9 or length > style.max_segment * 1.1:
                continue
            pen = (0.0 if round(t_at(j), 3) in strong_rel else 0.5) + abs(j - (i + n)) * 0.25
            if pen < best_pen:
                best_j, best_pen = j, pen
        j = best_j
        while t_at(j) - t < style.min_segment and j < i + 64:
            j += 1
        end = min(t_at(j), duration)
        if end < duration - 1e-6:  # the Reel's own end is never moved onto an accent
            snapped = _snap_to_accent(end, accents_rel)
            if snapped - t >= max(style.min_segment * 0.75, 0.2) and duration - snapped >= max(style.min_segment * 0.75, 0.2):
                end = snapped
        if duration - end < style.min_segment:  # do not leave a runt at the end
            end = duration
        on_strong = round(t, 3) in strong_rel or any(abs(t - d) < 0.15 for d in drops_rel)
        slots.append(
            Slot(len(slots), round(t, 3), round(end, 3), audio.mean_energy(audio_start + t, audio_start + end), on_strong)
        )
        t, i = end, j
    slots[-1].end = round(float(duration), 3)
    return slots


def reference_cuts(ref_cuts: list[float], ref_duration: float, duration: float) -> list[float]:
    return reference_window(ref_cuts, ref_duration, duration)[1]


def reference_window(ref_cuts: list[float], ref_duration: float, duration: float) -> tuple[float, list[float]]:
    """(where in the reference the copied stretch starts, its cut times from there). See ``reference_cuts``."""
    return _window_offset(ref_cuts, ref_duration, duration), _reference_cuts(ref_cuts, ref_duration, duration)


def _window_offset(ref_cuts: list[float], ref_duration: float, duration: float) -> float:
    inner = [c for c in ref_cuts if 0 < c < ref_duration]
    if not (ref_duration > duration * 1.2 and inner):
        return 0.0
    return _best_start(inner, ref_duration, duration)


def _reference_cuts(ref_cuts: list[float], ref_duration: float, duration: float) -> list[float]:
    """The reference's cut times over ``duration`` seconds at their real speed: its most typical stretch (a longer
    reference), or its pattern repeated (a shorter one)."""
    inner = [c for c in ref_cuts if 0 < c < ref_duration]
    if ref_duration > duration * 1.2 and inner:
        # a longer reference: the stretch of it that cuts most like the reference as a whole (its typical rhythm),
        # not just its opening (a long intro shot would leave one shot for a short Reel)
        best = _best_start(inner, ref_duration, duration)
        return [round(c - best, 3) for c in inner if best < c < best + duration - 0.2]
    pattern = inner + [ref_duration]  # the end of the reference starts its next round
    out: list[float] = []
    offset = 0.0
    while offset < duration and pattern:
        for c in pattern:
            t = offset + c
            if t >= duration - 0.2:
                return out
            out.append(round(t, 3))
        offset += ref_duration
    return out


def _best_start(inner: list[float], ref_duration: float, duration: float) -> float:
    """Where the reference's most typical ``duration``-second stretch starts."""
    bounds = [0.0, *inner, ref_duration]
    shots = sorted(b - a for a, b in zip(bounds, bounds[1:]))
    typical = shots[len(shots) // 2]  # the reference's median shot length

    def score(st: float) -> float:
        cs = [c - st for c in inner if st < c < st + duration - 0.2]
        lens = [b - a for a, b in zip([0.0, *cs], [*cs, duration])]
        # every shot in the stretch close to the reference's typical shot (log scale: 2x too long = 2x too short)
        return sum(abs(math.log(max(x, 0.05) / typical)) for x in lens) / len(lens)
    starts = [0.0] + [c for c in inner if c <= ref_duration - duration]
    return min(starts, key=lambda st: (round(score(st), 3), st))


def template_slots(audio: AudioAnalysis, audio_start: float, duration: float, ref_cuts: list[float], ref_duration: float,
                   on_beat: float | None, style: EditingStyle, same_song: bool = False) -> list[Slot]:  # fmt: skip
    """"Make it like this Reel": the reference Reel's own cut timing, shot by shot, at its real speed (not squeezed or
    stretched): a longer reference gives its first ``duration`` seconds, a shorter one repeats its pattern. When the
    reference cuts on the beat, every cut moves onto this song's nearest beat. Shot 1 keeps the reference's hook."""
    if not ref_cuts or ref_duration <= 0:
        return plan_slots(audio, audio_start, duration, style)
    cuts = reference_cuts(ref_cuts, ref_duration, duration)
    if len(cuts) < 1:
        return plan_slots(audio, audio_start, duration, style)
    beats = [b - audio_start for b in audio.beats if audio_start <= b <= audio_start + duration]
    period = 60.0 / audio.bpm if audio.bpm > 0 else 0.5
    snap = on_beat is not None and on_beat >= 0.5 and len(beats) >= 2 and not same_song
    strong_rel = {round(b - audio_start, 3) for b in audio.strong_beats}
    out: list[float] = []
    for c in cuts:
        if snap:
            near = min(beats, key=lambda b: abs(b - c))
            if abs(near - c) <= period * 0.5:
                c = near
        if (not out and c >= 0.2) or (out and c - out[-1] >= 0.2):
            out.append(round(c, 3))
    bounds = [0.0, *out, round(float(duration), 3)]
    if bounds[-1] - bounds[-2] < 0.2 and len(bounds) > 2:
        bounds.pop(-2)
    slots = []
    for k, (a, b) in enumerate(zip(bounds, bounds[1:])):
        on_strong = round(a, 3) in strong_rel
        slots.append(Slot(k, round(a, 3), round(b, 3), audio.mean_energy(audio_start + a, audio_start + b), on_strong))
    return slots


# ----------------------------------------------------------------------------- selection
def _intersection(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return float(sum(min(x, y) for x, y in zip(a, b)))


def target_motion(energy: float, preference: float) -> float:
    """How much motion a shot should have at a given music energy."""
    if preference >= 0:
        return min(max(0.4 + 0.6 * preference * (energy - 0.5) * 2, 0.05), 0.95)
    return 0.2 + 0.2 * energy * (1 + preference)


@dataclass
class _Cand:
    clip: ClipInput
    window: UsableWindow
    start: float
    end: float
    score: float = 0.0


def _windows_of(clip: ClipInput) -> list[UsableWindow]:
    a = clip.analysis
    if a.windows:
        return a.windows
    m = a.metadata  # nothing usable: treat the whole clip as one low-trust window
    return [
        UsableWindow(
            start=0.0, end=m.duration, quality=a.quality_score * 0.5, motion=a.motion_score,
            brightness=a.brightness_score, sharpness=a.sharpness_score,
        )
    ]


def _overlap(a0: float, a1: float, ranges: list[tuple[float, float]]) -> float:
    total = sum(max(0.0, min(a1, r1) - max(a0, r0)) for r0, r1 in ranges)
    return min(total / max(a1 - a0, 1e-6), 1.0)


def brief_terms(brief: str) -> set[str]:
    """Meaningful words of the project brief (stop-words dropped)."""
    stop = {"the", "and", "for", "with", "this", "that", "from", "your", "about", "reel", "video", "make", "our", "are", "you"}
    return {w for w in re.findall(r"[a-z0-9]+", brief.lower()) if len(w) > 2 and w not in stop}


def relevance(clip: ClipInput, terms: set[str]) -> float:
    """0..1: how much of the brief the clip's visible content matches."""
    if not terms or clip.semantic is None:
        return 0.0
    return min(len(terms & clip.semantic.terms) / max(len(terms), 1) * 2.0, 1.0)  # 2 matches of 4 words = full score


def select_segments(
    slots: list[Slot],
    clips: list[ClipInput],
    style: EditingStyle,
    rng: random.Random,
    order_hint: Mapping[str, float] | None = None,
    warnings: list[str] | None = None,
    brief: str = "",
) -> list[Segment]:
    from app.director import intelligence as intel  # lazy: it builds on this module's helpers

    warnings = warnings if warnings is not None else []
    usable = [c for c in clips if c.analysis.usable]
    pool = usable or clips
    if not usable:
        warnings.append("No clip passed the quality checks; using the best available footage.")
    hooks = intel.rank_hooks(pool, brief)
    hero = intel.find_hero(pool) if len(slots) >= 3 else None
    peak = intel.hero_slot(slots, HIGH_ENERGY) if hero is not None else None
    hook_sigs = [w.signature for c in pool for w in _windows_of(c)]
    used: dict[str, list[tuple[float, float]]] = {c.clip_id: [] for c in pool}
    uses: dict[str, int] = {c.clip_id: 0 for c in pool}
    segments: list[Segment] = []
    prev: tuple[ClipInput, UsableWindow] | None = None
    n_slots = len(slots)
    reused_warned = False
    slow_warned = False
    terms = brief_terms(brief)

    for slot in slots:
        L = slot.length
        is_first, is_last = slot.index == 0, slot.index == n_slots - 1
        speed = 1.0
        wants_slow = rng.random() < style.slow_motion_chance and slot.energy < 0.75 and L >= 0.8
        if (is_last and style.closing == "reveal") or wants_slow:
            speed = style.slow_motion_speed
        span = L * speed

        tgt = target_motion(slot.energy, style.motion_preference)
        if is_first and style.opening == "establishing":
            tgt = 0.2
        cands: list[_Cand] = []
        for clip in pool:
            for w in _windows_of(clip):
                room = w.length - span
                if room < -1e-6:
                    continue
                steps = max(1, min(START_STEPS, int(room / 0.25) + 1))
                for k in range(steps):
                    a = w.start + (room * k / (steps - 1) if steps > 1 else min(room, 0.1) / 2)
                    cands.append(_Cand(clip, w, a, a + span))
        # A moment already shown is never shown again: only fresh good footage is a candidate.
        fresh = [c for c in cands if footage.is_fresh(c.start, c.end, used[c.clip.clip_id])]
        replay = False
        if fresh:
            cands = fresh
        else:
            # no fresh part is long enough: stretch the longest unused good part with slow motion ...
            spare = [(c, f) for c in pool if (f := footage.longest_free(_windows_of(c), used[c.clip_id])) is not None]
            spare = [(c, f) for c, f in spare if f[1] - f[0] >= L * footage.MIN_SLOW - 1e-6]
            if spare:
                clip, (a, b, w) = max(spare, key=lambda cf: (cf[1][1] - cf[1][0], cf[1][2].quality))
                speed = min(speed, max((b - a) / L, footage.MIN_SLOW))
                span = L * speed
                cands = [_Cand(clip, w, a, a + span)]
                if not slow_warned:
                    warnings.append("Some shots play in slow motion so no moment has to be shown twice.")
                    slow_warned = True
            elif cands:
                # ... and only when every good moment is used: a slowed-down replay (the one allowed repeat)
                replay = True
            else:  # not even a used window is long enough: stretch the longest one
                best = max(((c, w) for c in pool for w in _windows_of(c)), key=lambda cw: cw[1].length)
                clip, w = best
                speed = max(w.length / L, MIN_SLOW_SPEED)
                span = min(L * speed, w.length)
                cands = [_Cand(clip, w, w.start, w.start + span)]
                warnings.append("Some shots were longer than the available footage; slow motion/freeze was used.")

        for c in cands:
            w, clip = c.window, c.clip
            motion = w.motion_between(c.start, c.end)
            score = 0.40 * w.quality + 0.30 * (1.0 - abs(motion - tgt))
            score += 0.05 * clip.analysis.quality_score
            if uses[clip.clip_id] == 0:
                score += 0.20  # show every clip at least once
            score -= 0.12 * uses[clip.clip_id]
            score -= 0.70 * _overlap(c.start, c.end, used[clip.clip_id])
            if prev is not None:
                pclip, pw = prev
                score -= 0.30 * _intersection(w.signature, pw.signature)
                if pclip.clip_id == clip.clip_id:
                    score -= 0.35
            if style.prefer_landscape and clip.analysis.metadata.orientation == "landscape":
                score += 0.10
            if w.face:
                score += 0.04
            if clip.semantic is not None:
                score += 0.10 * clip.semantic.importance + 0.25 * relevance(clip, terms)
            if is_first:
                score += 0.15 * w.quality + (
                    0.15 * (1 - abs(motion - 0.2)) if style.opening == "establishing" else 0.10 * motion
                )
                if style.opening != "establishing":  # the opening is the strongest hook, not just the best picture
                    score += style.hook_priority * intel.hook_score(intel.hook_parts(clip, w, terms, hook_sigs))
            if style.subject_priority:
                score += style.subject_priority * intel.subject_value(clip, w)
            if style.shake_tolerance:
                score += 0.1 * style.shake_tolerance * clip.analysis.shake_score  # handheld energy is part of the look
            if prev is not None:  # motion matching: continue the movement of the shot before, never reverse it
                score += 0.08 * intel.motion_match(prev[1], w)
            if hero is not None and peak is not None and clip.clip_id == hero.clip_id:
                on_hero = _overlap(c.start, c.end, [(hero.start, hero.end)])
                if slot.index < peak:
                    score -= 0.45 * on_hero  # keep the strongest moment back for the music's peak
                elif slot.index == peak:
                    score += 0.40 * on_hero
            if slot.index == peak:
                score += 0.20 * intel.hero_value(clip, w, c.start, c.end)
            if is_last and style.closing == "reveal":
                score += 0.30 * w.sharpness * max(w.brightness, 0.2) + 0.10 * (1 - motion)
            if order_hint and clip.clip_id in order_hint:
                pos = slot.index / max(n_slots - 1, 1)
                score += 0.15 * (1.0 - abs(pos - order_hint[clip.clip_id]))
            score += rng.uniform(-0.03, 0.03)
            c.score = score

        chosen = max(cands, key=lambda c: c.score)
        if replay:
            speed = footage.REPLAY_SPEED
            chosen.end = chosen.start + L * speed
            if not reused_warned:
                warnings.append("There is not enough different good footage for this length, so a moment is shown again as a "
                                "slow-motion replay. Add more clips or choose a shorter Reel to avoid it.")
                reused_warned = True
        prev_w = prev[1] if prev is not None else None
        is_hero = (slot.index == peak and hero is not None and chosen.clip.clip_id == hero.clip_id
                   and _overlap(chosen.start, chosen.end, [(hero.start, hero.end)]) > 0.3)  # fmt: skip
        reason = intel.shot_reason(
            index=slot.index, n=n_slots, clip_name=chosen.clip.name, first_use=uses[chosen.clip.clip_id] == 0,
            hook=next((h for h in hooks if h.clip_id == chosen.clip.clip_id), None) if is_first else None,
            hero=is_hero, drop_at=slot.start if slot.on_strong else None, match=intel.motion_match(prev_w, chosen.window),
            energy=slot.energy, quality=chosen.window.quality, slow=speed < 0.95 and not replay,
            relevant=relevance(chosen.clip, terms) >= 0.5, prev_direction=prev_w.direction if prev_w else "still",
        )  # fmt: skip
        used[chosen.clip.clip_id].append((chosen.start, chosen.end))
        uses[chosen.clip.clip_id] += 1
        prev = (chosen.clip, chosen.window)

        segments.append(
            Segment(
                clip_id=chosen.clip.clip_id,
                video=chosen.clip.name,
                source_start=round(chosen.start, 3),
                source_end=round(chosen.end, 3),
                timeline_start=slot.start,
                timeline_end=slot.end,
                speed=round(speed, 3),
                focus_x=chosen.window.focus_x,
                focus_y=chosen.window.focus_y,
                focus_source=chosen.window.focus_source,
                reason=reason,
            )
        )
    return segments


# ----------------------------------------------------------------------------- effects / transitions
def _weighted_choice(weights: Mapping[str, float], rng: random.Random) -> str:
    items = [(k, w) for k, w in weights.items() if w > 0]
    total = sum(w for _, w in items)
    r = rng.uniform(0, total)
    for k, w in items:
        r -= w
        if r <= 0:
            return k
    return items[-1][0]


def assign_effects(segments: list[Segment], slots: list[Slot], style: EditingStyle, rng: random.Random) -> None:
    prev = "none"
    for seg, slot in zip(segments, slots):
        weights = dict(style.effects)
        if slot.on_strong and slot.energy >= HIGH_ENERGY and "punch" in weights:
            weights["punch"] *= 2.5
        if prev in weights and prev != "none":
            weights[prev] *= 0.4  # avoid the same effect back-to-back
        seg.effect = _weighted_choice(weights, rng)
        prev = seg.effect


def assign_transitions(segments: list[Segment], slots: list[Slot], style: EditingStyle, rng: random.Random) -> None:
    """Choose how each segment is entered. Most boundaries stay hard cuts ("don't overuse")."""
    boundaries = max(len(segments) - 1, 1)
    non_cut = 0
    prev_type = "cut"
    for i in range(1, len(segments)):
        e = slots[i].energy
        weights: dict[str, float] = {}
        for name, w in style.transitions.items():
            if name in ("flash", "zoom", "slide", "speed_ramp"):
                w *= 0.5 + e
            elif name in ("fade", "dissolve", "blur"):
                w *= 1.5 - e
            weights[name] = w
        if prev_type != "cut":
            weights[prev_type] = 0.0  # never the same transition twice in a row
            weights["cut"] = weights.get("cut", 0.0) + 0.5  # breathe after a transition
        kind = _weighted_choice(weights, rng)
        dur = min(style.transition_duration, 0.45 * segments[i - 1].timeline_end - 0.45 * segments[i - 1].timeline_start,
                  0.45 * (segments[i].timeline_end - segments[i].timeline_start))
        if kind != "cut" and (dur < 0.06 or (non_cut + 1) / boundaries > style.max_transition_ratio):
            kind = "cut"
        if kind == "cut":
            segments[i].transition_in = Transition(type="cut", duration=0.0)
        else:
            non_cut += 1
            segments[i].transition_in = Transition(type=kind, duration=round(dur, 3))
        prev_type = kind


def add_accent_hits(segments: list[Segment], audio: AudioAnalysis, audio_start: float, closing_reveal: bool = False) -> int:
    """Answer the song's strong hits that fall inside a long shot.

    The shot is split at the hit (rounded to a frame); the footage carries on seamlessly from the same point, and the
    part after the hit gets a quick "punch" zoom. So the picture reacts on the beat without repeating or skipping anything.
    Returns the number of hits added. Modifies ``segments`` in place.
    """
    hits = [(t - audio_start, s) for t, s in zip(audio.accents, audio.accent_strengths) if s >= ACCENT_MIN_STRENGTH]
    if not hits:
        return 0
    out: list[Segment] = []
    added = 0
    for idx, seg in enumerate(segments):
        length = seg.timeline_end - seg.timeline_start
        skip = length < ACCENT_MIN_SHOT or abs(seg.speed - 1.0) > 0.05 or (closing_reveal and idx == len(segments) - 1)
        picked: list[float] = []
        if not skip:
            inside = [(t, s) for t, s in hits if seg.timeline_start + ACCENT_EDGE <= t <= seg.timeline_end - ACCENT_EDGE]
            for t, _ in sorted(inside, key=lambda x: -x[1]):  # strongest first
                if len(picked) >= (1 if length < 2.0 else 2):
                    break
                if all(abs(t - p) >= ACCENT_GAP for p in picked):
                    picked.append(t)
        cuts = sorted({round(round(t / ACCENT_FRAME) * ACCENT_FRAME, 3) for t in picked})
        cuts = [c for c in cuts if seg.timeline_start + 0.2 < c < seg.timeline_end - 0.2]
        if not cuts:
            out.append(seg)
            continue
        edges = [seg.timeline_start, *cuts, seg.timeline_end]
        for k in range(len(edges) - 1):
            a, b = edges[k], edges[k + 1]
            piece = seg.model_copy(deep=True)
            piece.timeline_start, piece.timeline_end = a, b
            piece.source_start = seg.source_start if k == 0 else round(seg.source_start + (a - seg.timeline_start) * seg.speed, 3)
            piece.source_end = seg.source_end if k == len(edges) - 2 else round(seg.source_start + (b - seg.timeline_start) * seg.speed, 3)
            if k > 0:
                piece.effect = "punch"
                piece.transition_in = Transition(type="cut", duration=0.0)
                piece.reason = f"{seg.video}: A quick punch on a strong hit in the music; the same footage carries on, nothing repeats."
            out.append(piece)
        added += len(cuts)
    segments[:] = out
    return added


def _usable(c: ClipInput) -> float:
    return usable_footage_seconds([c])


def usable_footage_seconds(clips: list[ClipInput]) -> float:
    """Seconds of footage the selector can actually draw from (usable windows only)."""
    pool = [c for c in clips if c.analysis.usable] or clips
    return sum(sum(w.length for w in c.analysis.windows) or c.analysis.metadata.duration for c in pool)


# ----------------------------------------------------------------------------- entry point
def build_timeline(
    audio: AudioAnalysis,
    clips: list[ClipInput],
    duration: float,
    style: EditingStyle,
    seed: int = 0,
    order_hint: Mapping[str, float] | None = None,
    brief: str = "",
    audio_start: float | None = None,
    template: dict | None = None,
    beat_plan: bool = False,
    every_beat: bool = False,
    min_clip: float | None = None,
) -> Timeline:
    """``template``: a reference Reel to cut like ({"cuts", "seconds", "on_beat_share"}): its shot timing replaces the
    beat/energy-planned one (see template_slots). ``beat_plan``: cut exactly by the song's beat map plan
    (audio/beatmap.cut_plan): its cuts, each shot's effect and transition, and flashes on hard hits between beats."""
    if not clips:
        raise ValueError("At least one clip is required to build a timeline.")
    rng = random.Random(seed)
    warnings: list[str] = []
    audio_start, eff = choose_music_window(audio, duration, warnings, start=audio_start)
    footage = usable_footage_seconds(clips)
    if footage < eff * 1.15:
        warnings.append(
            f"You provided about {footage:.0f}s of usable footage for a {eff:g}s Reel, so some moments will repeat. "
            "Add more clips or choose a shorter duration."
        )
    plan_rows: list[dict] = []
    if template and template.get("cuts"):
        slots = template_slots(audio, audio_start, eff, template["cuts"], template.get("seconds") or eff, template.get("on_beat_share"), style,
                               same_song=bool(template.get("use_audio")))  # fmt: skip
    elif beat_plan:
        from app.audio.beatmap import cut_plan

        # distinct moments the footage can give (every-beat cutting takes shorter pieces of each clip)
        moments = sum(max(1, int(_usable(c) / (0.6 if every_beat else 1.6))) for c in clips)
        plan_rows = cut_plan(audio, start=audio_start, end=audio_start + eff, max_shots=max(moments, 3), every_beat=every_beat,
                             **({"min_shot": min_clip} if min_clip else {}))
        slots = plan_rows_to_slots(audio, audio_start, eff, plan_rows)
    else:
        slots = plan_slots(audio, audio_start, eff, style)
    segments = select_segments(slots, clips, style, rng, order_hint, warnings, brief)
    assign_effects(segments, slots, style, rng)
    assign_transitions(segments, slots, style, rng)
    motion_notes: list[str] = []
    if plan_rows:
        seconds = {c.clip_id: c.analysis.metadata.duration for c in clips}
        apply_plan(segments, plan_rows, audio_start, seconds)
        from app.director.plan_motion import add_motion  # keyframes and speed ramps from the music

        motion_notes = add_motion(segments, audio, audio_start, seconds)
        accents_added = 0
    else:
        accents_added = add_accent_hits(segments, audio, audio_start, style.closing == "reveal") if style.accent_hits else 0
    for seg in segments:  # ids come from the seeded RNG so the same seed gives an identical timeline
        seg.id = f"{rng.getrandbits(48):012x}"
    return Timeline(
        duration=round(eff, 3),
        bpm=audio.bpm,
        audio_start=audio_start,
        style=style.id,
        segments=segments,
        warnings=warnings,
        notes=([f"The picture answers {accents_added} strong hits in the music (a quick punch on the beat)."] if accents_added else []) + motion_notes,
    )


def plan_rows_to_slots(audio: AudioAnalysis, audio_start: float, duration: float, rows: list[dict]) -> list[Slot]:
    """The beat map plan's shots (song time) as slots in Reel time."""
    cuts = [round(r["t"] - audio_start, 3) for r in rows if r["kind"] == "cut" and r["transition"] != "fade_in"]
    bounds = [0.0, *[c for c in cuts if 0.2 <= c <= duration - 0.2], round(float(duration), 3)]
    strong = {round(b - audio_start, 3) for b in audio.strong_beats}
    return [Slot(k, a, b, audio.mean_energy(audio_start + a, audio_start + b), round(a, 3) in strong)
            for k, (a, b) in enumerate(zip(bounds, bounds[1:]))]  # fmt: skip


def apply_plan(segments: list[Segment], rows: list[dict], audio_start: float, clip_seconds: Mapping[str, float] | None = None) -> None:
    """Each shot gets the plan's effect and way in; a hard hit inside a shot gets a flash (the shot is split there, the
    same footage carrying on, so the flash lands on the hit). The plan's shots are locked: reviews keep them."""
    shots = [r for r in rows if r["kind"] == "cut"]
    for seg in segments:
        t = seg.timeline_start + audio_start
        row = min(shots, key=lambda r: abs(r["t"] - t)) if seg.timeline_start > 0.01 else shots[0]
        seg.effect = row["effect"] if row["effect"] != "none" else seg.effect if row["transition"] == "fade_in" else "none"
        if seg.timeline_start > 0.01 and row["transition"] not in ("fade_in", "cut", ""):
            seg.transition_in = Transition(type=row["transition"], duration=float(row.get("tdur") or 0.2))
        elif seg.timeline_start > 0.01:
            seg.transition_in = Transition(type="cut", duration=0.0)
        seg.locked = True
    land_on_beat(segments, clip_seconds or {})
    for r in rows:  # hard hits too close to a cut for a piece of their own: a speed ramp into the cut, or a zoom out of it
        at = round(r["t"] - audio_start, 3)
        if r["kind"] == "ramp":
            k = next((k for k, s in enumerate(segments) if s.timeline_start > at), None)
            if k is not None and segments[k].transition_in.type == "cut":
                segments[k].transition_in = Transition(type="speed_ramp", duration=round(max(segments[k].timeline_start - at, 0.12), 3))
        elif r["kind"] == "zoom":
            k = next((k for k in range(len(segments) - 1, -1, -1) if segments[k].timeline_start < at), None)
            if k is not None and segments[k].effect in ("none", "zoom_in", "zoom_pulse"):
                segments[k].effect = "punch"  # a sharp punch-in on the new shot (a zoom transition would blur it)
    for r in rows:
        if r["kind"] != "flash":
            continue
        at = round(r["t"] - audio_start, 3)
        from app.audio.beatmap import FLASH_MARGIN

        i = next((k for k, s in enumerate(segments) if s.timeline_start + FLASH_MARGIN <= at <= s.timeline_end - FLASH_MARGIN), None)
        if i is None:
            continue
        seg = segments[i]
        first = seg.model_copy(deep=True)
        second = seg.model_copy(deep=True)
        span = at - seg.timeline_start
        first.timeline_end = at
        first.source_end = round(seg.source_start + span * seg.speed, 3)
        second.timeline_start = at
        second.source_start = first.source_end
        second.effect = "beat_flash"
        second.transition_in = Transition(type="cut", duration=0.0)
        second.id = f"{seg.id}f"
        segments[i:i + 1] = [first, second]


def land_on_beat(segments: list[Segment], clip_seconds: Mapping[str, float]) -> None:
    """A blending transition runs from the boundary for its duration, so on its own the new shot arrives late. Move
    each boundary earlier so the transition lands on the beat: it ends on the beat (the new shot arrives on the hit),
    and a flash peaks on it (half its length before). The shot that comes in plays a little longer (its footage runs
    on; if the clip has no more, the transition is shortened)."""
    for i in range(1, len(segments)):
        prev, seg = segments[i - 1], segments[i]
        t = seg.transition_in
        if t.type in ("cut", "speed_ramp") or t.duration <= 0:
            continue
        flash = t.type == "flash"
        # a transition may last at most 40% of the shorter shot it joins (review._tidy_transitions); moving the cut
        # earlier shortens the previous shot, so stay inside that from the start: nothing gets trimmed later
        prev_len, seg_len = prev.timeline_end - prev.timeline_start, seg.timeline_end - seg.timeline_start
        want = min(t.duration, 0.4 * seg_len) / (2 if flash else 1)
        room_prev = 0.4 * prev_len / (1.8 if flash else 1.4) - 0.005
        spd = max(seg.speed, 0.01)
        after = (clip_seconds.get(seg.clip_id, 1e9) - seg.source_end) / spd  # footage left after the piece
        before = seg.source_start / spd  # or before it
        from_before = after < min(want, room_prev) and before > after
        shift = round(max(0.0, min(want, room_prev, before if from_before else after)), 3)
        if shift < 0.06:  # no room to start early: a hard cut, exactly on the beat
            seg.transition_in = Transition(type="cut", duration=0.0)
            continue
        if shift < want:  # less room: a shorter transition, still ending on the beat
            seg.transition_in = Transition(type=t.type, duration=round(shift * 2 if t.type == "flash" else shift, 3))
        prev.timeline_end = round(prev.timeline_end - shift, 3)
        prev.source_end = round(prev.source_end - shift * prev.speed, 3)
        seg.timeline_start = round(seg.timeline_start - shift, 3)
        if from_before:  # the clip has no more footage after the piece: start it a little earlier in the clip instead
            seg.source_start = round(seg.source_start - shift * seg.speed, 3)
        else:
            seg.source_end = round(seg.source_end + shift * seg.speed, 3)


def cut_points(timeline: Timeline) -> list[float]:
    return [s.timeline_start for s in timeline.segments[1:]]


def cut_moments(timeline: Timeline) -> list[tuple[float, float]]:
    """Each cut as (start, landing): where the next shot begins, and where its transition lands (its end; a flash at
    its peak, half-way; a hard cut or speed ramp lands where it starts). An edit may put either on the beat: a
    transition that starts on the beat, or one that starts early so it lands on it (the beat-map plan's way,
    video/timeline.land_on_beat). Both are on the beat."""
    out = []
    for s in timeline.segments[1:]:
        t = s.transition_in
        if t.type in ("cut", "speed_ramp") or t.duration <= 0:
            out.append((s.timeline_start, s.timeline_start))
        else:
            out.append((s.timeline_start, round(s.timeline_start + (t.duration / 2 if t.type == "flash" else t.duration), 4)))
    return out


def beat_distance(moment: tuple[float, float], points: list[float]) -> float:
    """How far a cut is from the beat: the nearer of its start and its landing (see cut_moments)."""
    return min(min(abs(m - b) for b in points) for m in moment) if points else 0.0


def nearest_beat_error(timeline: Timeline, audio: AudioAnalysis) -> float:
    """Largest distance (s) between a cut and the nearest beat - used by tests/diagnostics."""
    beats = sorted(round(b - timeline.audio_start, 3) for b in audio.beats)
    worst = 0.0
    for c in cut_points(timeline):
        i = bisect.bisect_left(beats, c)
        near = min(abs(c - beats[j]) for j in (i - 1, i) if 0 <= j < len(beats))
        worst = max(worst, near)
    return worst
