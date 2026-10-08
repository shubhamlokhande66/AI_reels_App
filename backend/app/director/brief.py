"""The project brief (the Producer): who the Reel is for, what it must achieve and how it should feel, before any edit.

Nothing here asks the person to fill a form. Every field comes from what they already gave (settings, the brief text,
the brand) or is inferred from what the clips show (the vision model's category), and the brief says which fields were
inferred, so the Creative Director treats them as defaults, not orders.
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any, Iterable

from app.models.base import CamelModel

PLATFORMS = {
    "instagram_reel": "instagram_reels", "youtube_short": "youtube_shorts", "tiktok": "tiktok",
    "instagram_story": "instagram_stories", "instagram_post": "instagram_feed",
}  # fmt: skip
OBJECTIVES = {
    "product": "product_showcase", "jewelry": "product_showcase", "fashion": "product_showcase", "beauty": "product_showcase",
    "food": "food_showcase", "travel": "travel_story", "fitness": "motivation", "event": "event_highlights",
    "education": "tutorial", "tutorial": "tutorial", "lifestyle": "storytelling", "story": "storytelling",
}  # fmt: skip
DEFAULT_CTA = {
    "product_showcase": "Shop now", "food_showcase": "Save this recipe", "travel_story": "Save for your next trip",
    "tutorial": "Follow for more", "motivation": "Follow for more", "event_highlights": "See you next time",
}  # fmt: skip
STYLE_TONE = {
    "luxury": "premium", "cinematic": "cinematic", "viral": "bold", "energetic": "energetic", "minimal": "calm",
    "storytelling": "warm", "product_focus": "clear", "social_native": "casual", "fast_trending": "upbeat",
}  # fmt: skip
# words in the person's brief that name a style
STYLE_WORDS = {
    "luxury": ("luxury", "luxurious", "premium", "elegant", "high-end", "high end"), "cinematic": ("cinematic", "film", "movie"),
    "viral": ("viral", "trending", "tiktok"), "energetic": ("energetic", "hype", "high energy"), "minimal": ("minimal", "clean", "simple"),
    "storytelling": ("story", "journey"),
}  # fmt: skip
_AUDIENCE = re.compile(r"\bfor\s+((?:young|new|busy|working|first[- ]time|older)?\s*"
                       r"(?:women|men|girls|boys|moms|mums|dads|parents|students|kids|teens|brides|couples|travell?ers|foodies|"
                       r"gamers|professionals|athletes|customers|shoppers|families|creators))\b", re.I)  # fmt: skip


class ProjectBrief(CamelModel):
    platform: str = "instagram_reels"
    duration: float = 15.0
    objective: str = "engagement"
    content_type: str = "other"
    audience: str = "general"
    style: str = "auto"
    tone: str = "neutral"
    cta: str = ""
    brand: str = ""
    language: str = "en"
    notes: str = ""  # the person's own words (settings.brief)
    inferred: list[str] = []  # fields the app guessed (not given by the person)

    def for_ai(self) -> dict[str, Any]:
        d = self.model_dump(exclude={"notes"})
        d["inferred"] = list(self.inferred)
        return d


def _category(categories: Iterable[str | None]) -> str:
    counts = Counter(c for c in categories if c and c != "other")
    return counts.most_common(1)[0][0] if counts else "other"


def _style_from_words(text: str) -> str | None:
    low = text.lower()
    for style, words in STYLE_WORDS.items():
        if any(re.search(rf"\b{re.escape(w)}\b", low) for w in words):
            return style
    return None


def infer_brief(settings, brand: dict | None = None, categories: Iterable[str | None] = (), style_used: str | None = None) -> ProjectBrief:
    """``settings``: ProjectSettings. ``brand``: the brand document (camelCase keys) or None. ``categories``: what the vision
    model says each clip is. ``style_used``: the style the edit resolved to (when the person left it on auto)."""
    brand = brand or {}
    inferred: list[str] = []
    text = settings.brief or ""
    content = _category(categories)
    if content == "other" and text:
        for cat in OBJECTIVES:
            if re.search(rf"\b{cat}\b", text.lower()):
                content = cat
                break
    objective = getattr(settings, "objective", "") or OBJECTIVES.get(content, "engagement")
    if not getattr(settings, "objective", ""):
        inferred.append("objective")
    m = _AUDIENCE.search(text)
    audience = getattr(settings, "audience", "") or (re.sub(r"\s+", "_", m.group(1).strip().lower()) if m else "general")
    if not getattr(settings, "audience", "") and not m:
        inferred.append("audience")
    style = settings.style if settings.style not in ("auto", "custom") else ""
    style = style or _style_from_words(text) or brand.get("visualStyle") or brand.get("style") or style_used or "auto"
    if settings.style in ("auto", "custom") and not _style_from_words(text) and not brand.get("visualStyle"):
        inferred.append("style")
    style = "auto" if style == "auto" else style
    cta = settings.cta_text or brand.get("cta") or DEFAULT_CTA.get(objective, "")
    if not settings.cta_text and not brand.get("cta"):
        inferred.append("cta")
    tone = brand.get("scriptTone") or brand.get("tone") or STYLE_TONE.get(style, "neutral")
    if not (brand.get("scriptTone") or brand.get("tone")):
        inferred.append("tone")
    return ProjectBrief(
        platform=PLATFORMS.get(settings.export_preset, settings.export_preset), duration=float(settings.duration),
        objective=objective, content_type=content, audience=audience, style=style, tone=tone, cta=cta,
        brand=brand.get("name", ""), language=settings.language, notes=text[:300], inferred=inferred,
    )  # fmt: skip
