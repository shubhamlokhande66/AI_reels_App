"""Trend Mode.

A ``TrendPreset`` is structured trend information (name, pacing, transition feel, caption style,
recommended length). The editing engine turns it into style overrides; nothing here scrapes any
platform. Trends are meant to come from a legitimate source through the ``TrendSource`` interface.

MVP: presets are configured manually (``ManualTrendSource``).
TODO: a ``TrendSource`` backed by an official API / licensed data provider.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal

from app.models.base import CamelModel
from app.styles.base import EditingStyle

CutFrequency = Literal["fast", "medium", "slow"]
TransitionFeel = Literal["smooth", "punchy", "minimal"]


class TrendPreset(CamelModel):
    id: str
    trend_name: str
    recommended_duration: int
    cut_frequency: CutFrequency
    transition_style: TransitionFeel
    caption_style: str = "minimal"
    description: str = ""


class TrendSource(ABC):
    @abstractmethod
    def list_trends(self) -> list[TrendPreset]: ...

    def get(self, trend_id: str) -> TrendPreset | None:
        return next((t for t in self.list_trends() if t.id == trend_id), None)


@dataclass(frozen=True)
class _Pace:
    beats_high: int
    beats_low: int
    min_segment: float
    max_segment: float


PACE: dict[str, _Pace] = {
    "fast": _Pace(1, 2, 0.35, 2.5),
    "medium": _Pace(2, 4, 0.8, 4.0),
    "slow": _Pace(4, 8, 1.6, 6.0),
}

FEEL: dict[str, tuple[dict[str, float], float]] = {
    "smooth": ({"cut": 0.2, "dissolve": 0.4, "fade": 0.2, "blur": 0.1, "zoom": 0.1}, 0.45),
    "punchy": ({"cut": 0.6, "flash": 0.15, "zoom": 0.15, "slide": 0.1}, 0.12),
    "minimal": ({"cut": 1.0}, 0.1),
}


def apply_trend(style: EditingStyle, trend: TrendPreset) -> EditingStyle:
    """Overlay a trend on a base style: pacing and transition feel come from the trend."""
    pace = PACE[trend.cut_frequency]
    transitions, duration = FEEL[trend.transition_style]
    return style.with_overrides(
        cut_beats_high=pace.beats_high,
        cut_beats_low=pace.beats_low,
        min_segment=pace.min_segment,
        max_segment=pace.max_segment,
        transitions=dict(transitions),
        transition_duration=duration,
        max_transition_ratio=0.9 if trend.transition_style == "smooth" else style.max_transition_ratio,
        caption_style=trend.caption_style,
    )
