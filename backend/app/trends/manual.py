"""Manually configured trend presets (MVP). Edit this list to add your own."""

from __future__ import annotations

from app.trends.base import TrendPreset, TrendSource

PRESETS: list[TrendPreset] = [
    TrendPreset(
        id="fast_luxury_product", trend_name="Fast Luxury Product Reel", recommended_duration=15,
        cut_frequency="fast", transition_style="smooth", caption_style="minimal",
        description="Quick cuts with smooth, premium transitions - great for product drops.",
    ),
    TrendPreset(
        id="beat_drop_hype", trend_name="Beat-Drop Hype", recommended_duration=15,
        cut_frequency="fast", transition_style="punchy", caption_style="bold",
        description="Hard cuts, flashes and zoom punches locked to the beat.",
    ),
    TrendPreset(
        id="cinematic_story", trend_name="Cinematic Story", recommended_duration=30,
        cut_frequency="slow", transition_style="smooth", caption_style="luxury",
        description="Long, patient shots with slow dissolves.",
    ),
    TrendPreset(
        id="quick_recipe", trend_name="Quick Recipe", recommended_duration=30,
        cut_frequency="medium", transition_style="punchy", caption_style="highlight",
        description="Steady pacing that follows the steps of a dish.",
    ),
    TrendPreset(
        id="calm_lifestyle", trend_name="Calm Lifestyle", recommended_duration=30,
        cut_frequency="medium", transition_style="minimal", caption_style="minimal",
        description="Relaxed pacing with clean cuts and no effects.",
    ),
]  # fmt: skip


class ManualTrendSource(TrendSource):
    def list_trends(self) -> list[TrendPreset]:
        return list(PRESETS)


_source: TrendSource | None = None


def get_trend_source() -> TrendSource:
    """The built-in presets, plus a live feed when TREND_FEED_URL is set (trends/feed.py)."""
    global _source
    if _source is None:
        from app.trends.feed import FeedTrendSource

        _source = FeedTrendSource()
    return _source


def set_trend_source(source: TrendSource | None) -> None:
    global _source
    _source = source
