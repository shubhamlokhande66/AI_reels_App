"""AI provider abstraction. The pipeline talks to ``AIProvider``; vendors live behind it.

Every provider (Ollama, OpenAI, Gemini) implements ``generate(AIRequest) -> AIResult``; the familiar ``chat``,
``chat_json``, ``chat_turns`` and ``chat_images`` are built on it, and ``generate_structured`` returns a validated
Pydantic model. Vendor SDKs are only imported inside their provider module; nothing else in the app imports them.

The model receives compact analysis metrics and at most a few small keyframes, never raw video or audio.
"""

from __future__ import annotations

import base64
import json
import re
import time
from abc import ABC, abstractmethod
from typing import Any, TypeVar

from pydantic import BaseModel

from app.ai.types import AIProviderError, AIRequest, AIResult
from app.core.errors import AIUnavailable, AppError

T = TypeVar("T", bound=BaseModel)


class AIResponseError(AppError):
    status_code = 502
    code = "AI_BAD_RESPONSE"


class AIProvider(ABC):
    name: str = "base"
    is_local: bool = False  # True = nothing leaves this computer
    model: str = ""  # text model
    vision_model: str = ""  # vision model ("" = same as the text model)

    # ------------------------------------------------------------------ the one core call
    def _native(self) -> bool:
        return type(self).generate is not AIProvider.generate

    def generate(self, req: AIRequest) -> AIResult:
        """Default for simple providers (and test doubles) that implement only ``chat`` / ``chat_images`` /
        ``chat_turns``. Real providers override this."""
        text_only = not (req.images and req.messages is None)
        if text_only and type(self).chat is AIProvider.chat:
            raise NotImplementedError(f"{type(self).__name__} must implement generate() or chat()")
        from app.ai.structured import schema_hint

        started = time.monotonic()
        user = req.user + ("\n\n" + schema_hint(req.schema) if req.schema is not None else "")
        temperature = 0.3 if req.temperature is None else req.temperature
        parsed: Any = None
        if req.images and req.messages is None:
            data = self.chat_images(req.system, user, [i if isinstance(i, str) else base64.b64encode(i).decode() for i in req.images],
                                    temperature=0.1 if req.temperature is None else req.temperature)  # fmt: skip
            text, parsed = json.dumps(data, ensure_ascii=False), data
        elif req.messages is not None:
            text = self.chat_turns(req.system, req.messages, temperature=0.4 if req.temperature is None else req.temperature)
            parsed = try_parse_json(text) if req.wants_json else None
        else:
            text = self.chat(req.system, user, json_mode=req.wants_json, temperature=temperature)
            parsed = try_parse_json(text) if req.wants_json else None
        return AIResult(text=text, provider=self.name, model=self.model_for(req), parsed=parsed,
                        latency_ms=int((time.monotonic() - started) * 1000), task=req.task)  # fmt: skip

    def model_for(self, req: AIRequest) -> str:
        return (self.vision_model or self.model) if req.is_vision else self.model

    # ------------------------------------------------------------------ the familiar calls
    def chat(self, system: str, user: str, *, json_mode: bool = False, temperature: float = 0.3) -> str:
        """Single-turn completion. Raises ``AIUnavailable`` if the backend cannot be used."""
        if not self._native():
            raise NotImplementedError(f"{type(self).__name__} must implement generate() or chat()")
        return self.generate(AIRequest(system=system, user=user, json_mode=json_mode, temperature=temperature)).text

    def chat_turns(self, system: str, messages: list[dict[str, Any]], *, temperature: float = 0.4) -> str:
        """Multi-turn completion: ``messages`` is the conversation so far, each {"role": "user"|"assistant", "content",
        "images"?: [base64, ...]}. Providers without a native multi-turn call get the conversation folded into one
        prompt (images dropped)."""
        if self._native():
            return self.generate(AIRequest(system=system, messages=messages, temperature=temperature, task="chat")).text
        transcript = "\n".join(f"{m['role']}: {m['content']}" for m in messages)
        return self.chat(system, transcript, json_mode=False, temperature=temperature)

    def chat_images(self, system: str, user: str, images_b64: list[str], *, temperature: float = 0.1) -> dict[str, Any]:
        """Vision call: a few small keyframes + a prompt, JSON reply. Providers without vision raise."""
        if not self._native():
            raise AIUnavailable(f"The '{self.name}' provider does not support images.", code="AI_VISION_UNSUPPORTED")
        res = self.generate(AIRequest(system=system, user=user, images=list(images_b64), json_mode=True, temperature=temperature,
                                      task="clip_understanding"))  # fmt: skip
        if not isinstance(res.parsed, dict):
            raise AIResponseError("The AI model did not return valid JSON.", details=res.text[:300])
        return res.parsed

    def chat_json(self, system: str, user: str, *, temperature: float = 0.2, task: str = "general") -> dict[str, Any]:
        res = self.generate(AIRequest(system=system, user=user, json_mode=True, temperature=temperature, task=task))
        if isinstance(res.parsed, dict):
            return res.parsed
        return parse_json_object(res.text)  # raises AIResponseError with the usual message

    # ------------------------------------------------------------------ structured output
    def generate_structured(
        self, system: str, user: str, model: type[T], *, task: str = "general", temperature: float | None = None,
        messages: list[dict[str, Any]] | None = None, max_output_tokens: int | None = None,
    ) -> T:
        from app.ai.structured import run_structured

        req = AIRequest(system=system, user=user, messages=messages, temperature=temperature, task=task,
                        max_output_tokens=max_output_tokens)  # fmt: skip
        return run_structured(self, req, model)[0]

    def generate_vision_structured(
        self, system: str, user: str, images: list[bytes], model: type[T], *, task: str = "clip_understanding",
        temperature: float | None = 0.1,
    ) -> T:
        from app.ai.structured import run_structured

        return run_structured(self, AIRequest(system=system, user=user, images=images, temperature=temperature, task=task), model)[0]

    # ------------------------------------------------------------------ information
    @abstractmethod
    def health(self) -> dict[str, Any]:
        """{'available': bool, 'model': str|None, 'detail': str} - must never raise."""

    def list_models(self) -> list[dict[str, Any]]:
        """Models this provider offers, [{"name", "vision"?: bool}]. Raises ``AIProviderError`` if unreachable."""
        return []

    def get_model_info(self) -> dict[str, Any]:
        return {"provider": self.name, "model": self.model or None, "visionModel": (self.vision_model or self.model) or None,
                "local": self.is_local}  # fmt: skip

    def estimate_cost(self, model: str, input_tokens: int | None, output_tokens: int | None, cached_tokens: int | None = None) -> float | None:
        if self.is_local:
            return 0.0
        from app.ai.pricing import estimate_cost

        return estimate_cost(model, input_tokens, output_tokens, cached_tokens)


# ---------------------------------------------------------------------- JSON helpers
_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def try_parse_json(text: str) -> dict[str, Any] | None:
    try:
        return parse_json_object(text)
    except AIResponseError:
        return None


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse an LLM reply into a dict, tolerating code fences and surrounding chatter."""
    cleaned = _FENCE.sub("", text.strip())
    for candidate in (cleaned, _first_braced(cleaned)):
        if not candidate:
            continue
        try:
            value = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(value, dict):
            return value
    raise AIResponseError("The AI model did not return valid JSON.", details=text[:300])


def _first_braced(text: str) -> str | None:
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    for i in range(start, len(text)):
        depth += {"{": 1, "}": -1}.get(text[i], 0)
        if depth == 0:
            return text[start : i + 1]
    return None


# ---------------------------------------------------------------------- selection
_override: AIProvider | None = None


def set_provider(provider: AIProvider | None) -> None:
    """Inject a provider (tests). It is used for every task, as is."""
    global _override
    _override = provider


def get_override() -> AIProvider | None:
    return _override


def get_provider(task: str | None = None) -> AIProvider:
    """The provider for ``task`` (routing, fallback, budget and usage logging included). See ``app.ai.factory``."""
    if _override is not None:
        return _override
    from app.ai.factory import get_ai_provider

    return get_ai_provider(task)


__all__ = ["AIProvider", "AIProviderError", "AIRequest", "AIResult", "AIResponseError", "get_provider", "set_provider",
           "parse_json_object", "try_parse_json"]  # fmt: skip
