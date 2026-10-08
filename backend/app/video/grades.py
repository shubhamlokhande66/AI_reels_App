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
    # the editor's filter gallery (every one is a plain FFmpeg filter chain, checked by tests)
    GradePreset("vintage", "Vintage", "nostalgic, throwback, memories", "curves=preset=vintage"),
    GradePreset("black_white", "Black & white", "timeless, dramatic, fashion", "hue=s=0,eq=contrast=1.08"),
    GradePreset("sepia", "Sepia", "old photos, history, heritage", "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"),
    GradePreset("cool", "Cool", "tech, winter, calm blue moods", "colorbalance=rs=-0.05:bs=0.06:rm=-0.03:bm=0.04,eq=saturation=1.02"),
    GradePreset("golden_hour", "Golden hour", "sunsets, travel, romance",
                "colorbalance=rs=0.08:gs=0.03:bs=-0.07:rh=0.05:bh=-0.04,eq=saturation=1.1:brightness=0.02"),
    GradePreset("faded_film", "Faded film", "indie, aesthetic, lifted blacks", "lutrgb=r=val*0.86+18:g=val*0.86+18:b=val*0.86+18,eq=saturation=0.85"),
    GradePreset("noir", "Noir", "mystery, bold black and white", "hue=s=0,eq=contrast=1.35:brightness=-0.03"),
    GradePreset("neon", "Neon", "nightlife, gaming, party", "eq=contrast=1.15:saturation=1.45"),
    GradePreset("retro", "Retro", "70s look, warm and faded", "curves=preset=vintage,eq=saturation=1.1"),
    GradePreset("crisp", "Crisp", "sharp detail, products, food close-ups", "eq=contrast=1.08:saturation=1.05,unsharp=5:5:0.6"),
    GradePreset("dreamy", "Dreamy", "weddings, soft romance", "eq=contrast=0.9:brightness=0.05:saturation=1.08,colorbalance=rh=0.03:bh=0.03"),
    GradePreset("emerald", "Emerald", "nature, forest, fresh", "colorbalance=gs=0.05:gm=0.04:rs=-0.02,eq=saturation=1.05"),
    GradePreset("rose", "Rose", "beauty, fashion, soft pink", "colorbalance=rs=0.04:bs=0.03:rh=0.04,eq=saturation=0.95:brightness=0.02"),
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
