"""Structured output: every AI answer that enters the app is a validated Pydantic model.

Providers that support schema-constrained output (OpenAI, Gemini) get the schema natively; the others (Ollama, simple
providers) get JSON mode plus the schema in the prompt. Either way the answer is validated here. If it does not
validate, the model gets ONE controlled repair attempt (its own answer + the validation errors); if that fails too,
``AIResponseError`` is raised and the caller falls back to deterministic behaviour. Malformed output never reaches the
Timeline.
"""

from __future__ import annotations

import copy
import json
import logging
from typing import TYPE_CHECKING, Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.ai.types import AIRequest, AIResult

if TYPE_CHECKING:
    from app.ai.provider import AIProvider

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_DROP = {"title", "default", "examples"}


def _inline(node: Any, defs: dict[str, Any], depth: int = 0) -> Any:
    if depth > 12:
        return {}
    if isinstance(node, dict):
        if "$ref" in node:
            target = defs.get(str(node["$ref"]).split("/")[-1], {})
            merged = {**copy.deepcopy(target), **{k: v for k, v in node.items() if k != "$ref"}}
            return _inline(merged, defs, depth + 1)
        return {k: _inline(v, defs, depth + 1) for k, v in node.items() if k not in _DROP and k != "$defs"}
    if isinstance(node, list):
        return [_inline(v, defs, depth + 1) for v in node]
    return node


def json_schema(model: type[BaseModel]) -> dict[str, Any]:
    """A self-contained JSON schema (no $refs, no titles/defaults): small enough to put in a prompt, and accepted by
    providers that do not resolve references."""
    raw = model.model_json_schema()
    return _inline(raw, raw.get("$defs", {}))


def schema_hint(model: type[BaseModel]) -> str:
    return "Reply with ONE JSON object that matches this JSON schema exactly (no extra keys, no prose):\n" + json.dumps(
        json_schema(model), separators=(",", ":"), ensure_ascii=False
    )


def _errors(exc: ValidationError, limit: int = 6) -> str:
    parts = []
    for e in exc.errors()[:limit]:
        loc = ".".join(str(p) for p in e.get("loc", ())) or "(root)"
        parts.append(f"{loc}: {e.get('msg', '')}")
    return "; ".join(parts)


def validate(model: type[T], result: AIResult) -> T:
    """Raise ``ValidationError`` / ``ValueError`` if the answer is not a valid ``model``."""
    if result.parsed is None:
        raise ValueError("the answer was not a JSON object")
    return model.model_validate(result.parsed)


def run_structured(provider: AIProvider, req: AIRequest, model: type[T]) -> tuple[T, AIResult]:
    """Ask, validate, repair once, or raise ``AIResponseError``."""
    from app.ai.provider import AIResponseError

    req.schema = model
    first = provider.generate(req)
    try:
        return validate(model, first), first
    except (ValidationError, ValueError) as exc:
        problem = _errors(exc) if isinstance(exc, ValidationError) else str(exc)
        log.info("AI answer for %s did not validate (%s); asking once more", req.task, problem)
    repair = AIRequest(
        system=req.system,
        user=(f"{req.user}\n\nYour previous answer was not valid: {problem}.\nPrevious answer: {first.text[:1500]}\n"
              "Answer again with only the corrected JSON object."),  # fmt: skip
        messages=None if req.messages is None else [*req.messages, {"role": "assistant", "content": first.text[:1500]},
                                                     {"role": "user", "content": f"That was not valid ({problem}). Answer again with only the corrected JSON object."}],  # fmt: skip
        images=req.images, schema=model, temperature=0.0 if req.temperature is not None else None, task=req.task,
        max_output_tokens=req.max_output_tokens,
    )  # fmt: skip
    second = provider.generate(repair)
    try:
        out = validate(model, second)
    except (ValidationError, ValueError) as exc:
        detail = _errors(exc) if isinstance(exc, ValidationError) else str(exc)
        raise AIResponseError(f"The AI model's answer did not match the expected format ({detail[:200]}).",
                              details=second.text[:300]) from exc  # fmt: skip
    second.warnings.append("The first answer was invalid and was repaired.")
    return out, second
