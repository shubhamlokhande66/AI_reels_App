"""Colour-grade presets. Deterministic: the AI (or the user) picks a preset *id*; the FFmpeg filter is built here.

A Reel with no grade chosen keeps its editing style's own grade, exactly as before.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class GradePreset:
    id: str
    label: str
    hint: str  # when to use it (sent to the AI)
    filter: str | None  # FFmpeg video filter chain; None = no grade


_PRESETS: dict[str, GradePreset] = {g.id: g for g in (
    GradePreset("natural", "Natural", "true-to-life colour, any content", "eq=contrast=1.02:saturation=1.03"),
    GradePreset("clean", "Clean", "bright, crisp product and tutorial footage", "eq=contrast=1.05:brightness=0.015:saturation=1.0,unsharp=5:5:0.35"),
    GradePreset("warm", "Warm", "food, lifestyle, golden-hour, cosy moods",
                "colorbalance=rs=0.05:gs=0.01:bs=-0.05:rm=0.03:bm=-0.03,eq=saturation=1.08"),
    GradePreset("cinematic", "Cinematic", "story-driven, travel, dramatic moods (teal shadows, warm highlights)",
                "eq=contrast=1.08:saturation=0.9,colorbalance=rs=-0.03:bs=0.04:rh=0.04:bh=-0.03"),
    GradePreset("luxury", "Luxury", "jewellery, fashion, premium products: deep contrast, warm highlights, soft vignette",
                "eq=contrast=1.1:saturation=0.95:brightness=-0.01,colorbalance=rh=0.04:gh=0.02:bh=-0.02,vignette=angle=PI/5"),
    GradePreset("high_contrast", "High contrast", "energetic, sports, bold trending edits", "eq=contrast=1.2:saturation=1.1"),
    GradePreset("soft", "Soft", "calm, beauty, wellness: lifted and gentle", "eq=contrast=0.94:saturation=0.9:brightness=0.02"),
)}  # fmt: skip

_ALIASES = {"teal_orange": "cinematic", "film": "cinematic", "moody": "cinematic", "golden": "warm", "vibrant": "high_contrast",
            "punchy": "high_contrast", "premium": "luxury", "elegant": "luxury", "bright": "clean", "pastel": "soft", "none": "natural"}  # fmt: skip


def available() -> list[str]:
    return list(_PRESETS)


def catalogue() -> dict[str, str]:
    return {g.id: g.hint for g in _PRESETS.values()}


def get_grade(grade_id: str | None) -> GradePreset | None:
    return _PRESETS.get(grade_id or "")


def resolve_grade(name: str | None) -> str | None:
    """A free-form grade name -> a preset id (None = keep the style's own grade)."""
    n = str(name or "").strip().lower().replace(" ", "_").replace("-", "_")
    if not n:
        return None
    if n in _PRESETS:
        return n
    return _ALIASES.get(n)


def grade_filter(grade_id: str | None, style_default: str | None) -> str | None:
    g = get_grade(grade_id)
    return g.filter if g is not None else style_default
