"""OpenAI provider (official ``openai`` SDK, Responses API).

* Text and vision models come from configuration (``OPENAI_TEXT_MODEL`` / ``OPENAI_VISION_MODEL`` or Settings).
* Structured answers are schema-constrained (``json_schema``, strict) from the Pydantic model; if a schema cannot be
  used strictly, JSON mode + the schema in the instructions is used instead. Either way the answer is validated again
  by ``app.ai.structured``.
* ``store=False``: responses are not kept on OpenAI's side for later retrieval.
* Every failure becomes an ``AIProviderError`` with a normalized kind; the API key and raw vendor payloads never
  appear in messages.
"""

from __future__ import annotations

import base64
import logging
import threading
import time
from typing import Any

from app.ai.provider import AIProvider, try_parse_json
from app.ai.types import AIProviderError, AIRequest, AIResult, redact
from app.core.config import get_settings

log = logging.getLogger(__name__)
_clients: dict[tuple[int, str, float], Any] = {}
_lock = threading.Lock()
_health_cache: dict[str, tuple[float, dict]] = {}
HEALTH_TTL = 60.0


def _client(api_key: str, base_url: str, timeout: float):
    import openai

    k = (hash(api_key), base_url, timeout)
    with _lock:
        if k not in _clients:
            _clients[k] = openai.OpenAI(api_key=api_key, base_url=base_url or None, timeout=timeout, max_retries=0)
        return _clients[k]


class OpenAIProvider(AIProvider):
    name = "openai"
    is_local = False

    def __init__(self, api_key: str = "", model: str = "", vision_model: str = "", timeout: float = 90.0, base_url: str = "",
                 client: Any = None) -> None:  # fmt: skip
        self._api_key = api_key.strip()
        self.model = model.strip()
        self.vision_model = vision_model.strip()
        self.timeout = timeout
        self.base_url = base_url.strip()
        self._injected = client  # tests pass a fake client

    def __repr__(self) -> str:  # never show the key
        return f"OpenAIProvider(model={self.model!r}, vision_model={self.vision_model!r})"

    # ------------------------------------------------------------------ helpers
    def _err(self, message: str, kind: str, details: Any = None) -> AIProviderError:
        return AIProviderError(message, kind=kind, provider=self.name, code=f"OPENAI_{kind.upper()}", details=details)

    def client(self):
        if self._injected is not None:
            return self._injected
        if not self._api_key:
            raise self._err("OpenAI is not configured: set OPENAI_API_KEY in the backend .env file.", "not_configured")
        return _client(self._api_key, self.base_url, self.timeout)

    @staticmethod
    def _image_part(data: bytes | str) -> dict[str, Any]:
        b64 = data if isinstance(data, str) else base64.b64encode(data).decode()
        mime = "image/png" if b64.startswith("iVBOR") else "image/jpeg"
        detail = get_settings().vision_detail_level if get_settings().vision_detail_level in ("low", "high", "auto") else "low"
        return {"type": "input_image", "image_url": f"data:{mime};base64,{b64}", "detail": detail}

    def _input(self, req: AIRequest) -> list[dict[str, Any]]:
        if req.messages is None:
            content: list[dict[str, Any]] = [{"type": "input_text", "text": req.user}]
            content += [self._image_part(i) for i in req.images]
            return [{"role": "user", "content": content}]
        out: list[dict[str, Any]] = []
        for m in req.messages:
            if m.get("role") == "assistant":
                out.append({"role": "assistant", "content": str(m.get("content", ""))})
            else:
                parts: list[dict[str, Any]] = [{"type": "input_text", "text": str(m.get("content", ""))}]
                parts += [self._image_part(i) for i in m.get("images") or []]
                out.append({"role": "user", "content": parts})
        return out

    def _text_format(self, req: AIRequest, strict: bool) -> tuple[dict[str, Any] | None, str]:
        """(text.format, extra instructions)."""
        if req.schema is not None and strict:
            from openai.lib._pydantic import to_strict_json_schema

            try:
                schema = to_strict_json_schema(req.schema)
                name = "".join(c for c in req.schema.__name__ if c.isalnum() or c in "_-")[:60] or "answer"
                return {"type": "json_schema", "name": name, "schema": schema, "strict": True}, ""
            except Exception:  # noqa: BLE001 - a schema that cannot be strict falls back to JSON mode below
                log.info("schema for %s cannot be strict; using JSON mode", req.schema.__name__)
        if req.wants_json:
            from app.ai.structured import schema_hint

            extra = "\n\nReply in JSON." + (("\n" + schema_hint(req.schema)) if req.schema is not None else "")
            return {"type": "json_object"}, extra
        return None, ""

    # ------------------------------------------------------------------ the call
    def generate(self, req: AIRequest) -> AIResult:
        model = self.model_for(req)
        if not model:
            which = "OPENAI_VISION_MODEL / OPENAI_TEXT_MODEL" if req.is_vision else "OPENAI_TEXT_MODEL"
            raise self._err(f"No OpenAI model configured: set {which} (or choose one in Settings).", "not_configured")
        client = self.client()
        started = time.monotonic()
        resp = None
        for strict in (True, False):
            fmt, extra = self._text_format(req, strict)
            kwargs: dict[str, Any] = {"model": model, "instructions": req.system + extra, "input": self._input(req), "store": False}
            if fmt is not None:
                kwargs["text"] = {"format": fmt}
            effort = get_settings().openai_reasoning_effort.strip()
            if effort:
                kwargs["reasoning"] = {"effort": effort}
            try:
                resp = client.responses.create(**kwargs)
                break
            except Exception as exc:  # noqa: BLE001 - normalized below
                err = self._normalize(exc)
                if strict and fmt and fmt.get("type") == "json_schema" and err.kind == "bad_request" and "schema" in str(getattr(exc, "message", exc)).lower():
                    continue  # the API refused the strict schema: ask again in plain JSON mode
                raise err from exc
        assert resp is not None
        return self._result(resp, req, model, started)

    def _result(self, resp: Any, req: AIRequest, model: str, started: float) -> AIResult:
        for item in getattr(resp, "output", None) or []:
            for part in getattr(item, "content", None) or []:
                if getattr(part, "type", "") == "refusal":
                    raise self._err("OpenAI declined this request.", "refusal", {"refusal": str(getattr(part, "refusal", ""))[:200]})
        warnings: list[str] = []
        if getattr(resp, "status", "completed") == "incomplete":
            reason = getattr(getattr(resp, "incomplete_details", None), "reason", "") or "unknown"
            if reason == "content_filter":
                raise self._err("OpenAI stopped the answer (content filter).", "refusal")
            warnings.append(f"The answer was cut short ({reason}).")
        text = str(getattr(resp, "output_text", "") or "")
        usage = getattr(resp, "usage", None)
        tin = getattr(usage, "input_tokens", None)
        tout = getattr(usage, "output_tokens", None)
        cached = getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", None)
        used_model = str(getattr(resp, "model", "") or model)
        return AIResult(
            text=text, provider=self.name, model=used_model, parsed=try_parse_json(text) if req.wants_json else None,
            latency_ms=int((time.monotonic() - started) * 1000), input_tokens=tin, output_tokens=tout, cached_tokens=cached,
            cost=self.estimate_cost(used_model, tin, tout, cached), request_id=getattr(resp, "_request_id", None) or getattr(resp, "id", None),
            warnings=warnings, task=req.task,
        )  # fmt: skip

    def _normalize(self, exc: Exception) -> AIProviderError:
        import openai

        status = getattr(exc, "status_code", None)
        code = str(getattr(exc, "code", "") or "")
        details = {"status": status, "type": code or type(exc).__name__}
        if isinstance(exc, AIProviderError):
            return exc
        if isinstance(exc, openai.APITimeoutError):
            return self._err("OpenAI took too long to respond.", "timeout", details)
        if isinstance(exc, openai.APIConnectionError):
            return self._err("Cannot reach the OpenAI API. Check the internet connection.", "unavailable", details)
        if isinstance(exc, openai.RateLimitError):
            if code == "insufficient_quota":
                return self._err("OpenAI quota or billing limit reached for this API key.", "quota", details)
            e = self._err("OpenAI rate limit reached; waiting and trying again.", "rate_limit", details)
            try:  # OpenAI says how long to wait
                e.retry_after = float(exc.response.headers.get("retry-after") or 0) or None
            except (AttributeError, TypeError, ValueError):
                e.retry_after = None
            return e
        if isinstance(exc, (openai.AuthenticationError, openai.PermissionDeniedError)):
            return self._err("OpenAI rejected the API key (check OPENAI_API_KEY and its permissions).", "auth", details)
        if isinstance(exc, openai.NotFoundError):
            return self._err(f"OpenAI has no model named '{self.model}' for this key (check the model name).", "model_missing", details)
        if isinstance(exc, openai.ContentFilterFinishReasonError):
            return self._err("OpenAI declined this request.", "refusal", details)
        if isinstance(exc, (openai.BadRequestError, openai.UnprocessableEntityError)):
            msg = redact(str(getattr(exc, "message", "")), self._api_key)[:160]
            return self._err(f"OpenAI could not process the request: {msg}", "bad_request", details)
        if isinstance(exc, openai.APIStatusError) and (status or 0) >= 500:
            return self._err("OpenAI had a temporary problem; try again.", "temporary", details)
        if isinstance(exc, openai.APIError):
            return self._err("OpenAI returned an error.", "temporary", details)
        return self._err("OpenAI call failed unexpectedly.", "unavailable", {"type": type(exc).__name__})

    # ------------------------------------------------------------------ information
    def list_models(self) -> list[dict[str, Any]]:
        try:
            rows = self.client().models.list()
            names = sorted({str(getattr(m, "id", "")) for m in rows if getattr(m, "id", "")})
        except AIProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise self._normalize(exc) from exc
        return [{"name": n, "vision": None} for n in names]

    def health(self) -> dict:
        if not self._api_key and self._injected is None:
            return {"available": False, "model": self.model or None, "detail": "OPENAI_API_KEY is not set"}
        if not self.model:
            return {"available": False, "model": None, "detail": "OPENAI_TEXT_MODEL is not set"}
        cached = _health_cache.get(self.model)
        if cached and time.monotonic() - cached[0] < HEALTH_TTL:
            return cached[1]
        try:
            self.client().models.retrieve(self.model, timeout=8.0)
            out = {"available": True, "model": self.model, "detail": "ready"}
        except Exception as exc:  # noqa: BLE001 - health must never raise
            e = self._normalize(exc)
            out = {"available": False, "model": self.model, "detail": e.message, "errorKind": e.kind}
        _health_cache[self.model] = (time.monotonic(), out)
        return out
