"""Variation strategies: each version of a Reel is a different *editing strategy*, not a reshuffle.

A strategy changes the style (pacing, transitions, effects, slow-motion), the pace, how clips are ordered
(best-first vs. the order you shot them) and the caption look. New strategies are one entry here.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.errors import ValidationFailed


@dataclass(frozen=True)
class Strategy:
    id: str
    label: str
    description: str
    style: str
    pace: str = "balanced"
    caption_style: str = "minimal"
    order: str = "quality"  # quality = best shots first | chronological = the order the clips were uploaded (a story)


STRATEGIES: dict[str, Strategy] = {
    s.id: s
    for s in (
        Strategy("fast_trending", "Fast + Trending", "Quick beat-synced cuts, punchy zooms.", "fast_trending", "balanced", "bold"),
        Strategy("cinematic", "Cinematic", "Longer shots, slow fades, slow motion.", "cinematic", "balanced", "minimal"),
        Strategy("storytelling", "Storytelling", "Clips in the order you shot them: opening, journey, reveal.", "storytelling",
                 "balanced", "highlight", order="chronological"),  # fmt: skip
        Strategy("luxury", "Luxury", "Elegant, slow and premium.", "luxury", "balanced", "luxury"),
        Strategy("minimal", "Minimal", "Plain cuts and no effects; the footage speaks.", "minimal", "balanced", "minimal"),
    )
}
DEFAULT_SET = ("fast_trending", "cinematic", "storytelling", "luxury", "minimal")
LETTERS = "ABCDEFGH"


def get_strategy(strategy_id: str) -> Strategy:
    try:
        return STRATEGIES[strategy_id]
    except KeyError:
        raise ValidationFailed(f"Unknown strategy '{strategy_id}'.", code="UNKNOWN_STRATEGY",
                               details={"available": list(STRATEGIES)}) from None  # fmt: skip


def version_label(index: int, strategy: Strategy) -> str:
    return f"Version {LETTERS[index % len(LETTERS)]}: {strategy.label}"


def chronological_hint(clip_ids: list[str]) -> dict[str, float]:
    """Order hint that keeps clips in upload order across the Reel (0 = first, 1 = last)."""
    n = max(len(clip_ids) - 1, 1)
    return {cid: i / n for i, cid in enumerate(clip_ids)}
