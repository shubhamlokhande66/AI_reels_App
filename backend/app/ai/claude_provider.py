"""Claude provider (official Anthropic SDK, ``anthropic``).

* Text and vision models come from configuration (``CLAUDE_TEXT_MODEL`` / ``CLAUDE_VISION_MODEL`` or Settings); the
  default is ``claude-opus-5-5``. One model handles text and images.
* Structured answers use ``output_config.format`` (JSON schema built from the Pydantic model, every object closed with
  ``additionalProperties: false``); if the API refuses that schema, the request is repeated in plain JSON mode with the
  schema in the instructions. Either way ``app.ai.structured`` validates the answer again.
* Thinking is adaptive (always on for current models) and its depth is set with ``CLAUDE_EFFORT``; no sampling
  parameters are sent (current models reject them). On models that support it, the server-side refusal fallback
  (``fallbacks: "default"``) is on, so a declined request is answered by a fallback model inside the same call.
* Anthropic response objects never leave this module: everything is normalized into ``AIResult`` / ``AIProviderError``.
"""

from __future__ import annotations

import base64
import copy
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
DEFAULT_MODEL = "claude-opus-5-5"
MAX_TOKENS = 16000  # non-streaming default that stays well inside the SDK's HTTP timeout
EFFORTS = ("low", "medium", "high", "xhigh", "max")
# models that accept the server-side refusal fallback in its "default" form
FALLBACK_MODELS = ("claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"


def _client(api_key: str, timeout: float):
    import anthropic

    k = (hash(api_key), timeout)
    with _lock:
        if k not in _clients:
            # retries are ManagedProvider's job (it knows the budget, the fallback provider and the usage log)
            _clients[k] = anthropic.Anthropic(api_key=api_key, timeout=timeout, max_retries=0)
        return _clients[k]


def closed_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Every object in the schema gets ``additionalProperties: false`` (required by schema-constrained output)."""
    out = copy.deepcopy(schema)

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            if node.get("type") == "object" or "properties" in node:
                node["additionalProperties"] = False
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(out)
    return out


def _media_type(data: bytes) -> str:
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:3] == b"GIF":
        return "image/gif"
    return "image/jpeg"


class ClaudeProvider(AIProvider):
    name = "claude"
    is_local = False

    def __init__(self, api_key: str = "", model: str = "", vision_model: str = "", timeout: float = 180.0, effort: str = "medium",
                 client: Any = None) -> None:  # fmt: skip
        self._api_key = api_key.strip()
        self.model = model.strip() or DEFAULT_MODEL
        self.vision_model = vision_model.strip()
        self.timeout = timeout
        self.effort = effort if effort in EFFORTS else "medium"
        self._injected = client

    def __repr__(self) -> str:  # never show the key
        return f"ClaudeProvider(model={self.model!r}, vision_model={self.vision_model!r})"

    def _err(self, message: str, kind: str, details: Any = None, retry_after: float | None = None) -> AIProviderError:
        return AIProviderError(message, kind=kind, provider=self.name, code=f"CLAUDE_{kind.upper()}", details=details, retry_after=retry_after)

    def client(self):
        if self._injected is not None:
            return self._injected
        if not self._api_key:
            raise self._err("Claude is not configured: set ANTHROPIC_API_KEY in the backend .env file.", "not_configured")
        return _client(self._api_key, self.timeout)

    # ------------------------------------------------------------------ request building
    @staticmethod
    def _content(text: str, images: list[Any]) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        for img in images:  # images first, then the question about them
            data = base64.b64decode(img) if isinstance(img, str) else img
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": _media_type(data),
                                                        "data": base64.standard_b64encode(data).decode("ascii")}})  # fmt: skip
        if text:
            blocks.append({"type": "text", "text": text})
        return blocks or [{"type": "text", "text": "."}]

    def _messages(self, req: AIRequest) -> list[dict[str, Any]]:
        if req.messages is None:
            return [{"role": "user", "content": self._content(req.user, req.images)}]
        out = [{"role": "assistant" if m.get("role") == "assistant" else "user", "content": self._content(str(m.get("content", "")), m.get("images") or [])}
               for m in req.messages]  # fmt: skip
        if out and out[0]["role"] != "user":  # the conversation must start with the user
            out.insert(0, {"role": "user", "content": [{"type": "text", "text": "(conversation continues)"}]})
        return out

    def _params(self, req: AIRequest, model: str, constrained: bool) -> dict[str, Any]:
        from app.ai.structured import json_schema, schema_hint

        system = req.system
        output_config: dict[str, Any] = {"effort": self.effort}
        if req.schema is not None and constrained:
            output_config["format"] = {"type": "json_schema", "schema": closed_schema(json_schema(req.schema))}
        elif req.schema is not None:
            system = f"{system}\n\n{schema_hint(req.schema)}"
        elif req.json_mode:
            system = f"{system}\n\nReply with ONE JSON object only: no Markdown, no code fences, no prose."
        params: dict[str, Any] = {
            "model": model, "max_tokens": req.max_output_tokens or MAX_TOKENS, "system": system,
            "messages": self._messages(req), "output_config": output_config,
        }  # fmt: skip
        if model in FALLBACK_MODELS:
            params.update(betas=[FALLBACK_BETA], fallbacks="default")
        return params

    # ------------------------------------------------------------------ the call
    def generate(self, req: AIRequest) -> AIResult:
        model = self.model_for(req)
        client = self.client()
        started = time.monotonic()
        attempts = (True, False) if req.schema is not None else (False,)
        for constrained in attempts:
            params = self._params(req, model, constrained)
            try:
                if "betas" in params:
                    resp = client.beta.messages.create(**params)
                else:
                    resp = client.messages.create(**params)
            except Exception as exc:  # noqa: BLE001 - normalized below
                err = self._normalize(exc)
                if constrained and err.kind == "bad_request" and "schema" in str(getattr(exc, "message", exc)).lower():
                    log.info("Claude refused the JSON schema for %s; asking again in JSON mode", req.schema.__name__ if req.schema else "?")
                    continue
                raise err from exc
            return self._result(resp, req, model, started)
        raise self._err("Claude could not answer in the requested format.", "invalid_response")

    def _result(self, resp: Any, req: AIRequest, model: str, started: float) -> AIResult:
        stop = getattr(resp, "stop_reason", None)
        if stop == "refusal":
            details = getattr(resp, "stop_details", None)
            raise self._err("Claude declined this request.", "refusal", {"category": getattr(details, "category", None)})
        warnings: list[str] = []
        if stop == "max_tokens":
            warnings.append("The answer was cut short (length limit).")
        for block in getattr(resp, "content", None) or []:
            if getattr(block, "type", "") == "fallback":
                warnings.append("The main Claude model declined part of this request; a fallback model answered.")
        text = "".join(getattr(b, "text", "") for b in getattr(resp, "content", None) or [] if getattr(b, "type", "") == "text")
        if not text:
            raise self._err("Claude returned an empty answer.", "invalid_response")
        usage = getattr(resp, "usage", None)
        tin = getattr(usage, "input_tokens", None)
        cached = getattr(usage, "cache_read_input_tokens", None)
        if tin is not None and cached:
            tin += cached  # the app counts cached tokens as part of the input (priced separately)
        tout = getattr(usage, "output_tokens", None)
        used = str(getattr(resp, "model", "") or model)
        return AIResult(
            text=text, provider=self.name, model=used, parsed=try_parse_json(text) if req.wants_json else None,
            latency_ms=int((time.monotonic() - started) * 1000), input_tokens=tin, output_tokens=tout, cached_tokens=cached,
            cost=self.estimate_cost(used, tin, tout, cached), request_id=getattr(resp, "_request_id", None) or getattr(resp, "id", None),
            warnings=warnings, task=req.task,
        )  # fmt: skip

    def _normalize(self, exc: Exception) -> AIProviderError:
        import anthropic

        if isinstance(exc, AIProviderError):
            return exc
        if isinstance(exc, anthropic.APITimeoutError):
            return self._err("Claude took too long to respond.", "timeout")
        if isinstance(exc, anthropic.APIConnectionError):
            return self._err("Cannot reach the Claude API. Check the internet connection.", "unavailable")
        if isinstance(exc, anthropic.APIStatusError):
            status = int(getattr(exc, "status_code", 0) or 0)
            message = redact(str(getattr(exc, "message", "") or ""), self._api_key)
            details = {"status": status, "requestId": getattr(exc, "request_id", None)}
            if isinstance(exc, (anthropic.AuthenticationError, anthropic.PermissionDeniedError)):
                return self._err("Claude rejected the API key (check ANTHROPIC_API_KEY).", "auth", details)
            if isinstance(exc, anthropic.RateLimitError):
                try:
                    wait = float(exc.response.headers.get("retry-after", "")) if exc.response is not None else None
                except ValueError:
                    wait = None
                return self._err("Claude's rate limit was reached; waiting and trying again.", "rate_limit", details, retry_after=wait)
            if isinstance(exc, anthropic.NotFoundError):
                return self._err(f"Claude has no model named '{self.model}' (check the model name).", "model_missing", details)
            if status == 529 or isinstance(exc, anthropic.InternalServerError) or status >= 500:
                return self._err("Claude is temporarily overloaded; try again.", "temporary", details)
            if isinstance(exc, anthropic.BadRequestError) and "credit" in message.lower():
                return self._err("The Claude account has no credit left.", "quota", details)
            return self._err(f"Claude could not process the request: {message[:160]}", "bad_request", details)
        return self._err("Claude call failed unexpectedly.", "unavailable", {"type": type(exc).__name__})

    # ------------------------------------------------------------------ information
    def list_models(self) -> list[dict[str, Any]]:
        try:
            rows = list(self.client().models.list())
        except AIProviderError:
            raise
        except Exception as exc:  # noqa: BLE001
            raise self._normalize(exc) from exc
        return sorted(({"name": str(m.id), "vision": True} for m in rows if getattr(m, "id", "")), key=lambda x: x["name"])

    def health(self) -> dict:
        if not self._api_key and self._injected is None:
            return {"available": False, "model": self.model, "detail": "ANTHROPIC_API_KEY is not set"}
        cached = _health_cache.get(self.model)
        if cached and time.monotonic() - cached[0] < HEALTH_TTL:
            return cached[1]
        try:
            self.client().models.retrieve(self.model)
            out = {"available": True, "model": self.model, "detail": "ready"}
        except Exception as exc:  # noqa: BLE001 - health must never raise
            e = self._normalize(exc)
            out = {"available": False, "model": self.model, "detail": e.message, "errorKind": e.kind}
        _health_cache[self.model] = (time.monotonic(), out)
        return out
