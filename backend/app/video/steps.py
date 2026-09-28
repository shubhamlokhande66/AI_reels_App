"""Step-by-step Reels (cooking, crafts, tutorials): every clip appears once, in the order the steps happened.

The normal editor picks the best moments in any order, which is wrong for a recipe: the finished dish must come last and
"add the salt" must not come before "chop the onion". This builder keeps the order, gives each clip a share of the Reel,
fast-forwards long steps (the classic recipe-Reel look) and lands every cut on a beat of the music.
"""

from __future__ import annotations

import random
import re

from app.models.analysis import AudioAnalysis, UsableWindow
from app.models.timeline import Caption, Segment, Timeline
from app.styles.base import EditingStyle
from app.video.timeline import (
    ClipInput,
    Slot,
    _grid_beats,
    _snap_to_accent,
    _windows_of,
    assign_effects,
    assign_transitions,
    choose_music_window,
)
from app.director.story import FINAL_STAGES, order_for_food, stage_of
from app.video.timeline_ops import _words_for

MAX_STEP_SPEED = 2.0  # a long step is fast-forwarded at most this much (more looks like a glitch)
MIN_SLOW_SPEED = 0.5
MAX_STEP_SECONDS = 4.0  # the most time one step gets on screen
FINAL_SHARE = 1.4  # the finished dish gets a longer look than a normal step
MIN_STEP = 0.7
TEASER_SECONDS = 1.2  # the finished dish, shown first for about this long (moved to the nearest beat)
LABEL_MAX = 1.8

# On-screen words per language: (teaser, step "{n}", finale)
LABELS = {
    "en": ("The result", "Step {n}", "Done!"),
    "hinglish": ("Final result", "Step {n}", "Ready!"),
    "hi": ("नतीजा", "स्टेप {n}", "तैयार!"),
    "mr": ("अंतिम रूप", "पायरी {n}", "तयार!"),
}

_STAMP = re.compile(r"(20\d{2})[-_.]?([01]\d)[-_.]?([0-3]\d)(?:[-_. T]?([0-2]\d)[-_.]?([0-5]\d)[-_.]?([0-5]\d))?")
_SERIAL = re.compile(r"(\d{2,})(?!.*\d)")  # the last number in the name: IMG_1234, WA0007, Video (12)


_CLOCK = re.compile(r"(\d{1,2})[.:](\d{2})[.:](\d{2})\s*([AaPp][Mm])?")  # WhatsApp: "2026-09-21 at 2.57.54 PM"


def recording_key(name: str) -> tuple | None:
    """When a clip was recorded, as far as its file name says (phones name files by date/time or a running number)."""
    stem = re.sub(r"\.[A-Za-z0-9]{2,4}$", "", name)
    m = _STAMP.search(stem)
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            after = stem[m.end():]
            if m.group(4):  # 20240301_101500
                hh, mi, ss = int(m.group(4)), int(m.group(5)), int(m.group(6))
                rest = after
            elif c := _CLOCK.search(after):  # 2026-09-21 at 2.57.54 PM
                hh, mi, ss = int(c.group(1)), int(c.group(2)), int(c.group(3))
                if c.group(4):
                    hh = hh % 12 + (12 if c.group(4).lower() == "pm" else 0)
                rest = after[c.end():]
            else:  # VID-20240101-WA0005: the date, then a running number for the day
                hh = mi = ss = 0
                rest = after
            serial = _SERIAL.search(rest)
            return (y, mo, d, hh, mi, ss, int(serial.group(1)) if serial else 0)
    serial = _SERIAL.search(stem)
    if serial:
        return (0, 0, 0, 0, 0, 0, int(serial.group(1)))
    return None


def order_clips(clips: list[ClipInput], notes: list[str]) -> list[ClipInput]:
    """Recording order when every file name reveals it; otherwise the order the user arranged them in."""
    keys = [recording_key(c.name) for c in clips]
    if len(clips) > 1 and all(k is not None for k in keys) and len(set(keys)) == len(keys):
        ordered = [c for _, c in sorted(zip(keys, clips), key=lambda kc: kc[0])]
        moved = [c.name for c in ordered] != [c.name for c in clips]
        notes.append("Steps follow the time in the file names" + (" (your list was reordered to match)." if moved else "."))
        return ordered
    notes.append("Steps follow the order of your clip list (the file names do not show when they were recorded). Reorder the clips if a step is out of place.")
    return list(clips)


def _best_window(clip: ClipInput) -> UsableWindow:
    return max(_windows_of(clip), key=lambda w: (w.length, w.quality))


def _allocate(clips: list[ClipInput], target: float, notes: list[str]) -> tuple[list[float], float]:
    """Seconds per step and the Reel length: as long as the footage needs, never more than the length asked for."""
    n = len(clips)
    nat = [min(max(_best_window(c).length, MIN_STEP), MAX_STEP_SECONDS) for c in clips]
    weights = [FINAL_SHARE if i == n - 1 and n > 1 else 1.0 for i in range(n)]
    want = [a * w for a, w in zip(nat, weights)]
    total = sum(want)
    if n * MIN_STEP > target:
        target = float(n * MIN_STEP)
        notes.append(f"{n} steps need at least {n * MIN_STEP:.0f}s to be readable, so the Reel is longer than the length you chose.")
    if total <= target:
        if total < target - 1.0:
            notes.append(f"The Reel is {total:.0f}s, not {target:g}s: each step is shown once and that is all the footage there is.")
        return want, total
    scale = target / total
    return [max(w * scale, MIN_STEP) for w in want], target


def _snap(targets: list[float], beats: list[float], end: float, begin: float = 0.0, accents: list[tuple[float, float]] = ()) -> list[float]:
    """Cumulative step ends moved to the nearest beat, then onto a real strong accent close to that beat (that is how
    professional edits actually cut - see ``_snap_to_accent``), keeping every step at least MIN_STEP long. The last end is
    the Reel end."""
    n = len(targets)
    out: list[float] = []
    prev = begin
    for k, t in enumerate(targets[:-1]):
        lo, hi = prev + MIN_STEP, end - (n - 1 - k) * MIN_STEP
        cands = [b for b in beats if lo - 1e-6 <= b <= hi + 1e-6]
        pick = min(cands, key=lambda b: abs(b - t)) if cands else min(max(t, lo), hi)
        snapped = _snap_to_accent(pick, accents)
        if lo - 1e-6 <= snapped <= hi + 1e-6:
            pick = snapped
        out.append(round(pick, 3))
        prev = pick
    return out + [round(end, 3)]


def build_steps_timeline(
    audio: AudioAnalysis,
    clips: list[ClipInput],
    duration: float,
    style: EditingStyle,
    seed: int = 0,
    audio_start: float | None = None,
    teaser: bool = False,
    step_labels: bool = False,
    language: str = "en",
    order_mode: str = "auto",  # "manual" = keep the clips exactly as given (your list order); "auto" = guess from file names / what they show
) -> Timeline:
    if not clips:
        raise ValueError("At least one clip is required to build a timeline.")
    rng = random.Random(seed)
    warnings: list[str] = []
    notes: list[str] = []
    manual = order_mode == "manual"
    story = None
    if manual:
        notes.append("Steps follow the order you arranged them in.")
    else:
        clips = order_clips(clips, notes)
        story = order_for_food(clips)  # what the clips SHOW beats what their files are called (needs the vision model)
        if story.used_vision:
            clips = story.clips
            notes.extend(story.notes)
    n = len(clips)
    hook_clip = (story.hook if story else None) or clips[-1]
    last_stage = stage_of(clips[-1].semantic)
    if teaser and last_stage is not None and last_stage not in FINAL_STAGES and (story is None or story.hook is None) and not manual:
        teaser = False
        notes.append("No clip shows the finished dish, so there is no result teaser at the start.")

    finale = _best_window(hook_clip)
    teaser = teaser and n >= 2 and finale.length >= TEASER_SECONDS
    lead = TEASER_SECONDS if teaser else 0.0
    shares, steps_len = _allocate(clips, max(float(duration) - lead, MIN_STEP), notes)
    start, eff = choose_music_window(audio, steps_len + lead, warnings, start=audio_start)
    grid = _grid_beats(audio, start, eff)
    if teaser:  # the teaser ends on the beat nearest its nominal length
        near = [b for b in grid if 0.8 <= b <= 1.7]
        lead = min(near, key=lambda b: abs(b - TEASER_SECONDS)) if near else TEASER_SECONDS
    scale = (eff - lead) / sum(shares) if sum(shares) > eff - lead else 1.0
    cum, run = [], lead
    for sh in shares:
        run += sh * scale
        cum.append(run)
    accents_rel = [(round(t - start, 3), s) for t, s in zip(audio.accents, audio.accent_strengths)]
    ends = _snap(cum, grid, eff, begin=lead, accents=accents_rel)

    slots: list[Slot] = []
    segments: list[Segment] = []
    prev_end = 0.0
    trimmed: list[str] = []
    if teaser:  # the last moments of the finished dish, up front: the reason to keep watching
        c = hook_clip
        slot = Slot(0, 0.0, round(lead, 3), audio.mean_energy(start, start + lead), on_strong=True)
        slots.append(slot)
        segments.append(
            Segment(
                clip_id=c.clip_id, video=c.name, source_start=round(finale.end - lead, 3), source_end=round(finale.end, 3),
                timeline_start=0.0, timeline_end=slot.end, speed=1.0,
                focus_x=finale.focus_x, focus_y=finale.focus_y, focus_source=finale.focus_source,
            )
        )
        prev_end = slot.end
    for i, (clip, end) in enumerate(zip(clips, ends)):
        length = end - prev_end
        w = _best_window(clip)
        last = i == n - 1
        speed = 1.0
        if w.length < length - 1e-6:  # a short step stretched over a longer slot: slow it down a little rather than freeze
            speed = max(w.length / length, MIN_SLOW_SPEED)
            span = min(length * speed, w.length)
            if length * speed > w.length + 0.05:
                warnings.append(f"'{clip.name}' is shorter than the time its step needs, so it plays in slow motion.")
        else:
            if not last and w.length > length * 1.25:  # a long step is fast-forwarded so more of it shows
                speed = min(MAX_STEP_SPEED, w.length / length)
            span = length * speed
            if w.length - span > 0.5:
                trimmed.append(clip.name)
        room = max(w.length - span, 0.0)
        if last:
            a = w.start + room  # the finished dish is at the end of its clip
        elif room <= 0.3 * w.length:
            a = w.start + room / 2
        else:
            picks = [w.start + room * k / 5 for k in range(6)]
            a = max(picks, key=lambda t: w.motion_between(t, t + span))
        slot = Slot(len(slots), round(prev_end, 3), end, audio.mean_energy(start + prev_end, start + end), on_strong=False)
        slots.append(slot)
        segments.append(
            Segment(
                clip_id=clip.clip_id, video=clip.name,
                source_start=round(a, 3), source_end=round(min(a + span, w.end), 3),
                timeline_start=slot.start, timeline_end=slot.end, speed=round(speed, 3),
                focus_x=w.focus_x, focus_y=w.focus_y, focus_source=w.focus_source,
            )
        )
        prev_end = end

    captions: list[Caption] = []
    if step_labels:
        word_teaser, step_fmt, word_done = LABELS.get(language, LABELS["en"])
        by_id = {c.clip_id: c for c in clips}
        numbered = 0
        for k, seg in enumerate(segments):
            if teaser and k == 0:
                text = word_teaser
            else:
                stage = stage_of(by_id[seg.clip_id].semantic)
                if k == len(segments) - 1 and (stage is None or stage in FINAL_STAGES):
                    text = word_done
                elif stage == "ingredients" and language in ("en", "hinglish"):
                    text = "Ingredients"  # shown as what it is, not as a numbered step
                else:
                    numbered += 1
                    text = step_fmt.format(n=numbered)
            a = seg.timeline_start + 0.1
            b = min(seg.timeline_end - 0.08, a + LABEL_MAX)
            if b - a >= 0.4:
                captions.append(Caption(start=round(a, 3), end=round(b, 3), text=text, words=_words_for(text, a, b)))

    assign_effects(segments, slots, style, rng)
    assign_transitions(segments, slots, style, rng)
    for seg in segments:
        seg.id = f"{rng.getrandbits(48):012x}"
    if trimmed:
        notes.append(f"Only part of {len(trimmed)} long step{'s' if len(trimmed) != 1 else ''} fits: {', '.join(trimmed[:3])}{'…' if len(trimmed) > 3 else ''}. Choose a longer Reel to show more.")
    if teaser:
        notes.append("The Reel opens with a short look at the finished dish (the last clip), then shows the steps in order.")
    fast = sum(1 for s in segments if s.speed > 1.05)
    if fast:
        notes.append(f"{fast} long step{'s are' if fast != 1 else ' is'} sped up so the whole action still shows.")
    return Timeline(
        duration=round(eff, 3), bpm=audio.bpm, audio_start=start, style=style.id, segments=segments, warnings=warnings, notes=notes,
        captions=captions, caption_style="bold" if captions else "minimal",
    )
