"""AI usage log and budget.

One record per provider call: provider, model, task, project, time, latency, success, tokens, estimated cost, whether
a fallback was used, and the error code. API keys are never recorded. Records go to the ``ai_usage`` MongoDB
collection through a small synchronous client (the AI runs in worker threads), written in the background so logging
never slows or breaks an AI call.
"""

from __future__ import annotations

import logging
import threading
import time
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from typing import Any, Iterator

from app.core.config import get_settings

log = logging.getLogger(__name__)
_project: ContextVar[str | None] = ContextVar("ai_project", default=None)


@contextmanager
def ai_context(project_id: str | None) -> Iterator[None]:
    """AI calls made inside this block are logged against ``project_id``."""
    token = _project.set(project_id)
    try:
        yield
    finally:
        _project.reset(token)


def current_project() -> str | None:
    return _project.get()


class UsageStore(ABC):
    @abstractmethod
    def record(self, doc: dict[str, Any]) -> None: ...

    @abstractmethod
    def rows_since(self, since: datetime) -> list[dict[str, Any]]: ...


class MemoryUsageStore(UsageStore):
    """In-process store (tests, or when MongoDB is unreachable)."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def record(self, doc: dict[str, Any]) -> None:
        with self._lock:
            self.rows.append(dict(doc))

    def rows_since(self, since: datetime) -> list[dict[str, Any]]:
        with self._lock:
            return [r for r in self.rows if r["ts"] >= since]


class MongoUsageStore(UsageStore):
    def __init__(self) -> None:
        self._coll = None
        self._pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ai-usage")
        self._lock = threading.Lock()

    def _collection(self):
        with self._lock:
            if self._coll is None:
                from pymongo import MongoClient

                s = get_settings()
                client = MongoClient(s.mongodb_uri, serverSelectionTimeoutMS=1500, tz_aware=True)
                self._coll = client[s.mongodb_db]["ai_usage"]
                try:
                    self._coll.create_index("ts")
                except Exception:  # noqa: BLE001 - the index is an optimisation
                    pass
            return self._coll

    def record(self, doc: dict[str, Any]) -> None:
        def write() -> None:
            try:
                self._collection().insert_one(dict(doc))
            except Exception as exc:  # noqa: BLE001 - logging must never break AI
                log.warning("could not write the AI usage log: %s", type(exc).__name__)

        self._pool.submit(write)

    def rows_since(self, since: datetime) -> list[dict[str, Any]]:
        try:
            return list(self._collection().find({"ts": {"$gte": since}}, {"_id": 0}))
        except Exception as exc:  # noqa: BLE001
            log.warning("could not read the AI usage log: %s", type(exc).__name__)
            return []


_store: UsageStore | None = None
_spend_cache: tuple[float, dict[str, float]] | None = None
SPEND_TTL = 20.0


def get_usage_store() -> UsageStore:
    global _store
    if _store is None:
        _store = MongoUsageStore()
    return _store


def set_usage_store(store: UsageStore | None) -> None:
    global _store, _spend_cache
    _store = store
    _spend_cache = None


def record_call(*, provider: str, model: str, task: str, ok: bool, latency_ms: int, input_tokens: int | None = None,
                output_tokens: int | None = None, cached_tokens: int | None = None, cost: float | None = None,
                fallback_used: bool = False, error_code: str | None = None, request_id: str | None = None) -> None:  # fmt: skip
    global _spend_cache
    doc = {
        "ts": datetime.now(timezone.utc), "provider": provider, "model": model, "task": task, "projectId": current_project(),
        "ok": ok, "latencyMs": latency_ms, "inputTokens": input_tokens, "outputTokens": output_tokens,
        "cachedTokens": cached_tokens, "cost": cost, "fallbackUsed": fallback_used, "errorCode": error_code,
        "requestId": request_id,
    }  # fmt: skip
    try:
        get_usage_store().record(doc)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not record AI usage: %s", type(exc).__name__)
    if cost:
        _spend_cache = None


# ---------------------------------------------------------------------- periods + summaries
def _starts(now: datetime | None = None) -> dict[str, datetime]:
    """Local-time period starts (today, this week from Monday, this month), as UTC datetimes."""
    local = (now or datetime.now(timezone.utc)).astimezone()
    day = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return {
        "today": day.astimezone(timezone.utc),
        "week": (day - timedelta(days=day.weekday())).astimezone(timezone.utc),
        "month": day.replace(day=1).astimezone(timezone.utc),
    }


def _aggregate(rows: list[dict[str, Any]]) -> dict[str, Any]:
    from app.ai.pricing import to_display

    by: dict[str, dict[str, Any]] = {}
    total_cost = 0.0
    priced = True
    for r in rows:
        p = by.setdefault(r.get("provider") or "?", {"calls": 0, "ok": 0, "failed": 0, "cost": 0.0})
        p["calls"] += 1
        p["ok" if r.get("ok") else "failed"] += 1
        if r.get("cost") is None and r.get("ok") and r.get("provider") != "ollama":
            priced = False
        c = float(r.get("cost") or 0.0)
        p["cost"] += c
        total_cost += c
    return {
        "calls": len(rows), "ok": sum(1 for r in rows if r.get("ok")), "failed": sum(1 for r in rows if not r.get("ok")),
        "fallbacks": sum(1 for r in rows if r.get("fallbackUsed")), "cost": to_display(total_cost), "allPriced": priced,
        "providers": [{"provider": k, **v, "cost": to_display(v["cost"])} for k, v in sorted(by.items())],
    }  # fmt: skip


def summary(now: datetime | None = None) -> dict[str, Any]:
    starts = _starts(now)
    rows = get_usage_store().rows_since(starts["month"] if starts["month"] < starts["week"] else starts["week"])
    return {name: _aggregate([r for r in rows if r["ts"] >= since]) for name, since in starts.items()} | {
        "currency": get_settings().ai_currency}


def spent() -> dict[str, float]:
    """{"today": x, "month": y} in the display currency (cached for a few seconds)."""
    global _spend_cache
    if _spend_cache and time.monotonic() - _spend_cache[0] < SPEND_TTL:
        return _spend_cache[1]
    s = summary()
    out = {"today": float(s["today"]["cost"] or 0.0), "month": float(s["month"]["cost"] or 0.0)}
    _spend_cache = (time.monotonic(), out)
    return out


def budget_state(cfg) -> dict[str, Any]:
    """Whether a budget is used up. ``cfg`` is an ``EffectiveAIConfig``."""
    if not cfg.daily_budget and not cfg.monthly_budget:
        return {"exceeded": False, "reason": None, "dailySpent": None, "monthlySpent": None}
    sp = spent()
    reason = None
    if cfg.daily_budget and sp["today"] >= cfg.daily_budget:
        reason = "today's AI budget is used up"
    elif cfg.monthly_budget and sp["month"] >= cfg.monthly_budget:
        reason = "this month's AI budget is used up"
    return {"exceeded": reason is not None, "reason": reason, "dailySpent": sp["today"], "monthlySpent": sp["month"]}
