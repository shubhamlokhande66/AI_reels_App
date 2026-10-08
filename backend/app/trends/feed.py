"""Live trends from a provider's JSON feed (``TREND_FEED_URL``, optional ``TREND_FEED_KEY``), next to the built-in presets.

The feed is any licensed / official trend-data source that returns a list of presets in this shape (extra fields are
ignored, invalid rows are skipped, nothing is scraped):

    [{"id": "slow-luxury-2026", "trendName": "Slow luxury reveal", "recommendedDuration": 15,
      "cutFrequency": "slow", "transitionStyle": "smooth", "captionStyle": "luxury", "description": "..."}]

It is read at most once per ``CACHE_SECONDS``; when it cannot be reached, the built-in presets (and the last good
feed) keep working.
"""

from __future__ import annotations

import logging
import time

import httpx

from app.core.config import get_settings
from app.trends.base import TrendPreset
from app.trends.manual import ManualTrendSource

log = logging.getLogger(__name__)
CACHE_SECONDS = 3600


class FeedTrendSource(ManualTrendSource):
    """The built-in presets plus the live feed (with no feed configured it is exactly the built-in source)."""

    def __init__(self) -> None:
        self._cache: list[TrendPreset] = []
        self._at = 0.0

    def _fetch(self) -> list[TrendPreset]:
        s = get_settings()
        headers = {"Authorization": f"Bearer {s.trend_feed_key.get_secret_value()}"} if s.trend_feed_key.get_secret_value() else {}
        r = httpx.get(s.trend_feed_url, headers=headers, timeout=10)
        r.raise_for_status()
        rows = r.json()
        rows = rows.get("trends", []) if isinstance(rows, dict) else rows
        out = []
        for row in rows if isinstance(rows, list) else []:
            try:
                p = TrendPreset.model_validate(row)
            except ValueError:
                continue  # a bad row never breaks the list
            out.append(p.model_copy(update={"id": f"feed-{p.id}"[:60]}))
        return out[:50]

    def list_trends(self) -> list[TrendPreset]:
        if get_settings().trend_feed_url and time.time() - self._at > CACHE_SECONDS:
            try:
                self._cache = self._fetch()
            except (httpx.HTTPError, ValueError) as exc:
                log.warning("trend feed not reachable, using the last good one: %s", exc)
            self._at = time.time()
        return [*self._cache, *super().list_trends()]
