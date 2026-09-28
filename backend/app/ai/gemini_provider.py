"""Gemini provider (official Google GenAI SDK, ``google-genai``).

* Text and vision models come from configuration (``GEMINI_TEXT_MODEL`` / ``GEMINI_VISION_MODEL`` or Settings).
* Structured answers use ``response_mime_type=application/json`` + ``response_json_schema`` built from the Pydantic
  model; the answer is validated again by ``app.ai.structured``.
* Gemini response objects never leave this module: everything is normalized into ``AIResult`` / ``AIProviderError``.
"""

from __future__ import annotations

import base64
import logging
import threading
import time
from typing import Any

from app.ai.provider import AIProvider, try_parse_json
from app.ai.types import AIProviderError, AIRequest, AIResult, redact

log = logging.getLogger(__name__)
_clients: dict[tuple[int, float], Any] = {}
_lock = threading.Lock()
_health_cache: dict[str, tuple[float, dict]] = {}
HEALTH_TTL = 60.0
_BLOCKED = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"}


def _client(api_key: str, timeout: float):
    from google import genai
    from google.genai import types

    k = (hash(api_key), timeout)
    with _lock:
        if k not in _clients:
            _clients[k] = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=int(timeout * 1000)))
        return _clients[k]


def _quota_details(raw: Any) -> tuple[bool, bool, float | None]:
    """(per-day quota hit, per-minute limit hit, seconds to wait) from a Gemini error's structured details."""
    err = raw.get("error", raw) if isinstance(raw, dict) else {}
    items = err.get("details", []) if isinstance(err, dict) else []
    per_day = per_minute = False
    wait = None
    for it in items if isinstance(items, list) else []:
        if not isinstance(it, dict):
            continue
        kind = str(it.get("@type", ""))
        if kind.endswith("RetryInfo"):
            try:
                wait = float(str(it.get("retryDelay", "")).rstrip("s"))
            except ValueError:
                wait = None
        if kind.endswith("QuotaFailure"):
            for v in it.get("violations", []) or []:
                qid = str(v.get("quotaId", "")) if isinstance(v, dict) else ""
                per_day = per_day or "PerDay" in qid
                per_minute = per_minute or "PerMinute" in qid
    return per_day, per_minute, wait


def _name(value: Any) -> str:
    """Enum or string -> plain upper-case name."""
    v = getattr(value, "name", None) or getattr(value, "value", None) or value
    return str(v or "").upper()


class GeminiProvider(AIProvider):
    name = "gemini"
    is_local = False

    def __init__(self, api_key: str = "", model: str = "", vision_model: str = "", timeout: float = 90.0, client: Any = None) -> None:
        self._api_key = api_key.strip()
        self.model = model.strip()
        self.vision_model = vision_model.strip()
        self.timeout = timeout
        self._injected = client

    def __repr__(self) -> str:  # never show the key
        return f"GeminiProvider(model={self.model!r}, vision_model={self.vision_model!r})"

    def _err(self, message: str, kind: str, details: Any = None) -> AIProviderError:
        return AIProviderError(message, kind=kind, provider=self.name, code=f"GEMINI_{kind.upper()}", details=details)

    def client(self):
        if self._injected is not None:
            return self._injected
        if not self._api_key:
            raise self._err("Gemini is not configured: set GEMINI_API_KEY in the backend .env file.", "not_configured")
        return _client(self._api_key, self.timeout)

    # ------------------------------------------------------------------ request building
    @staticmethod
    def _parts(text: str, images: list[Any]) -> list[Any]:
        from google.genai import types

        parts = [types.Part.from_text(text=text)] if text else []
        for img in images:
            data = base64.b64decode(img) if isinstance(img, str) else img
            parts.append(types.Part.from_bytes(data=data, mime_type="image/png" if data[:4] == b"\x89PNG" else "image/jpeg"))
        return parts

    def _contents(self, req: AIRequest) -> list[Any]:
        from google.genai import types

        if req.messages is None:
            return [types.Content(role="user", parts=self._parts(req.user, req.images))]
        return [
            types.Content(role="model" if m.get("role") == "assistant" else "user", parts=self._parts(str(m.get("content", "")), m.get("images") or []))
            for m in req.messages
        ]

    def _config(self, req: AIRequest) -> Any:
        from google.genai import types

        from app.ai.structured import json_schema

        # no tools are ever passed, so automatic function calling is off (also silences the SDK's AFC warning)
        kw: dict[str, Any] = {"system_instruction": req.system,
                              "automatic_function_calling": types.AutomaticFunctionCallingConfig(disable=True)}
        if req.temperature is not None:
            kw["temperature"] = req.temperature
        if req.wants_json:
            kw["response_mime_type"] = "application/json"
        if req.schema is not None:
            kw["response_json_schema"] = json_schema(req.schema)
        return types.GenerateContentConfig(**kw)

    # ------------------------------------------------------------------ the call
    def generate(self, req: AIRequest) -> AIResult:
        model = self.model_for(req)
        if not model:
            which = "GEMINI_VISION_MODEL / GEMINI_TEXT_MODEL" if req.is_vision else "GEMINI_TEXT_MODEL"
            raise self._err(f"No Gemini model configured: set {which} (or choose one in Settings).", "not_configured")
        client = self.client()
        started = time.monotonic()
        try:
            resp = client.models.generate_content(model=model, contents=self._contents(req), config=self._config(req))
        except Exception as exc:  # noqa: BLE001 - normalized below
            raise self._normalize(exc) from exc
        return self._result(resp, req, model, started)

    def _result(self, resp: Any, req: AIRequest, model: str, started: float) -> AIResult:
        feedback = getattr(resp, "prompt_feedback", None)
        if feedback is not None and getattr(feedback, "block_reason", None):
            raise self._err("Gemini declined this request.", "refusal", {"reason": _name(feedback.block_reason)})
        candidates = getattr(resp, "candidates", None) or []
        warnings: list[str] = []
        if candidates:
            reason = _name(getattr(candidates[0], "finish_reason", ""))
            if reason in _BLOCKED:
                raise self._err("Gemini declined this request.", "refusal", {"reason": reason})
            if reason == "MAX_TOKENS":
                warnings.append("The answer was cut short (length limit).")
        try:
            text = str(resp.text or "")
        except Exception:  # noqa: BLE001 - .text raises on some empty/blocked answers
            text = ""
        if not text and not candidates:
            raise self._err("Gemini returned an empty answer.", "invalid_response")
        um = getattr(resp, "usage_metadata", None)
        tin = getattr(um, "prompt_token_count", None)
        tout = (getattr(um, "candidates_token_count", None) or 0) + (getattr(um, "thoughts_token_count", None) or 0) if um else None
        cached = getattr(um, "cached_content_token_count", None)
        used = str(getattr(resp, "model_version", "") or model)
        return AIResult(
            text=text, provider=self.name, model=used, parsed=try_parse_json(text) if req.wants_json else None,
            latency_ms=int((time.monotonic() - started) * 1000), input_tokens=tin, output_tokens=tout or None, cached_tokens=cached,
            cost=self.estimate_cost(model, tin, tout, cached), request_id=getattr(resp, "response_id", None), warnings=warnings,
            task=req.task,
        )  # fmt: skip

    def _normalize(self, exc: Exception) -> AIProviderError:
        import httpx
        from google.genai import errors

        if isinstance(exc, AIProviderError):
            return exc
        if isinstance(exc, httpx.TimeoutException):
            return self._err("Gemini took too long to respond.", "timeout")
        if isinstance(exc, httpx.TransportError):
            return self._err("Cannot reach the Gemini API. Check the internet connection.", "unavailable")
        if isinstance(exc, errors.APIError):
            code = int(getattr(exc, "code", 0) or 0)
            status = str(getattr(exc, "status", "") or "")
            message = redact(str(getattr(exc, "message", "") or ""), self._api_key)
            low = message.lower()
            details = {"status": code, "type": status}
            if code in (401, 403) or "api key" in low or status in ("UNAUTHENTICATED", "PERMISSION_DENIED"):
                return self._err("Gemini rejected the API key (check GEMINI_API_KEY).", "auth", details)
            if code == 429 or status == "RESOURCE_EXHAUSTED":
                # Gemini's 429 text always mentions quota and billing, whether the per-MINUTE request limit was hit (wait a
                # few seconds) or the per-DAY quota is used up. The structured details say which, and how long to wait.
                per_day, per_minute, wait = _quota_details(getattr(exc, "details", None))
                if per_day and not per_minute:
                    return self._err("Gemini's daily quota for this API key is used up (it resets tomorrow, or raise the limit).",
                                     "quota", details)  # fmt: skip
                e = self._err("Gemini's per-minute request limit was reached; waiting and trying again.", "rate_limit", details)
                e.retry_after = wait
                return e
            if code == 404:
                return self._err(f"Gemini has no model named '{self.model}' (check the model name).", "model_missing", details)
            if code == 504 or status == "DEADLINE_EXCEEDED":
                return self._err("Gemini took too long to respond.", "timeout", details)
            if code >= 500:
                return self._err("Gemini had a temporary problem; try again.", "temporary", details)
            return self._err(f"Gemini could not process the request: {message[:160]}", "bad_request", details)
        return self._err("Gemini call failed unexpectedly.", "unavailable", {"type": type(exc).__name__})

    # ------------------------------------------------------------------ information
    def list_models(self) -> list[dict[str, Any]]:
        try:
            rows = list(self.client().models.list())
        except AIProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise self._normalize(exc) from exc
        out = []
        for m in rows:
            actions = [str(a) for a in (getattr(m, "supported_actions", None) or [])]
            if actions and "generateContent" not in actions:
                continue
            name = str(getattr(m, "name", "") or "").removeprefix("models/")
            if name:
                out.append({"name": name, "vision": None})
        return sorted(out, key=lambda x: x["name"])

    def health(self) -> dict:
        if not self._api_key and self._injected is None:
            return {"available": False, "model": self.model or None, "detail": "GEMINI_API_KEY is not set"}
        if not self.model:
            return {"available": False, "model": None, "detail": "GEMINI_TEXT_MODEL is not set"}
        cached = _health_cache.get(self.model)
        if cached and time.monotonic() - cached[0] < HEALTH_TTL:
            return cached[1]
        try:
            self.client().models.get(model=self.model)
            out = {"available": True, "model": self.model, "detail": "ready"}
        except Exception as exc:  # noqa: BLE001 - health must never raise
            e = self._normalize(exc)
            out = {"available": False, "model": self.model, "detail": e.message, "errorKind": e.kind}
        _health_cache[self.model] = (time.monotonic(), out)
        return out
