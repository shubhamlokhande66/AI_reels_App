"""Settings for the AI: which provider and models, fallback, budget, a connection test, and usage.

API keys never leave the backend: the browser only learns whether a key is configured.
The original Ollama endpoints (``/models``, ``/model``, ``/models/test``) keep their exact behaviour.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.ai import ai_config
from app.ai.factory import build_provider, get_ai_provider
from app.ai.managed import ManagedProvider
from app.ai.model_choice import get_chosen_model, set_chosen_model
from app.ai.ollama import OllamaProvider
from app.ai.provider import AIProvider, AIResponseError
from app.ai.types import AIProviderError
from app.ai.usage import budget_state, summary
from app.core.config import get_settings
from app.core.errors import AIUnavailable, AppError, ValidationFailed
from app.core.ratelimit import rate_limit
from app.models.base import CamelModel
from app.revise import actions as rv
from app.storage import get_storage
from app.styles import list_styles

from app.core.admin import require_admin

# AI provider, models, keys, budgets and usage are the operator's: admin only (app/core/admin.py)
router = APIRouter(prefix="/api/ai", tags=["ai-settings"], dependencies=[Depends(require_admin)])
LAST_TEST_KEY = "settings/ai_last_test.json"


def _ollama() -> OllamaProvider:
    p = build_provider("ollama")
    assert isinstance(p, OllamaProvider)
    return p


# ====================================================================== Ollama model picker (unchanged API)
def _describe(models: list[dict[str, Any]], current: str) -> list[dict[str, Any]]:
    out = []
    for m in models:
        caps = m["capabilities"]
        out.append({**m, "vision": "vision" in caps, "thinking": "thinking" in caps, "embeddingOnly": caps == ["embedding"],
                    "current": m["name"] == current})  # fmt: skip
    return out


async def _state() -> dict[str, Any]:
    p = _ollama()
    chosen = get_chosen_model()
    env = get_settings().ollama_model
    try:
        models = await asyncio.to_thread(p.installed_models)
        reachable, detail = True, None
    except AIUnavailable as e:
        models, reachable, detail = [], False, e.message
    return {
        "provider": "ollama", "reachable": reachable, "detail": detail, "current": p.model,
        "source": "settings" if chosen else ("env" if env else "none"), "envModel": env or None,
        "models": _describe(models, p.model),
        "needsVision": "Content analysis (Analyse content, Library search) needs a model with vision.",
    }  # fmt: skip


@router.get("/models")
async def models():
    return await _state()


class ChooseModel(CamelModel):
    model: str | None = Field(default=None, max_length=120)  # null = go back to OLLAMA_MODEL from .env


@router.put("/model")
async def choose_model(payload: ChooseModel):
    name = (payload.model or "").strip() or None
    if name:
        installed = {m["name"] for m in await asyncio.to_thread(_ollama().installed_models)}
        if name not in installed:
            raise ValidationFailed(f"'{name}' is not installed in Ollama. Pull it first with `ollama pull {name}`.", code="MODEL_NOT_INSTALLED")
    set_chosen_model(name)
    return await _state()


class TestModel(CamelModel):
    model: str = Field(min_length=1, max_length=120)


# What a good answer looks like for this request: exactly these two actions (and nothing else).
_TEST_REQUEST = "make the music louder and slow down the last shot"
_EXPECTED = {"music_volume", "speed"}


def _run_test(model: str) -> dict[str, Any]:
    base = _ollama()
    provider: AIProvider = OllamaProvider(base.base_url, model, get_settings().ai_timeout_seconds)
    user = json.dumps({
        "request": _TEST_REQUEST,
        "reel": {"shots": [{"n": i, "clip": f"clip{i}.mp4", "seconds": 3.0, "speed": 1.0, "effect": "none", "transition": "cut"} for i in range(1, 5)],
                 "duration": 12, "style": "cinematic", "pace": "balanced", "captions": False, "has_voice": False},
        "styles": sorted(s.id for s in list_styles()),
    })  # fmt: skip
    t = time.monotonic()
    try:
        data = provider.chat_json(rv.system_prompt(), user)
    except Exception as e:  # noqa: BLE001 - reported to the user, never raised
        return {"model": model, "ok": False, "seconds": round(time.monotonic() - t, 1), "verdict": "failed", "detail": getattr(e, "message", str(e))[:200]}
    secs = round(time.monotonic() - t, 1)
    acts, _ = rv.parse_ai_actions(data, 4, {s.id for s in list_styles()}, request_text=_TEST_REQUEST)
    got = {a.kind for a in acts}
    if got == _EXPECTED:
        verdict, detail = "correct", "Understood the request exactly."
    elif _EXPECTED <= got:
        verdict, detail = "over-eager", f"Understood it but also added actions you did not ask for: {', '.join(sorted(got - _EXPECTED))}."
    elif got:
        verdict, detail = "wrong", f"Returned {', '.join(sorted(got))} instead of the two requested changes."
    else:
        verdict, detail = "wrong", "Returned no usable actions."
    return {"model": model, "ok": verdict == "correct", "seconds": secs, "verdict": verdict, "detail": detail}


@router.post("/models/test", dependencies=[Depends(rate_limit("ai-test", 6))])
async def test_model(payload: TestModel):
    """Ask the model to interpret one small change request and grade the answer. Nothing is saved or changed."""
    installed = {m["name"] for m in await asyncio.to_thread(_ollama().installed_models)}
    if payload.model not in installed:
        raise ValidationFailed(f"'{payload.model}' is not installed in Ollama.", code="MODEL_NOT_INSTALLED")
    return await asyncio.to_thread(_run_test, payload.model)


# ====================================================================== provider configuration
def _last_test() -> dict[str, Any] | None:
    try:
        st = get_storage()
        return json.loads(st.read_bytes(LAST_TEST_KEY)) if st.exists(LAST_TEST_KEY) else None
    except Exception:  # noqa: BLE001
        return None


def _status(cfg: ai_config.EffectiveAIConfig) -> dict[str, Any]:
    """Connection status of the text and vision providers (never raises)."""
    out: dict[str, Any] = {}
    for role, name in (("text", cfg.text_provider), ("vision", cfg.vision_provider)):
        try:
            p = build_provider(name, cfg)
            h = p.health()
            if role == "vision":
                h = {**h, "model": p.vision_model or p.model or None}
        except AppError as e:
            h = {"available": False, "model": None, "detail": e.message}
        out[role] = {"provider": name, "local": name in ai_config.LOCAL_PROVIDERS, **h}
    return out


async def _config_view() -> dict[str, Any]:
    cfg = ai_config.effective()
    view = ai_config.public_view(cfg)
    view["status"] = await asyncio.to_thread(_status, cfg)
    view["budget"] = await asyncio.to_thread(budget_state, cfg)
    view["lastTest"] = _last_test()
    view["mode"] = "local" if {cfg.text_provider, cfg.vision_provider} <= ai_config.LOCAL_PROVIDERS else "cloud"
    view["vision"] = {"maxFramesPerClip": get_settings().vision_max_frames_per_clip, "maxImageSize": get_settings().vision_max_image_size,
                      "detail": get_settings().vision_detail_level}  # fmt: skip
    return view


@router.get("/config")
async def get_config():
    return await _config_view()


class ModelsIn(BaseModel):
    text: str | None = Field(default=None, max_length=120)
    vision: str | None = Field(default=None, max_length=120)


class ConfigIn(CamelModel):
    """Only the fields sent are changed. An empty string / null model means "use the .env value"."""

    provider: str | None = None
    text_provider: str | None = None  # "" = same as provider
    vision_provider: str | None = None
    fallback_enabled: bool | None = None
    fallback_provider: str | None = None  # "" = none
    models: dict[str, ModelsIn] | None = None
    task_providers: dict[str, str] | None = None
    daily_budget: float | None = Field(default=None, ge=0)
    monthly_budget: float | None = Field(default=None, ge=0)
    budget_override: bool | None = None


def _provider_name(value: str, field: str, allow_empty: bool = False) -> str | None:
    v = value.strip().lower()
    if not v and allow_empty:
        return None
    if v not in ai_config.PROVIDERS:
        raise ValidationFailed(f"{field}: unknown provider '{value[:30]}'. Use one of: {', '.join(ai_config.PROVIDERS)}.", code="AI_PROVIDER_UNKNOWN")
    return v


@router.put("/config")
async def put_config(payload: ConfigIn):
    saved = ai_config.load_saved()
    sent = payload.model_fields_set
    if "provider" in sent and payload.provider is not None:
        saved.provider = _provider_name(payload.provider, "provider")
    if "text_provider" in sent:
        saved.text_provider = _provider_name(payload.text_provider or "", "textProvider", allow_empty=True)
    if "vision_provider" in sent:
        saved.vision_provider = _provider_name(payload.vision_provider or "", "visionProvider", allow_empty=True)
    if "fallback_enabled" in sent and payload.fallback_enabled is not None:
        saved.fallback_enabled = payload.fallback_enabled
    if "fallback_provider" in sent:
        saved.fallback_provider = _provider_name(payload.fallback_provider or "", "fallbackProvider", allow_empty=True)
    if "task_providers" in sent and payload.task_providers is not None:
        from app.ai.tasks import TASKS

        for task, name in payload.task_providers.items():
            if task not in TASKS:
                raise ValidationFailed(f"Unknown AI task '{task[:30]}'.", code="AI_TASK_UNKNOWN")
            _provider_name(name, f"taskProviders.{task}", allow_empty=True)
        saved.task_providers = {k: v.strip().lower() for k, v in payload.task_providers.items() if v.strip()}
    if payload.models:
        for name, m in payload.models.items():
            _provider_name(name, "models")
            text = (m.text or "").strip() or None
            vision = (m.vision or "").strip() or None
            if name == "ollama" and "text" in m.model_fields_set:
                set_chosen_model(text)  # the Ollama text model keeps its original storage (see model_choice)
                text = None
            cur = saved.models.get(name) or ai_config.ProviderModels()
            if "text" in m.model_fields_set and name != "ollama":
                cur.text = text
            if "vision" in m.model_fields_set:
                cur.vision = vision
            saved.models[name] = cur
    for f in ("daily_budget", "monthly_budget"):
        if f in sent:
            setattr(saved, f, getattr(payload, f))
    if "budget_override" in sent and payload.budget_override is not None:
        saved.budget_override = payload.budget_override
    ai_config.save(saved)
    return await _config_view()


@router.get("/providers/{provider}/models")
async def provider_models(provider: str):
    """Models the provider offers (Ollama: installed; OpenAI/Gemini: listed by the API with the configured key)."""
    name = _provider_name(provider, "provider")
    assert name is not None
    try:
        p = build_provider(name)
        rows = await asyncio.to_thread(p.list_models)
        return {"provider": name, "reachable": True, "detail": None, "models": rows}
    except AppError as e:
        return {"provider": name, "reachable": False, "detail": e.message, "models": []}


class TestIn(CamelModel):
    provider: str | None = None  # default: the text provider in use
    vision: bool = False  # also check the vision model with a tiny generated image


class _TestAnswer(BaseModel):
    status: str
    number: int


def _tiny_jpeg() -> bytes:
    import cv2
    import numpy as np

    img = np.zeros((64, 64, 3), dtype=np.uint8)
    img[:, :] = (40, 40, 220)  # a plain red square
    return cv2.imencode(".jpg", img)[1].tobytes()


def _connection_test(name: str, vision: bool) -> dict[str, Any]:
    cfg = ai_config.effective()
    started = time.monotonic()
    result: dict[str, Any] = {"provider": name, "at": time.strftime("%Y-%m-%dT%H:%M:%S"), "vision": vision}
    try:
        p = ManagedProvider(build_provider(name, cfg), task="test", max_retries=0, config=cfg)  # never falls back: test THIS provider
        result["model"] = (p.vision_model or p.model) if vision else p.model
        if vision:
            ans = p.generate_vision_structured("You check an AI connection.", "What colour is this square? Reply with status='ok' and "
                                               "number=1 if it is red, number=0 otherwise.", [_tiny_jpeg()], _TestAnswer, task="test")  # fmt: skip
        else:
            ans = p.generate_structured("You check an AI connection.", "Reply with status='ok' and number=42.", _TestAnswer, task="test")
        good = ans.status.strip().lower() == "ok" and ans.number == (1 if vision else 42)
        last = p.last_result
        result.update(ok=True, correct=good, detail="Connected; the answer was correct." if good else "Connected, but the answer was not exactly right.",
                      latencyMs=last.latency_ms if last else int((time.monotonic() - started) * 1000),
                      inputTokens=last.input_tokens if last else None, outputTokens=last.output_tokens if last else None)  # fmt: skip
    except AIProviderError as e:
        result.update(ok=False, correct=False, detail=e.message, errorKind=e.kind, errorCode=e.code, latencyMs=int((time.monotonic() - started) * 1000))
    except (AIResponseError, AppError) as e:
        result.update(ok=False, correct=False, detail=e.message, errorCode=e.code, latencyMs=int((time.monotonic() - started) * 1000))
    try:
        get_storage().write_bytes(LAST_TEST_KEY, json.dumps(result).encode())
    except Exception:  # noqa: BLE001 - remembering the result is a convenience
        pass
    return result


@router.post("/test", dependencies=[Depends(rate_limit("ai-test", 6))])
async def test_connection(payload: TestIn):
    """One tiny structured call to the provider (and optionally its vision model). Nothing else changes."""
    name = _provider_name(payload.provider, "provider") if payload.provider else ai_config.effective().text_provider
    assert name is not None
    return await asyncio.to_thread(_connection_test, name, payload.vision)


@router.get("/usage")
async def usage():
    cfg = ai_config.effective()
    out = await asyncio.to_thread(summary)
    out["budget"] = {**(await asyncio.to_thread(budget_state, cfg)), "daily": cfg.daily_budget, "monthly": cfg.monthly_budget,
                     "override": cfg.budget_override}  # fmt: skip
    return out


def active_ai_label(task: str = "director") -> dict[str, Any]:
    """{"provider", "model", "local"} for showing "AI: OpenAI" next to a Reel."""
    try:
        p = get_ai_provider(task)
        return {"provider": p.name, "model": p.model or None, "local": p.is_local}
    except AppError:
        return {"provider": None, "model": None, "local": True}
