"""Provider factory: which provider (and model) serves which task.

Resolution for a task: per-task override (Settings) -> AI_TEXT_PROVIDER / AI_VISION_PROVIDER -> AI_PROVIDER.
Saved Settings win over ``.env``. The result is wrapped in ``ManagedProvider`` (budget, retries, fallback, usage log).
"""

from __future__ import annotations

from app.ai.ai_config import PROVIDERS, EffectiveAIConfig, effective
from app.ai.managed import ManagedProvider
from app.ai.provider import AIProvider
from app.core.config import get_settings
from app.core.errors import AIUnavailable


def build_provider(name: str, cfg: EffectiveAIConfig | None = None) -> AIProvider:
    """The raw provider ``name`` with its configured models (no retries/fallback/logging)."""
    s = get_settings()
    cfg = cfg or effective()
    if name not in PROVIDERS:
        raise AIUnavailable(f"Unknown AI_PROVIDER '{name}'. Use one of: {', '.join(PROVIDERS)}.", code="AI_PROVIDER_UNKNOWN")
    text, vision = cfg.models[name]
    if name == "ollama":
        from app.ai.ollama import OllamaProvider

        return OllamaProvider(s.ollama_base_url, text, s.ai_timeout_seconds, vision_model=vision if vision != text else "")
    if name == "openai":
        from app.ai.openai_provider import OpenAIProvider

        return OpenAIProvider(s.openai_api_key.get_secret_value(), text, vision if vision != text else "", s.cloud_ai_timeout_seconds,
                              s.openai_base_url)  # fmt: skip
    from app.ai.gemini_provider import GeminiProvider

    return GeminiProvider(s.gemini_api_key.get_secret_value(), text, vision if vision != text else "", s.cloud_ai_timeout_seconds)


def get_ai_provider(task: str | None = None) -> ManagedProvider:
    cfg = effective()
    primary = build_provider(cfg.provider_for(task), cfg)
    fallback = None
    if cfg.fallback_enabled and cfg.fallback_provider in PROVIDERS and cfg.fallback_provider != primary.name:
        fallback = build_provider(cfg.fallback_provider, cfg)
    return ManagedProvider(primary, task=task or "general", fallback=fallback, max_retries=get_settings().ai_max_retries, config=cfg)
