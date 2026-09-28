"""Ollama (local LLM) provider. The model comes from OLLAMA_MODEL (or Settings); nothing is hard-coded.

Local: no media or text leaves this computer. Structured answers use Ollama's JSON mode with the schema in the prompt;
the answer is then validated with Pydantic (and repaired once) by ``app.ai.structured``.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import httpx

from app.ai.provider import AIProvider, parse_json_object, try_parse_json
from app.ai.types import AIProviderError, AIRequest, AIResult
from app.core.config import get_settings


class OllamaProvider(AIProvider):
    name = "ollama"
    is_local = True

    def __init__(self, base_url: str, model: str, timeout: float = 60.0, vision_model: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model.strip()
        self.vision_model = vision_model.strip()
        self.timeout = timeout

    def _err(self, message: str, kind: str, code: str, details: Any = None) -> AIProviderError:
        return AIProviderError(message, kind=kind, provider=self.name, code=code, details=details)

    def _require_model(self, model: str) -> str:
        if not model:
            raise self._err("No Ollama model configured. Set OLLAMA_MODEL to a model you have pulled (see `ollama list`).",
                            "not_configured", "AI_MODEL_NOT_SET")  # fmt: skip
        return model

    def _messages(self, req: AIRequest) -> list[dict[str, Any]]:
        from app.ai.structured import schema_hint

        hint = ("\n\n" + schema_hint(req.schema)) if req.schema is not None else ""
        out: list[dict[str, Any]] = [{"role": "system", "content": req.system}]
        if req.messages is not None:
            for m in req.messages:
                item: dict[str, Any] = {"role": m["role"], "content": str(m.get("content", ""))}
                if m.get("images"):
                    item["images"] = list(m["images"])  # Ollama takes base64 images per message natively
                out.append(item)
            if hint and out[-1]["role"] == "user":
                out[-1]["content"] += hint
        else:
            user: dict[str, Any] = {"role": "user", "content": req.user + hint}
            if req.images:
                user["images"] = [i if isinstance(i, str) else base64.b64encode(i).decode() for i in req.images]
            out.append(user)
        return out

    def generate(self, req: AIRequest) -> AIResult:
        vision = req.is_vision
        model = self._require_model(self.model_for(req))
        options: dict[str, Any] = {"temperature": (0.1 if vision else 0.3) if req.temperature is None else req.temperature}
        if req.max_output_tokens:
            options["num_predict"] = req.max_output_tokens
        payload: dict[str, Any] = {
            "model": model,
            "messages": self._messages(req),
            "stream": False,
            "options": options,
            "think": False,  # structured answers do not need reasoning; thinking models otherwise take minutes
            # Ollama unloads a model after ~5min idle by default; reloading it can itself take longer than the whole
            # request timeout (mostly disk I/O, not inference) — a longer keep_alive means a pause between chat turns
            # doesn't pay that cost again. Vision models are larger, so they are released sooner.
            "keep_alive": "10m" if vision else "30m",
        }
        if req.wants_json:
            payload["format"] = "json"
        timeout = get_settings().vision_timeout_seconds if vision else self.timeout
        started = time.monotonic()
        try:
            r = httpx.post(f"{self.base_url}/api/chat", json=payload, timeout=timeout)
        except httpx.TimeoutException as exc:
            what = "vision model" if vision else "Ollama model"
            raise self._err(f"The {what} took too long to respond.", "timeout", "OLLAMA_TIMEOUT") from exc
        except httpx.HTTPError as exc:
            raise self._err(f"Cannot reach Ollama at {self.base_url}. Is it running?", "unavailable", "OLLAMA_UNAVAILABLE") from exc
        if r.status_code == 404:
            raise self._err(f"Ollama has no model named '{model}'. Pull it with `ollama pull {model}`.", "model_missing",
                            "OLLAMA_MODEL_MISSING")  # fmt: skip
        if r.status_code >= 400 and vision:
            raise self._err(f"Ollama could not process the images ({r.status_code}). The model may not support vision.",
                            "unsupported", "AI_VISION_UNSUPPORTED", r.text[:300])  # fmt: skip
        if r.status_code >= 400:
            kind = "temporary" if r.status_code >= 500 else "bad_request"
            raise self._err(f"Ollama returned an error ({r.status_code}).", kind, "OLLAMA_ERROR", r.text[:300])
        try:
            body = r.json()
            text = str(body["message"]["content"])
        except (KeyError, ValueError, TypeError) as exc:
            raise self._err("Ollama returned an unexpected response.", "invalid_response", "OLLAMA_ERROR") from exc
        return AIResult(
            text=text, provider=self.name, model=model, parsed=try_parse_json(text) if req.wants_json else None,
            latency_ms=int((time.monotonic() - started) * 1000), input_tokens=_int(body.get("prompt_eval_count")),
            output_tokens=_int(body.get("eval_count")), cost=0.0, task=req.task,
        )  # fmt: skip

    def chat_images(self, system: str, user: str, images_b64: list[str], *, temperature: float = 0.1) -> dict:
        res = self.generate(AIRequest(system=system, user=user, images=list(images_b64), json_mode=True,
                                      temperature=temperature, task="clip_understanding", max_output_tokens=300))  # fmt: skip
        if isinstance(res.parsed, dict):
            return res.parsed
        try:
            return parse_json_object(res.text)
        except Exception as exc:  # noqa: BLE001
            raise self._err("Ollama returned an unexpected response.", "invalid_response", "OLLAMA_ERROR") from exc

    def installed_models(self) -> list[dict]:
        """Models pulled into Ollama, with what each can do (vision, reasoning ...). Raises if unreachable."""
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=5.0)
            r.raise_for_status()
            rows = r.json().get("models", [])
        except Exception as exc:  # noqa: BLE001
            raise self._err(f"Cannot reach Ollama at {self.base_url}. Is it running?", "unavailable", "OLLAMA_UNAVAILABLE") from exc
        out = []
        for m in rows:
            name = str(m.get("name", ""))
            caps: list[str] = []
            try:
                info = httpx.post(f"{self.base_url}/api/show", json={"model": name}, timeout=5.0).json()
                caps = [str(c) for c in info.get("capabilities", [])]
            except Exception:  # noqa: BLE001 - capabilities are informational
                pass
            out.append({"name": name, "sizeGb": round(float(m.get("size", 0)) / 1e9, 1), "capabilities": caps})
        return sorted(out, key=lambda x: x["name"])

    def list_models(self) -> list[dict[str, Any]]:
        return [{"name": m["name"], "vision": "vision" in m["capabilities"]} for m in self.installed_models()
                if m["capabilities"] != ["embedding"]]  # fmt: skip

    def health(self) -> dict:
        try:
            r = httpx.get(f"{self.base_url}/api/tags", timeout=2.0)
            r.raise_for_status()
            installed = [m.get("name", "") for m in r.json().get("models", [])]
        except Exception:  # noqa: BLE001 - health must never raise
            return {"available": False, "model": self.model or None, "detail": f"Ollama not reachable at {self.base_url}"}
        if not self.model:
            return {"available": False, "model": None, "detail": "OLLAMA_MODEL is not set", "installed": installed}
        ok = any(n == self.model or n.split(":")[0] == self.model for n in installed)
        return {
            "available": ok,
            "model": self.model,
            "detail": "ready" if ok else f"model '{self.model}' is not pulled",
            "installed": installed,
        }


def _int(v: Any) -> int | None:
    try:
        return int(v) if v is not None else None
    except (TypeError, ValueError):
        return None
