"""Turn project settings into the EditingStyle used for one render."""

from __future__ import annotations

from app.schemas.project import ProjectSettings
from app.core.errors import ValidationFailed
from app.styles.base import EditingStyle, get_style

_CUSTOM_FIELDS = (
    "cut_beats_high", "cut_beats_low", "min_segment", "max_segment",
    "transition_duration", "slow_motion_chance",
)  # fmt: skip


def resolve_style(settings: ProjectSettings, style_id: str | None = None) -> EditingStyle:
    """``style_id`` overrides settings.style (used to resolve "auto" before rendering)."""
    style = get_style(style_id or settings.style)
    cs = settings.custom_style
    if style.id == "custom" and cs is not None:
        over: dict = {f: getattr(cs, f) for f in _CUSTOM_FIELDS if getattr(cs, f) is not None}
        if cs.transitions:
            over["transitions"] = {k: v for k, v in cs.transitions.items() if v >= 0} or style.transitions
        if cs.effects:
            over["effects"] = {k: v for k, v in cs.effects.items() if v >= 0} or style.effects
        style = style.with_overrides(**over)
        if style.max_segment < style.min_segment:
            style = style.with_overrides(max_segment=style.min_segment)
    if settings.trend_id:
        from app.trends.base import apply_trend
        from app.trends.manual import get_trend_source

        trend = get_trend_source().get(settings.trend_id)
        if trend is None:
            raise ValidationFailed(f"Unknown trend '{settings.trend_id}'.", code="UNKNOWN_TREND")
        style = apply_trend(style, trend)
    return apply_pace(style, settings.pace)


# (beats multiplier, min-shot multiplier, max-shot multiplier)
PACE_FACTORS = {"calm": (2.0, 1.7, 1.4), "balanced": (1.0, 1.0, 1.0), "fast": (0.5, 0.6, 0.8)}  # "auto": the AI decides; rules use balanced


def apply_pace(style: EditingStyle, pace: str) -> EditingStyle:
    """Scale the style's cutting speed. 'balanced' leaves the style untouched."""
    beats, lo, hi = PACE_FACTORS.get(pace, PACE_FACTORS["balanced"])
    if (beats, lo, hi) == (1.0, 1.0, 1.0):
        return style
    return style.with_overrides(
        cut_beats_high=max(1, round(style.cut_beats_high * beats)),
        cut_beats_low=max(1, round(style.cut_beats_low * beats)),
        min_segment=round(style.min_segment * lo, 3),
        max_segment=round(style.max_segment * hi, 3),
    )
