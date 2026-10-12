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


Ease = Literal["linear", "ease_in", "ease_out", "ease_in_out", "hold"]
KEYFRAME_PROPS = ("zoom", "x", "y", "rotation", "opacity", "blur", "brightness", "speed")


class Keyframe(CamelModel):
    """One moment of a shot's animation (video/keyframes.py). Every property is its own track: a keyframe sets only the
    properties it names, and each track moves from one of its keyframes to the next with the easing of the later one.

    - ``zoom``: 1 = the framed picture, 1.2 = 20% closer (1..3)
    - ``x`` / ``y``: where the zoomed window sits, -1 (left / top edge of the picture) .. 1 (right / bottom); 0 = centre.
      Measured in the room the zoom leaves, so the picture's edge never shows
    - ``rotation``: degrees (-20..20); the picture is enlarged just enough that its corners never show
    - ``opacity``: 1 = fully visible, 0 = black
    - ``blur``: 0 = sharp .. 1 = very soft
    - ``brightness``: added light, -0.5 (darker) .. 0.5 (a flash)
    - ``speed``: playback speed (a speed ramp), 0.25 (slow motion) .. 4 (fast); the shot's footage follows it
    - ``ease``: how the tracks arrive at this keyframe: linear, ease_in (slow start), ease_out (slow end), ease_in_out,
      hold (stay at the previous value, then jump here)
    """

    t: float  # seconds into the shot (outside the shot is moved into it by video/keyframes.validate)
    zoom: float | None = None
    x: float | None = None
    y: float | None = None
    rotation: float | None = None
    opacity: float | None = None
    blur: float | None = None
    brightness: float | None = None
    speed: float | None = None
    ease: Ease = "linear"


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
    # keyframe animation of the shot (video/keyframes.py). When it animates zoom / position / rotation it replaces the
    # effect's own movement; ``looks`` are colour looks laid on top (glow, black_white, vignette...), so a look and a
    # movement can be combined
    keyframes: list[Keyframe] = []
    looks: list[str] = []
    focus_x: float = 0.5
    focus_y: float = 0.5
    focus_source: str = "center"  # face | subject | motion | center
    crop: CropSpec = CropSpec()
    volume: float = 1.0  # the clip's own audio (used by "original audio" mode; muted by default)
    transition_in: Transition = Transition()
    caption: str | None = None
    reason: str | None = None  # why the director chose this shot here (shown to the person; never executed)
    # Set when the person edits this shot by hand (timeline_ops.mark_manual). The reviewer, the self-correction loop and
    # AI revisions never change a locked shot unless the person's own request names it.
    locked: bool = False

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


class SoundEffect(CamelModel):
    """A synthesised sound effect on the Reel timeline (audio/sfx.py), placed by the director (director/sfx.py)."""

    type: Literal["whoosh", "impact", "riser", "pop"]
    at: float = Field(ge=0)  # seconds on the Reel timeline where the sound starts
    volume: float = Field(default=0.6, ge=0, le=1)


class AIInfo(CamelModel):
    """Which AI made the creative decisions of this edit (shown as "AI: OpenAI" on the project page)."""

    provider: str
    model: str = ""
    local: bool = True
    tasks: list[str] = []  # e.g. ["clip_understanding", "director", "copy"]
    director: bool = False  # True = the shots were planned by the AI director (validated), not only by the rules
    fallback_used: bool = False


EDL_VERSION = "2.0"  # 2.0 = segments may be locked; brief + creative plan recorded (older timelines validate unchanged)


class Timeline(CamelModel):
    edl_version: str = EDL_VERSION
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
    picture_fade: float | None = None  # fade from / to black at the start / end (s); None = the style's own
    voice: VoiceTrack | None = None
    watermark: Watermark | None = None
    caption_font: str | None = None  # brand override (font family name)
    caption_color: str | None = None  # brand override, #RRGGBB
    color_grade: str | None = None  # a grade preset id (video/grades.py); None = the style's own grade
    overlays: list[TextOverlay] = []  # hook / benefit / CTA text layers
    # seconds INTO THE SONG of its strong hits (so moving the song part keeps them in sync); beat-reactive effects
    # (zoom_pulse, beat_punch, beat_flash) follow them
    music_hits: list[float] = []
    sfx: list[SoundEffect] = []  # sound effects mixed under the music (empty = none)
    ai: AIInfo | None = None
    # The Creative Director's decisions for this edit (director/brief.py, director/creative.py); informational,
    # never executed: the segments above are what renders.
    brief: dict | None = None
    creative_plan: dict | None = None
    warnings: list[str] = []
    notes: list[str] = []  # informational, e.g. why the AI picked a style

    @property
    def total_segment_duration(self) -> float:
        return sum(s.timeline_end - s.timeline_start for s in self.segments)
