"""Estimated cost of an AI call, from prices *you* configure (``AI_MODEL_PRICES``). Nothing is guessed.

``AI_MODEL_PRICES`` is JSON: {"<model or model prefix>": {"input": USD per 1M tokens, "output": ..., "cached": ...}}.
The longest matching prefix wins, so one entry can cover a model family. A model with no price gives ``None``
("not priced"), never a made-up number. Costs are kept in USD and shown in ``AI_CURRENCY`` (x ``AI_CURRENCY_RATE``).
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache

from app.core.config import get_settings

log = logging.getLogger(__name__)


@lru_cache(maxsize=4)
def _prices(raw: str) -> dict[str, dict[str, float]]:
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        log.warning("AI_MODEL_PRICES is not valid JSON; costs will show as not priced.")
        return {}
    out: dict[str, dict[str, float]] = {}
    for model, p in (data.items() if isinstance(data, dict) else []):
        if not isinstance(p, dict):
            continue
        try:
            out[str(model)] = {k: float(p[k]) for k in ("input", "output", "cached") if k in p}
        except (TypeError, ValueError):
            continue
    return out


def price_for(model: str) -> dict[str, float] | None:
    table = _prices(get_settings().ai_model_prices)
    best = None
    for key in table:
        if model == key or model.startswith(key):
            if best is None or len(key) > len(best):
                best = key
    return table.get(best) if best else None


def estimate_cost(model: str, input_tokens: int | None, output_tokens: int | None, cached_tokens: int | None = None) -> float | None:
    p = price_for(model)
    if p is None or (input_tokens is None and output_tokens is None):
        return None
    cached = min(cached_tokens or 0, input_tokens or 0)
    fresh = (input_tokens or 0) - cached
    usd = fresh * p.get("input", 0.0) + cached * p.get("cached", p.get("input", 0.0)) + (output_tokens or 0) * p.get("output", 0.0)
    return round(usd / 1_000_000, 6)


def to_display(usd: float | None) -> float | None:
    """USD -> the currency the user reads (``AI_CURRENCY``)."""
    return None if usd is None else round(usd * get_settings().ai_currency_rate, 4)


def from_display(amount: float) -> float:
    rate = get_settings().ai_currency_rate
    return amount / rate if rate > 0 else amount
