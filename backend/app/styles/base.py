"""Editing style definitions. A style is pure data: the timeline builder and composer read it.

Adding a style = registering a new ``EditingStyle``; the rendering engine is not touched.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Literal

from app.core.errors import ValidationFailed

CutPace = Literal["fast", "medium", "slow"]


@dataclass(frozen=True)
class EditingStyle:
    id: str
    name: str
    description: str

    # Pacing: how many beats each shot lasts, in high- and low-energy music.
    cut_beats_high: int = 2
    cut_beats_low: int = 4
    min_segment: float = 0.5  # seconds
    max_segment: float = 4.0

    # Transition weights (chosen deterministically per boundary). "cut" should dominate.
    transitions: dict[str, float] = field(default_factory=lambda: {"cut": 1.0})
    transition_duration: float = 0.2
    max_transition_ratio: float = 0.5  # at most this share of boundaries are non-cut

    # Per-shot effects (weights).
    effects: dict[str, float] = field(default_factory=lambda: {"none": 1.0})
    slow_motion_chance: float = 0.0
    slow_motion_speed: float = 0.5

    # -1 = prefer steady shots everywhere, +1 = prefer high motion on strong beats.
    motion_preference: float = 0.5
    # Narrative structure hooks (proxy heuristics until vision AI can recognise content).
    opening: Literal["establishing"] | None = None
    closing: Literal["reveal"] | None = None
    prefer_landscape: bool = False

    grade_filter: str | None = None  # extra FFmpeg video filter (colour grade)
    caption_style: str = "minimal"
    audio_fade_in: float = 0.3
    audio_fade_out: float = 1.0
    fade_in_out: float = 0.0  # visual fade from/to black at start/end (seconds)
    # Answer strong drum hits that fall inside a long shot with a quick punch on the beat (the footage keeps playing).
    # Off for the calm, elegant styles, where a jolt would be out of place.
    accent_hits: bool = True
    # Cut like the part of the song it is (intro/outro breathe, a drop tightens). Off when a learned trend sets the
    # rhythm: its measured loud / calm shot lengths already say how it cuts in each part.
    section_pacing: bool = True
    # Creative priorities (the same footage gives a meaningfully different edit per mode):
    hook_priority: float = 0.3  # how hard the opening is chosen for hook strength (viral = strongest)
    subject_priority: float = 0.0  # favour clear subjects / products / faces over general footage (product focus)
    shake_tolerance: float = 0.0  # 0 = shaky footage is penalised as usual, 1 = handheld energy is welcome (social native)

    def with_overrides(self, **overrides) -> "EditingStyle":
        return replace(self, **overrides)


_REGISTRY: dict[str, EditingStyle] = {}


def register_style(style: EditingStyle) -> EditingStyle:
    _REGISTRY[style.id] = style
    return style


def get_style(style_id: str) -> EditingStyle:
    try:
        return _REGISTRY[style_id]
    except KeyError:
        raise ValidationFailed(
            f"Unknown style '{style_id}'.",
            code="UNKNOWN_STYLE",
            details={"available": sorted(_REGISTRY)},
        ) from None


AUTO_STYLE = "auto"  # resolved per render (AI choice, or a tempo/motion heuristic as fallback)


def validate_style_id(style_id: str) -> str:
    """Accept any registered style or 'auto'."""
    if style_id != AUTO_STYLE:
        get_style(style_id)
    return style_id


def list_styles() -> list[EditingStyle]:
    return list(_REGISTRY.values())
