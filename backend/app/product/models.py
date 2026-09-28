"""The data of a product Reel: what is in the photos, and the planned micro-timeline."""

from __future__ import annotations

from typing import Literal

from app.models.base import CamelModel

Purpose = Literal["hook", "curiosity", "reveal", "hero", "detail", "macro", "payoff", "cta"]
Framing = Literal["extreme_close_up", "close_up", "medium", "hero", "detail", "macro"]
CameraType = Literal["push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "drift", "hold"]
TransitionType = Literal["cut", "fade_from_black", "blur", "whip_left", "whip_right", "zoom", "flash", "match", "light", "dissolve", "dip_to_black"]
EffectType = Literal["light_sweep", "sparkle", "glow", "light_leak", "dust", "flash"]
TextAnimation = Literal["fade", "slide_up", "scale", "mask_reveal", "type_on", "blur_sharp"]


class Rect(CamelModel):
    """A rectangle on a photo, in fractions of the photo's width/height."""

    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    def contains(self, px: float, py: float) -> bool:
        return self.x <= px <= self.x + self.w and self.y <= py <= self.y + self.h


class Highlight(CamelModel):
    """A bright, reflective spot on the product (a stone, a glint on metal): the only places sparkles may appear."""

    x: float
    y: float
    strength: float  # 0..1


class Region(CamelModel):
    rect: Rect
    score: float  # how much fine detail it holds
    kind: Literal["detail", "macro"] = "detail"


class ImageUnderstanding(CamelModel):
    """A structured understanding of one photo, made before anything is planned."""

    media_id: str
    name: str = ""
    width: int
    height: int
    subject: Rect  # the primary subject / product
    subject_confidence: float  # 0..1: high on a plain background, low when the picture is busy
    background: Literal["plain", "busy"]
    background_color: str  # #RRGGBB
    dark_background: bool
    palette: list[str] = []  # dominant colours of the product
    regions: list[Region] = []  # where the fine detail is (for close-ups and macro shots), best first
    highlights: list[Highlight] = []  # reflective spots, strongest first
    sharpness: float = 0.0
    notes: list[str] = []


# ------------------------------------------------------------------ the plan
class View(CamelModel):
    """The camera at one moment: where it looks on the photo, how much of it, and a tiny roll.

    ``hh`` is the height of the view as a fraction of the photo's height (1.0 = the photo's full height; above 1 the view
    reaches past the photo's edge, which shows a soft backdrop). The view is always 9:16, so nothing is ever stretched.
    """

    cx: float
    cy: float
    hh: float
    roll: float = 0.0  # degrees; only ever a degree or so (a micro sway, not a 3D orbit)


class CameraMove(CamelModel):
    type: CameraType
    start: View
    end: View
    ease: Literal["in_out", "out", "in", "linear"] = "in_out"


class ShotEffect(CamelModel):
    type: EffectType
    at: float  # seconds from the start of the shot
    duration: float
    strength: float = 0.6
    x: float | None = None  # sparkles: the highlight on the photo (fractions)
    y: float | None = None
    on_beat: bool = False


class ShotTransition(CamelModel):
    type: TransitionType = "cut"
    duration: float = 0.0


class Shot(CamelModel):
    index: int
    start: float
    end: float
    purpose: Purpose
    framing: Framing
    image_index: int  # which photo (index into the plan's images)
    camera: CameraMove
    effects: list[ShotEffect] = []
    transition_in: ShotTransition = ShotTransition()
    beat_time: float | None = None  # the beat this shot starts on
    note: str = ""  # why this shot exists (the director's intent)

    @property
    def length(self) -> float:
        return self.end - self.start


class TextLayer(CamelModel):
    id: str
    text: str
    start: float
    end: float
    x: float = 0.5  # centre, as a fraction of the frame
    y: float = 0.16
    size: float = 0.07  # font height as a fraction of the frame height
    animation_in: TextAnimation = "fade"
    animation_out: Literal["fade", "none"] = "fade"
    role: Literal["hook", "tagline", "cta"] = "hook"


class QualityCheck(CamelModel):
    name: str
    ok: bool
    detail: str = ""


class ProductReelPlan(CamelModel):
    """The internal timeline: every micro-shot, planned before a single frame is made."""

    post_copy: dict | None = None  # title / description / hashtags written by the AI product director

    style: str
    duration: float
    fps: int = 30
    bpm: float = 0.0
    audio_start: float = 0.0
    concept: dict[str, str] = {}  # hook, story, ending
    images: list[str] = []  # media ids, in the order the shots refer to
    shots: list[Shot] = []
    texts: list[TextLayer] = []
    loop: bool = False
    warnings: list[str] = []
    notes: list[str] = []
    quality: list[QualityCheck] = []
