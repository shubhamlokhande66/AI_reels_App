"""Editing operations on the EDL (Timeline). Pure functions: no I/O, no FFmpeg.

Every edit, whether from the human in the editor, the quality auto-fix or the AI, is one of these
operations. They are validated, ripple the timeline (segments stay contiguous), and never touch
source media. After each batch the timeline is normalised so it is always renderable.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Annotated, Literal, Union

from pydantic import Field

from app.core.errors import ValidationFailed
from app.models.base import CamelModel
from app.models.timeline import (
    EFFECT_TYPES, TRANSITION_TYPES, Caption, CaptionWord, CropSpec, Segment, TextOverlay, Timeline, Transition, VoiceTrack, Watermark,
    new_id,
)  # fmt: skip

MIN_SEGMENT = 0.25  # seconds; shorter shots are not worth keeping
MIN_SPEED, MAX_SPEED = 0.25, 4.0
MAX_TRANSITION_SHARE = 0.45  # a transition may use at most this share of the shorter neighbouring shot


class EditError(ValidationFailed):
    code = "EDIT_INVALID"


@dataclass
class OpContext:
    """Facts about the project's media that edits must respect."""

    clip_durations: dict[str, float] = field(default_factory=dict)
    clip_names: dict[str, str] = field(default_factory=dict)
    audio_duration: float | None = None


# ------------------------------------------------------------------ operation schemas
class _Op(CamelModel):
    pass


class Trim(_Op):
    type: Literal["trim"] = "trim"
    segment_id: str
    source_start: float | None = None
    source_end: float | None = None


class SetLength(_Op):
    type: Literal["set_length"] = "set_length"
    segment_id: str
    length: float


class Move(_Op):
    type: Literal["move"] = "move"
    segment_id: str
    to_index: int


class Split(_Op):
    type: Literal["split"] = "split"
    segment_id: str
    at: float  # absolute timeline time


class Delete(_Op):
    type: Literal["delete"] = "delete"
    segment_id: str


class Duplicate(_Op):
    type: Literal["duplicate"] = "duplicate"
    segment_id: str


class Replace(_Op):
    type: Literal["replace"] = "replace"
    segment_id: str
    clip_id: str
    source_start: float = 0.0


class SetSpeed(_Op):
    type: Literal["set_speed"] = "set_speed"
    segment_id: str
    speed: float


class SetTransition(_Op):
    type: Literal["set_transition"] = "set_transition"
    segment_id: str
    transition: str
    duration: float | None = None


class SetEffect(_Op):
    type: Literal["set_effect"] = "set_effect"
    segment_id: str
    effect: str


class SetCrop(_Op):
    type: Literal["set_crop"] = "set_crop"
    segment_id: str
    crop: CropSpec


class SetMusic(_Op):
    type: Literal["set_music"] = "set_music"
    volume: float | None = Field(default=None, ge=0, le=2)
    fade_in: float | None = Field(default=None, ge=0, le=10)
    fade_out: float | None = Field(default=None, ge=0, le=10)
    audio_start: float | None = Field(default=None, ge=0)


class AddCaption(_Op):
    type: Literal["add_caption"] = "add_caption"
    start: float
    end: float
    text: str = Field(min_length=1, max_length=200)


class UpdateCaption(_Op):
    type: Literal["update_caption"] = "update_caption"
    caption_id: str
    start: float | None = None
    end: float | None = None
    text: str | None = Field(default=None, min_length=1, max_length=200)


class DeleteCaption(_Op):
    type: Literal["delete_caption"] = "delete_caption"
    caption_id: str


class SetCaptionStyle(_Op):
    type: Literal["set_caption_style"] = "set_caption_style"
    style: Literal["minimal", "bold", "karaoke", "highlight", "luxury"]


class SetVoice(_Op):
    type: Literal["set_voice"] = "set_voice"
    voice: VoiceTrack


class ClearVoice(_Op):
    type: Literal["clear_voice"] = "clear_voice"


class SetVoiceMix(_Op):
    type: Literal["set_voice_mix"] = "set_voice_mix"
    volume: float | None = Field(default=None, ge=0, le=2)
    duck_music: bool | None = None
    start: float | None = Field(default=None, ge=0, le=10)


class CaptionInput(CamelModel):
    start: float
    end: float
    text: str = Field(min_length=1, max_length=200)


class ReplaceCaptions(_Op):
    """Replace the whole text track (e.g. captions generated from a new script)."""

    type: Literal["replace_captions"] = "replace_captions"
    captions: list[CaptionInput] = Field(max_length=300)


class SetWatermark(_Op):
    type: Literal["set_watermark"] = "set_watermark"
    watermark: Watermark


class ClearWatermark(_Op):
    type: Literal["clear_watermark"] = "clear_watermark"


class SetCaptionLook(_Op):
    """Brand look for captions: font family and/or colour (#RRGGBB). Empty string clears the override."""

    type: Literal["set_caption_look"] = "set_caption_look"
    font: str | None = Field(default=None, max_length=60)
    color: str | None = Field(default=None, pattern=r"^(#[0-9A-Fa-f]{6})?$")


class FitToVoice(_Op):
    """Re-time the Reel to the voice: length = lead-in + voice + tail. Shots shrink/extend, captions follow."""

    type: Literal["fit_to_voice"] = "fit_to_voice"
    tail: float = Field(default=0.8, ge=0, le=5)


class FitDuration(_Op):
    type: Literal["fit_duration"] = "fit_duration"
    target: float = Field(ge=1, le=600)


class SetOverlays(_Op):
    """Replace the on-screen text layers (hook, benefit, CTA ...). They are tidied: word limit, minimum time, no stacking."""

    type: Literal["set_overlays"] = "set_overlays"
    overlays: list[TextOverlay] = Field(default_factory=list, max_length=30)


class SetLock(_Op):
    """Lock / unlock a shot against automatic changes (the reviewer, self-correction, AI revisions)."""

    type: Literal["set_lock"] = "set_lock"
    segment_id: str
    locked: bool = True


class SetGrade(_Op):
    """Choose a colour-grade preset (video/grades.py); null = the style's own grade."""

    type: Literal["set_grade"] = "set_grade"
    grade: str | None = None


Operation = Annotated[
    Union[
        Trim, SetLength, Move, Split, Delete, Duplicate, Replace, SetSpeed, SetTransition, SetEffect, SetCrop,
        SetMusic, AddCaption, UpdateCaption, DeleteCaption, SetCaptionStyle, FitDuration, SetVoice, ClearVoice,
        SetVoiceMix, ReplaceCaptions, FitToVoice, SetWatermark, ClearWatermark, SetCaptionLook, SetOverlays, SetGrade, SetLock,
    ],
    Field(discriminator="type"),
]  # fmt: skip


# ------------------------------------------------------------------ helpers
def _index(tl: Timeline, segment_id: str) -> int:
    for i, s in enumerate(tl.segments):
        if s.id == segment_id:
            return i
    raise EditError("That shot no longer exists.", code="SEGMENT_NOT_FOUND")


def relayout(tl: Timeline) -> None:
    """Make segments contiguous from 0, keeping each shot's length."""
    t = 0.0
    for s in tl.segments:
        length = max(s.timeline_end - s.timeline_start, 0.0)
        s.timeline_start = round(t, 3)
        s.timeline_end = round(t + length, 3)
        t += length
    tl.duration = round(t, 3)


def _apply_length(seg: Segment, length: float) -> None:
    seg.timeline_end = seg.timeline_start + length


def _fit_source(seg: Segment, clip_dur: float | None) -> None:
    """Derive the source range from length and speed; keep it inside the clip."""
    span = seg.length * seg.speed
    start = max(seg.source_start, 0.0)
    if clip_dur:
        if span > clip_dur:  # the clip is too short for this shot: shorten the shot
            span = clip_dur
            _apply_length(seg, span / seg.speed)
        start = min(start, clip_dur - span)
    seg.source_start = round(max(start, 0.0), 3)
    seg.source_end = round(seg.source_start + span, 3)


def _words_for(text: str, start: float, end: float) -> list[CaptionWord]:
    parts = text.split()
    if not parts:
        return []
    step = (end - start) / len(parts)
    return [CaptionWord(text=p, start=round(start + i * step, 3), end=round(start + (i + 1) * step, 3))
            for i, p in enumerate(parts)]  # fmt: skip


def normalize(tl: Timeline, ctx: OpContext) -> Timeline:
    """Leave the timeline valid: contiguous, in-range sources, sane transitions, clamped captions."""
    for s in tl.segments:
        s.speed = min(max(s.speed, MIN_SPEED), MAX_SPEED)
        _fit_source(s, ctx.clip_durations.get(s.clip_id))
    relayout(tl)

    for i, s in enumerate(tl.segments):
        t = s.transition_in
        if i == 0 or t.type == "cut" or t.type not in TRANSITION_TYPES:
            s.transition_in = Transition(type="cut", duration=0.0)
            continue
        limit = MAX_TRANSITION_SHARE * min(tl.segments[i - 1].length, s.length)
        dur = min(t.duration or 0.3, limit)
        s.transition_in = Transition(type=t.type, duration=round(dur, 3)) if dur >= 0.06 else Transition()

    caps: list[Caption] = []
    for c in sorted(tl.captions, key=lambda c: c.start):
        start, end = max(c.start, 0.0), min(c.end, tl.duration)
        if end - start < 0.1 or not c.text.strip():
            continue
        words = c.words if c.words and (c.start, c.end) == (start, end) else _words_for(c.text, start, end)
        caps.append(Caption(id=c.id, start=round(start, 3), end=round(end, 3), text=c.text.strip(), words=words))
    for a, b in zip(caps, caps[1:]):  # never overlap
        if a.end > b.start:
            a.end = b.start
    tl.captions = [c for c in caps if c.end - c.start >= 0.1]

    if ctx.audio_duration and tl.audio_start + tl.duration > ctx.audio_duration:
        tl.audio_start = round(max(ctx.audio_duration - tl.duration, 0.0), 3)
    return tl


# ------------------------------------------------------------------ operations
def _trim(tl: Timeline, op: Trim, ctx: OpContext) -> None:
    s = tl.segments[_index(tl, op.segment_id)]
    start = s.source_start if op.source_start is None else op.source_start
    end = s.source_end if op.source_end is None else op.source_end
    if end - start < MIN_SEGMENT * s.speed:
        raise EditError(f"A shot must be at least {MIN_SEGMENT:g}s long.", code="SEGMENT_TOO_SHORT")
    clip = ctx.clip_durations.get(s.clip_id)
    if start < 0 or (clip and end > clip + 1e-6):
        raise EditError("The trim is outside the clip.", code="TRIM_OUT_OF_RANGE")
    s.source_start = start
    _apply_length(s, (end - start) / s.speed)


def _set_length(tl: Timeline, op: SetLength, ctx: OpContext) -> None:
    s = tl.segments[_index(tl, op.segment_id)]
    if op.length < MIN_SEGMENT:
        raise EditError(f"A shot must be at least {MIN_SEGMENT:g}s long.", code="SEGMENT_TOO_SHORT")
    clip = ctx.clip_durations.get(s.clip_id)
    if clip and op.length * s.speed > clip + 1e-6:
        raise EditError("The clip does not have enough footage for that length.", code="NOT_ENOUGH_FOOTAGE")
    _apply_length(s, op.length)


def _move(tl: Timeline, op: Move, ctx: OpContext) -> None:
    i = _index(tl, op.segment_id)
    if not 0 <= op.to_index < len(tl.segments):
        raise EditError("That position does not exist.", code="INDEX_OUT_OF_RANGE")
    tl.segments.insert(op.to_index, tl.segments.pop(i))


def _split(tl: Timeline, op: Split, ctx: OpContext) -> None:
    i = _index(tl, op.segment_id)
    s = tl.segments[i]
    if not (s.timeline_start + MIN_SEGMENT <= op.at <= s.timeline_end - MIN_SEGMENT):
        raise EditError("Split inside the shot, at least 0.25s from either end.", code="SPLIT_OUT_OF_RANGE")
    rel = op.at - s.timeline_start
    mid = s.source_start + rel * s.speed
    second = copy.deepcopy(s)
    second.id = new_id()
    second.source_start, second.source_end = mid, s.source_end
    second.timeline_start, second.timeline_end = op.at, s.timeline_end
    second.transition_in = Transition()
    second.effect = "none"
    s.source_end, s.timeline_end = mid, op.at
    tl.segments.insert(i + 1, second)


def _delete(tl: Timeline, op: Delete, ctx: OpContext) -> None:
    i = _index(tl, op.segment_id)
    if len(tl.segments) == 1:
        raise EditError("A Reel needs at least one shot.", code="LAST_SEGMENT")
    tl.segments.pop(i)


def _duplicate(tl: Timeline, op: Duplicate, ctx: OpContext) -> None:
    i = _index(tl, op.segment_id)
    dup = copy.deepcopy(tl.segments[i])
    dup.id = new_id()
    dup.transition_in = Transition()
    tl.segments.insert(i + 1, dup)


def _replace(tl: Timeline, op: Replace, ctx: OpContext) -> None:
    s = tl.segments[_index(tl, op.segment_id)]
    if ctx.clip_durations and op.clip_id not in ctx.clip_durations:
        raise EditError("That clip is not part of this project.", code="CLIP_NOT_FOUND")
    s.clip_id = op.clip_id
    s.video = ctx.clip_names.get(op.clip_id, s.video)
    s.source_start = op.source_start
    s.focus_x = s.focus_y = 0.5
    s.focus_source = "center"
    s.crop = CropSpec()


def _set_speed(tl: Timeline, op: SetSpeed, ctx: OpContext) -> None:
    s = tl.segments[_index(tl, op.segment_id)]
    if not MIN_SPEED <= op.speed <= MAX_SPEED:
        raise EditError(f"Speed must be between {MIN_SPEED:g}x and {MAX_SPEED:g}x.", code="SPEED_OUT_OF_RANGE")
    s.speed = op.speed  # the shot keeps its place on the timeline; the source span adapts


def _set_transition(tl: Timeline, op: SetTransition, ctx: OpContext) -> None:
    i = _index(tl, op.segment_id)
    if op.transition not in TRANSITION_TYPES:
        raise EditError(f"Unknown transition '{op.transition}'.", code="UNKNOWN_TRANSITION",
                        details={"available": list(TRANSITION_TYPES)})  # fmt: skip
    if i == 0 and op.transition != "cut":
        raise EditError("The first shot cannot have an incoming transition.", code="FIRST_SEGMENT_TRANSITION")
    tl.segments[i].transition_in = Transition(type=op.transition, duration=op.duration or 0.3)


def _set_effect(tl: Timeline, op: SetEffect, ctx: OpContext) -> None:
    if op.effect not in EFFECT_TYPES:
        raise EditError(f"Unknown effect '{op.effect}'.", code="UNKNOWN_EFFECT", details={"available": list(EFFECT_TYPES)})
    tl.segments[_index(tl, op.segment_id)].effect = op.effect


def _set_crop(tl: Timeline, op: SetCrop, ctx: OpContext) -> None:
    tl.segments[_index(tl, op.segment_id)].crop = op.crop


def _set_music(tl: Timeline, op: SetMusic, ctx: OpContext) -> None:
    if op.volume is not None:
        tl.music_volume = op.volume
    if op.fade_in is not None:
        tl.music_fade_in = op.fade_in
    if op.fade_out is not None:
        tl.music_fade_out = op.fade_out
    if op.audio_start is not None:
        tl.audio_start = op.audio_start


def _add_caption(tl: Timeline, op: AddCaption, ctx: OpContext) -> None:
    if op.end - op.start < 0.1:
        raise EditError("A caption must last at least 0.1s.", code="CAPTION_TOO_SHORT")
    tl.captions.append(Caption(start=op.start, end=op.end, text=op.text.strip(), words=_words_for(op.text, op.start, op.end)))


def _update_caption(tl: Timeline, op: UpdateCaption, ctx: OpContext) -> None:
    for c in tl.captions:
        if c.id == op.caption_id:
            c.start = c.start if op.start is None else op.start
            c.end = c.end if op.end is None else op.end
            if op.text is not None:
                c.text = op.text.strip()
            c.words = _words_for(c.text, c.start, c.end)  # timing follows the edit
            return
    raise EditError("That caption no longer exists.", code="CAPTION_NOT_FOUND")


def _delete_caption(tl: Timeline, op: DeleteCaption, ctx: OpContext) -> None:
    before = len(tl.captions)
    tl.captions = [c for c in tl.captions if c.id != op.caption_id]
    if len(tl.captions) == before:
        raise EditError("That caption no longer exists.", code="CAPTION_NOT_FOUND")


def _set_caption_style(tl: Timeline, op: SetCaptionStyle, ctx: OpContext) -> None:
    tl.caption_style = op.style


def fit_to_duration(tl: Timeline, target: float, ctx: OpContext) -> None:
    """Shorten or lengthen the Reel to ``target`` seconds while keeping every shot watchable.

    Shorter: trim shots proportionally (never below the minimum); if that is not enough, drop the
    shortest shots. Longer: extend shots that still have footage left.
    """
    relayout(tl)
    if abs(tl.duration - target) < 0.02:
        return
    if tl.duration > target:
        for _ in range(len(tl.segments)):
            excess = tl.duration - target
            room = [max(s.length - MIN_SEGMENT * 2, 0.0) for s in tl.segments]
            if sum(room) >= excess - 1e-6:
                for s, r in zip(tl.segments, room):
                    _apply_length(s, s.length - excess * r / sum(room))
                break
            if len(tl.segments) == 1:
                _apply_length(tl.segments[0], max(target, MIN_SEGMENT))
                break
            tl.segments.pop(min(range(len(tl.segments)), key=lambda k: tl.segments[k].length))
            relayout(tl)
        else:
            raise EditError("Could not fit the Reel to that duration.", code="FIT_FAILED")
    else:
        need = target - tl.duration
        room = []
        for s in tl.segments:
            clip = ctx.clip_durations.get(s.clip_id)
            room.append(max(((clip - s.source_start) / s.speed - s.length) if clip else 0.0, 0.0))
        if sum(room) < need - 1e-6:
            raise EditError(
                "There is not enough footage to make the Reel that long; add clips or lower the duration.",
                code="NOT_ENOUGH_FOOTAGE",
            )
        for s, r in zip(tl.segments, room):
            _apply_length(s, s.length + need * r / sum(room))
    relayout(tl)


def _fit_duration(tl: Timeline, op: FitDuration, ctx: OpContext) -> None:
    fit_to_duration(tl, op.target, ctx)


def _set_voice(tl: Timeline, op: SetVoice, ctx: OpContext) -> None:
    tl.voice = op.voice


def _clear_voice(tl: Timeline, op: ClearVoice, ctx: OpContext) -> None:
    tl.voice = None


def _set_voice_mix(tl: Timeline, op: SetVoiceMix, ctx: OpContext) -> None:
    if tl.voice is None:
        raise EditError("There is no voice-over to adjust.", code="NO_VOICE")
    if op.volume is not None:
        tl.voice.volume = op.volume
    if op.duck_music is not None:
        tl.voice.duck_music = op.duck_music
    if op.start is not None:
        _shift_voice(tl.voice, op.start)


def _shift_voice(v: VoiceTrack, new_start: float) -> None:
    d = new_start - v.start
    v.start = new_start
    for ln in v.lines:
        ln.start, ln.end = round(ln.start + d, 3), round(ln.end + d, 3)


def _set_watermark(tl: Timeline, op: SetWatermark, ctx: OpContext) -> None:
    tl.watermark = op.watermark


def _clear_watermark(tl: Timeline, op: ClearWatermark, ctx: OpContext) -> None:
    tl.watermark = None


def _set_caption_look(tl: Timeline, op: SetCaptionLook, ctx: OpContext) -> None:
    if op.font is not None:
        tl.caption_font = op.font.strip() or None
    if op.color is not None:
        tl.caption_color = op.color or None


def _replace_captions(tl: Timeline, op: ReplaceCaptions, ctx: OpContext) -> None:
    tl.captions = [
        Caption(start=c.start, end=c.end, text=c.text.strip(), words=_words_for(c.text, c.start, c.end))
        for c in op.captions if c.end - c.start >= 0.1 and c.text.strip()
    ]  # fmt: skip


VOICE_LEAD_MIN = 0.0


def _fit_to_voice(tl: Timeline, op: FitToVoice, ctx: OpContext) -> None:
    if tl.voice is None:
        raise EditError("There is no voice-over to fit the Reel to.", code="NO_VOICE")
    fit_to_duration(tl, round(tl.voice.start + tl.voice.duration + op.tail, 3), ctx)


def _set_overlays(tl: Timeline, op: SetOverlays, ctx: OpContext) -> None:
    from app.video.overlays import normalize as tidy_overlays

    tl.overlays, _ = tidy_overlays(op.overlays, tl.duration)


def _set_grade(tl: Timeline, op: SetGrade, ctx: OpContext) -> None:
    from app.video.grades import available

    if op.grade is not None and op.grade not in available():
        raise EditError(f"Unknown colour grade '{op.grade}'.", code="UNKNOWN_GRADE", details={"available": available()})
    tl.color_grade = op.grade


_HANDLERS = {
    Trim: _trim, SetLength: _set_length, Move: _move, Split: _split, Delete: _delete, Duplicate: _duplicate,
    Replace: _replace, SetSpeed: _set_speed, SetTransition: _set_transition, SetEffect: _set_effect,
    SetCrop: _set_crop, SetMusic: _set_music, AddCaption: _add_caption, UpdateCaption: _update_caption,
    DeleteCaption: _delete_caption, SetCaptionStyle: _set_caption_style, FitDuration: _fit_duration,
    SetVoice: _set_voice, ClearVoice: _clear_voice, SetVoiceMix: _set_voice_mix, ReplaceCaptions: _replace_captions,
    FitToVoice: _fit_to_voice, SetWatermark: _set_watermark, ClearWatermark: _clear_watermark,
    SetCaptionLook: _set_caption_look, SetOverlays: _set_overlays, SetGrade: _set_grade,
}  # fmt: skip


def _set_lock(tl: Timeline, op: SetLock, ctx: OpContext) -> None:
    tl.segments[_index(tl, op.segment_id)].locked = op.locked


_HANDLERS[SetLock] = _set_lock


# Hand edits that change a shot itself: the shot is locked so automatic changes never undo the person's choice.
_MANUAL_SHOT_OPS = (Trim, SetLength, Move, Split, Duplicate, Replace, SetSpeed, SetTransition, SetEffect, SetCrop)


def mark_manual(tl: Timeline, ops: list[_Op]) -> Timeline:
    """Lock every shot the person edited by hand (both halves of a split; the copy of a duplicate)."""
    touched = {op.segment_id for op in ops if isinstance(op, _MANUAL_SHOT_OPS)}
    if not touched:
        return tl
    splits = {op.segment_id for op in ops if isinstance(op, (Split, Duplicate))}
    for i, s in enumerate(tl.segments):
        if s.id in touched:
            s.locked = True
            if s.id in splits and i + 1 < len(tl.segments):
                tl.segments[i + 1].locked = True
    return tl


def apply_operations(timeline: Timeline, ops: list[_Op], ctx: OpContext) -> Timeline:
    """Apply ``ops`` in order to a *copy* of the timeline. All-or-nothing: any invalid op raises."""
    tl = timeline.model_copy(deep=True)
    for op in ops:
        _HANDLERS[type(op)](tl, op, ctx)
        relayout(tl)  # later ops see the rippled positions
    return normalize(tl, ctx)


def ensure_ids(doc: dict) -> dict:
    """Timelines saved before segments had ids: give every segment/caption a stable id."""
    for s in doc.get("segments", []):
        s.setdefault("id", new_id())
    for c in doc.get("captions", []):
        c.setdefault("id", new_id())
    return doc
