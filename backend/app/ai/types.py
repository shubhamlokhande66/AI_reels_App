"""Provider-neutral AI types: the request every provider accepts, the normalized result every provider returns, and
the normalized error every provider raises. Nothing vendor-specific (OpenAI / Gemini / Ollama objects) ever leaves a
provider; the rest of the app only sees these.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from app.core.errors import AIUnavailable

# Kinds of provider failure. Only *operational* ones may move a request to the fallback provider; a bad request,
# a refusal or malformed output never does (the same request would fail the same way, or should not be retried).
ERROR_KINDS = (
    "timeout", "rate_limit", "quota", "auth", "temporary", "unavailable", "model_missing", "not_configured",
    "bad_request", "refusal", "invalid_response", "unsupported", "budget",
)  # fmt: skip
RETRYABLE = frozenset({"rate_limit", "temporary", "unavailable"})
FALLBACK_OK = frozenset({"timeout", "rate_limit", "quota", "auth", "temporary", "unavailable", "model_missing", "not_configured"})


_KEYLIKE = re.compile(r"\b(sk-[A-Za-z0-9_\-*]{6,}|AIza[0-9A-Za-z_\-]{10,})")


def redact(text: str, *secrets: str) -> str:
    """Remove API keys (the configured ones and anything shaped like a key) from text that may be shown or logged."""
    for s in secrets:
        if s and len(s) >= 6:
            text = text.replace(s, "***")
    return _KEYLIKE.sub("***", text)


class AIProviderError(AIUnavailable):
    """A normalized provider failure. Subclasses ``AIUnavailable`` so every existing ``except AppError`` still works.

    ``message`` is safe to show to the user and never contains an API key or a raw vendor payload.
    """

    def __init__(self, message: str, *, kind: str, provider: str, code: str | None = None, details: Any = None,
                 status_code: int | None = None, retry_after: float | None = None) -> None:  # fmt: skip
        super().__init__(message, code=code or f"AI_{kind.upper()}", details=details, status_code=status_code)
        self.kind = kind if kind in ERROR_KINDS else "unavailable"
        self.provider = provider
        self.retry_after = retry_after  # seconds the provider asked us to wait (a per-minute rate limit), if it said

    @property
    def retryable(self) -> bool:
        return self.kind in RETRYABLE

    @property
    def fallback_ok(self) -> bool:
        return self.kind in FALLBACK_OK


@dataclass
class AIRequest:
    """One model call. ``messages`` (multi-turn) wins over ``user``; images are raw JPEG/PNG bytes."""

    system: str
    user: str = ""
    messages: list[dict[str, Any]] | None = None  # [{"role": "user"|"assistant", "content": str, "images"?: [b64, ...]}]
    images: list[bytes | str] = field(default_factory=list)  # raw bytes or base64 text
    schema: type[BaseModel] | None = None  # constrain + validate the answer to this model
    json_mode: bool = False
    temperature: float | None = None
    task: str = "general"
    max_output_tokens: int | None = None

    @property
    def wants_json(self) -> bool:
        return self.json_mode or self.schema is not None

    @property
    def is_vision(self) -> bool:
        return bool(self.images) or any(m.get("images") for m in self.messages or [])


@dataclass
class AIResult:
    """The normalized answer of any provider."""

    text: str
    provider: str
    model: str
    parsed: Any = None  # dict for JSON answers (None if the text was not valid JSON)
    latency_ms: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_tokens: int | None = None
    cost: float | None = None  # in USD; None = not priced
    request_id: str | None = None
    warnings: list[str] = field(default_factory=list)
    fallback_used: bool = False
    task: str = "general"

    def usage_doc(self) -> dict[str, Any]:
        return {
            "provider": self.provider, "model": self.model, "task": self.task, "latencyMs": self.latency_ms,
            "inputTokens": self.input_tokens, "outputTokens": self.output_tokens, "cachedTokens": self.cached_tokens,
            "cost": self.cost, "requestId": self.request_id, "fallbackUsed": self.fallback_used,
        }  # fmt: skip
