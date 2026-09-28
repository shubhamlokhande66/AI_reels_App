"""Timeline = the Edit Decision List (EDL): the single, editable source of truth for a Reel.

Originals are never modified. The renderer reads source files and applies these instructions;
a human or the AI edits the instructions (see ``video/timeline_ops.py``), then re-renders.
"""

from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import Field

from app.models.base import CamelModel
from app.video.effects import available as _available_effects
from app.video.transitions import available as _available_transitions

TRANSITION_TYPES = tuple(_available_transitions())  # the transition registry is the single source of truth
EFFECT_TYPES = tuple(_available_effects())  # the effect registry (video/effects.py) is the single source of truth


def new_id() -> str:
    return uuid4().hex[:12]


class Transition(CamelModel):
    """How a segment is entered from the previous one. ``cut`` has zero duration."""

    type: str = "cut"
    duration: float = 0.0


class CropSpec(CamelModel):
    """Per-shot framing override. ``auto`` lets the renderer choose fill vs fit."""

    framing: Literal["auto", "fill", "fit"] = "auto"
    focus_x: float | None = Field(default=None, ge=0, le=1)  # manual subject position (fill mode)
    focus_y: float | None = Field(default=None, ge=0, le=1)


class Segment(CamelModel):
    id: str = Field(default_factory=new_id)
    clip_id: str
    video: str  # display file name of the source clip
    source_start: float
    source_end: float
    timeline_start: float
    timeline_end: float
    speed: float = 1.0  # <1 = slow motion. source span = timeline span * speed
    effect: str = "none"
    focus_x: float = 0.5
    focus_y: float = 0.5
    focus_source: str = "center"  # face | subject | motion | center
    crop: CropSpec = CropSpec()
    volume: float = 1.0  # the clip's own audio (used by "original audio" mode; muted by default)
    transition_in: Transition = Transition()
    caption: str | None = None

    @property
    def length(self) -> float:
        return self.timeline_end - self.timeline_start


class CaptionWord(CamelModel):
    text: str
    start: float  # seconds on the reel timeline
    end: float


class Caption(CamelModel):
    """One caption cue on the text track. Editing ``text`` regenerates word timing evenly."""

    id: str = Field(default_factory=new_id)
    start: float
    end: float
    text: str
    words: list[CaptionWord] = []


class VoiceLine(CamelModel):
    text: str
    start: float  # seconds on the reel timeline
    end: float


class VoiceTrack(CamelModel):
    """A synthesised voice-over. The audio file is generated from the script; the timeline stores instructions."""

    file_key: str  # storage key of the WAV
    duration: float
    start: float = 0.3  # lead-in before the voice begins
    volume: float = Field(default=1.0, ge=0, le=2)
    duck_music: bool = True  # music dips under the voice and recovers after
    lines: list[VoiceLine] = []
    profile_name: str = ""
    language: str = "en"


class Watermark(CamelModel):
    """A brand logo burned into every frame (never modifies the logo file)."""

    logo_key: str
    position: Literal["br", "bl", "tr", "tl", "center"] = "br"
    opacity: float = Field(default=0.85, ge=0.05, le=1)
    scale: float = Field(default=0.16, ge=0.04, le=0.6)  # logo width as a share of the video width


OVERLAY_ROLES = ("hook", "benefit", "product", "emotion", "cta", "text")
OVERLAY_POSITIONS = ("top", "center", "bottom")
OVERLAY_ANIMATIONS = ("fade", "slide_up", "scale", "type_on", "blur_sharp", "mask_reveal")
OVERLAY_MAX_CHARS = 42
OVERLAY_MAX_WORDS = 7


class TextOverlay(CamelModel):
    """A short on-screen text (hook, benefit, product name, CTA ...), independent of captions. Rendered by libass inside
    the Reels safe area; the text is data, never markup."""

    id: str = Field(default_factory=new_id)
    text: str = Field(max_length=OVERLAY_MAX_CHARS)
    start: float = Field(ge=0)
    end: float = Field(ge=0)
    role: Literal["hook", "benefit", "product", "emotion", "cta", "text"] = "text"
    position: Literal["top", "center", "bottom"] = "top"
    animation: Literal["fade", "slide_up", "scale", "type_on", "blur_sharp", "mask_reveal"] = "fade"
    size: Literal["small", "medium", "large"] = "medium"


class AIInfo(CamelModel):
    """Which AI made the creative decisions of this edit (shown as "AI: OpenAI" on the project page)."""

    provider: str
    model: str = ""
    local: bool = True
    tasks: list[str] = []  # e.g. ["clip_understanding", "director", "copy"]
    director: bool = False  # True = the shots were planned by the AI director (validated), not only by the rules
    fallback_used: bool = False


class Timeline(CamelModel):
    duration: float
    bpm: float = 0.0
    audio_start: float = 0.0  # offset into the music where the reel begins
    style: str = "fast_trending"
    segments: list[Segment]
    captions: list[Caption] = []
    caption_style: str = "minimal"
    music_volume: float = 1.0
    music_fade_in: float | None = None  # None = the style's default
    music_fade_out: float | None = None
    voice: VoiceTrack | None = None
    watermark: Watermark | None = None
    caption_font: str | None = None  # brand override (font family name)
    caption_color: str | None = None  # brand override, #RRGGBB
    color_grade: str | None = None  # a grade preset id (video/grades.py); None = the style's own grade
    overlays: list[TextOverlay] = []  # hook / benefit / CTA text layers
    # seconds INTO THE SONG of its strong hits (so moving the song part keeps them in sync); beat-reactive effects
    # (zoom_pulse, beat_punch, beat_flash) follow them
    music_hits: list[float] = []
    ai: AIInfo | None = None
    warnings: list[str] = []
    notes: list[str] = []  # informational, e.g. why the AI picked a style

    @property
    def total_segment_duration(self) -> float:
        return sum(s.timeline_end - s.timeline_start for s in self.segments)
