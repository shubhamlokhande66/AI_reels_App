"""Small in-process sliding-window rate limiter (per client IP + bucket).

Good enough for a single-process MVP. TODO: move to Redis when running several workers.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import Request

from app.core.config import get_settings
from app.core.errors import RateLimited

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def reset() -> None:
    _hits.clear()


def rate_limit(bucket: str, per_minute: int | None = None):
    async def dependency(request: Request) -> None:
        limit = per_minute or get_settings().rate_limit_per_minute
        client = request.client.host if request.client else "unknown"
        now = time.monotonic()
        q = _hits[(client, bucket)]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            raise RateLimited(
                "Too many requests. Please slow down.",
                details={"retryAfterSeconds": int(60 - (now - q[0])) + 1},
            )
        q.append(now)

    return dependency
