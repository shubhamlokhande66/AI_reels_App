"""LLM-assisted edit decisions: clip ordering and style choice.

Both return validated, bounded results; anything the model gets wrong is ignored or repaired,
so the model can influence *preferences* but can never break the render.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from app.ai import prompts
from app.ai.provider import AIProvider
from app.ai.schemas import OrderAnswer, StyleAnswer
from app.models.analysis import AudioAnalysis
from app.styles import EditingStyle
from app.video.timeline import ClipInput


@dataclass
class OrderSuggestion:
    hint: dict[str, float]  # clip_id -> 0..1 preferred position in the reel
    reason: str


@dataclass
class StyleSuggestion:
    style_id: str
    reason: str


def _describe(clips: list[ClipInput]) -> tuple[list[dict], dict[str, str]]:
    """Compact prompt rows + alias -> real clip id map (the model never sees internal ids)."""
    rows, alias = [], {}
    for i, c in enumerate(clips, 1):
        a = c.analysis
        key = f"clip_{i}"
        alias[key] = c.clip_id
        rows.append({
            "alias": key, "name": prompts.clean(c.name, 50), "orientation": a.metadata.orientation,
            "seconds": round(a.metadata.duration, 1), "quality": a.quality_score, "motion": a.motion_score,
            "brightness": a.brightness_score, "usable": a.usable,
        })  # fmt: skip
    return rows, alias


def suggest_clip_order(
    provider: AIProvider, clips: list[ClipInput], audio: AudioAnalysis, duration: int
) -> OrderSuggestion:
    if len(clips) < 2:
        return OrderSuggestion({c.clip_id: 0.0 for c in clips}, "Only one clip.")
    rows, alias = _describe(clips)
    data = provider.generate_structured(prompts.SYSTEM_EDITOR, prompts.order_prompt(rows, audio.bpm, duration), OrderAnswer,
                                        task="order", temperature=0.2).model_dump()
    return OrderSuggestion(hint=_order_to_hint(data.get("order"), alias), reason=_short(data.get("reason")))


def _order_to_hint(order: object, alias: Mapping[str, str]) -> dict[str, float]:
    """Keep only known aliases (first occurrence wins), append any the model forgot, map to 0..1."""
    seen: list[str] = []
    if isinstance(order, list):
        for item in order:
            key = str(item).strip()
            if key in alias and key not in seen:
                seen.append(key)
    seen += [k for k in alias if k not in seen]
    n = max(len(seen) - 1, 1)
    return {alias[k]: i / n for i, k in enumerate(seen)}


def suggest_style(
    provider: AIProvider, styles: list[EditingStyle], clips: list[ClipInput], audio: AudioAnalysis, project_name: str
) -> StyleSuggestion:
    rows, _ = _describe(clips)
    catalogue = {s.id: s.description for s in styles if s.id != "custom"}
    data = provider.generate_structured(prompts.SYSTEM_EDITOR, prompts.style_prompt(catalogue, rows, audio.bpm, project_name),
                                        StyleAnswer, task="style", temperature=0.2).model_dump()
    chosen = str(data.get("style", "")).strip().lower()
    if chosen not in catalogue:
        from app.ai.provider import AIResponseError

        raise AIResponseError(f"The AI model chose an unknown style '{chosen[:40]}'.")
    return StyleSuggestion(chosen, _short(data.get("reason")))


def _short(text: object, limit: int = 200) -> str:
    return prompts.clean(text if isinstance(text, str) else "", limit)
