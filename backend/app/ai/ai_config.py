"""The AI configuration in effect: ``.env`` defaults + what the user saved in Settings.

Saved choices live in a small JSON file in the storage folder (``settings/ai_config.json``) so the synchronous
provider factory can read them without a database call. API keys are NEVER saved here: they stay in the backend
environment. The Ollama text model keeps using the older ``settings/ai_model.json`` (see ``model_choice``), so a model
picked before this upgrade is still the one in use.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from app.ai.model_choice import get_chosen_model
from app.ai.tasks import get_task
from app.core.config import get_settings
from app.storage import get_storage

log = logging.getLogger(__name__)
KEY = "settings/ai_config.json"
PROVIDERS = ("ollama", "openai", "gemini")
LOCAL_PROVIDERS = frozenset({"ollama"})


class ProviderModels(BaseModel):
    text: str | None = Field(default=None, max_length=120)
    vision: str | None = Field(default=None, max_length=120)


class SavedAIConfig(BaseModel):
    """Only what the user changed; ``None`` = use ``.env``."""

    provider: str | None = None
    text_provider: str | None = None
    vision_provider: str | None = None
    fallback_enabled: bool | None = None
    fallback_provider: str | None = None
    models: dict[str, ProviderModels] = {}
    task_providers: dict[str, str] = {}  # optional per-task override, e.g. {"director": "openai", "copy": "gemini"}
    daily_budget: float | None = Field(default=None, ge=0)
    monthly_budget: float | None = Field(default=None, ge=0)
    budget_override: bool = False  # True = keep running non-essential AI after a budget is used up


@dataclass
class EffectiveAIConfig:
    provider: str
    text_provider: str
    vision_provider: str
    fallback_enabled: bool
    fallback_provider: str
    models: dict[str, tuple[str, str]]  # provider -> (text model, vision model)
    task_providers: dict[str, str] = field(default_factory=dict)
    daily_budget: float = 0.0  # in the display currency; 0 = no limit
    monthly_budget: float = 0.0
    budget_override: bool = False

    def provider_for(self, task: str | None) -> str:
        override = self.task_providers.get(task or "")
        if override in PROVIDERS:
            return override  # type: ignore[return-value]
        return self.vision_provider if get_task(task).kind == "vision" else self.text_provider


def _norm(name: str | None) -> str:
    """Lower-case name, kept even when unknown: the factory reports an unknown provider clearly instead of silently
    using another one."""
    return (name or "").strip().lower()


def load_saved() -> SavedAIConfig:
    try:
        storage = get_storage()
        if not storage.exists(KEY):
            return SavedAIConfig()
        return SavedAIConfig.model_validate(json.loads(storage.read_bytes(KEY).decode("utf-8")))
    except Exception:  # noqa: BLE001 - a damaged settings file must never take the AI features down
        log.warning("Could not read the saved AI settings; using the .env values.")
        return SavedAIConfig()


def save(cfg: SavedAIConfig) -> None:
    get_storage().write_bytes(KEY, cfg.model_dump_json(exclude_none=False).encode("utf-8"))


def effective(saved: SavedAIConfig | None = None) -> EffectiveAIConfig:
    s = get_settings()
    saved = saved or load_saved()
    provider = _norm(saved.provider) or _norm(s.ai_provider) or "ollama"
    text = _norm(saved.text_provider) or _norm(s.ai_text_provider) or provider
    vision = _norm(saved.vision_provider) or _norm(s.ai_vision_provider) or provider
    fb_enabled = s.ai_fallback_enabled if saved.fallback_enabled is None else saved.fallback_enabled
    fallback = _norm(saved.fallback_provider) or _norm(s.ai_fallback_provider)

    def pick(p: str, env_text: str, env_vision: str) -> tuple[str, str]:
        m = saved.models.get(p) or ProviderModels()
        t = (m.text or "").strip() or env_text.strip()
        return t, (m.vision or "").strip() or env_vision.strip() or t

    ollama_text = get_chosen_model() or s.ollama_model
    models = {
        "ollama": pick("ollama", ollama_text, s.ollama_vision_model),
        "openai": pick("openai", s.openai_text_model, s.openai_vision_model),
        "gemini": pick("gemini", s.gemini_text_model, s.gemini_vision_model),
    }
    return EffectiveAIConfig(
        provider=provider, text_provider=text, vision_provider=vision, fallback_enabled=bool(fb_enabled),
        fallback_provider=fallback, models=models,
        task_providers={k: _norm(v) for k, v in saved.task_providers.items() if _norm(v) in PROVIDERS},
        daily_budget=s.daily_ai_budget if saved.daily_budget is None else saved.daily_budget,
        monthly_budget=s.monthly_ai_budget if saved.monthly_budget is None else saved.monthly_budget,
        budget_override=saved.budget_override,
    )  # fmt: skip


def key_configured(provider: str) -> bool:
    """Whether the backend has a key for ``provider`` (the key itself never leaves the backend)."""
    s = get_settings()
    if provider == "openai":
        return bool(s.openai_api_key.get_secret_value().strip())
    if provider == "gemini":
        return bool(s.gemini_api_key.get_secret_value().strip())
    return True


def public_view(cfg: EffectiveAIConfig) -> dict[str, Any]:
    """What the browser may see: choices and whether keys exist, never the keys."""
    return {
        "provider": cfg.provider, "textProvider": cfg.text_provider, "visionProvider": cfg.vision_provider,
        "fallbackEnabled": cfg.fallback_enabled, "fallbackProvider": cfg.fallback_provider or None,
        "taskProviders": cfg.task_providers,
        "providers": [
            {"id": p, "label": {"ollama": "Ollama", "openai": "OpenAI", "gemini": "Gemini"}[p], "local": p in LOCAL_PROVIDERS,
             "keyConfigured": key_configured(p), "textModel": cfg.models[p][0] or None, "visionModel": cfg.models[p][1] or None}
            for p in PROVIDERS
        ],
        "dailyBudget": cfg.daily_budget, "monthlyBudget": cfg.monthly_budget, "budgetOverride": cfg.budget_override,
        "currency": get_settings().ai_currency,
    }  # fmt: skip
