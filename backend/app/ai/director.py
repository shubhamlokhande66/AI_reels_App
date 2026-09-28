"""Story planning: which clip plays which narrative role (hook, context, build-up, main, payoff, CTA).

Not every Reel needs every section: the model chooses the roles that fit the material. Its JSON is
validated (known roles, known clips, canonical order) and becomes a soft ordering hint for the selector.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.ai import prompts
from app.ai.provider import AIProvider, AIResponseError
from app.ai.schemas import StoryAnswer
from app.ai.script import LANGUAGES
from app.video.timeline import ClipInput

ROLES = ("hook", "context", "buildup", "main", "payoff", "cta")


@dataclass
class StoryPlan:
    structure: list[str]  # roles used, in order
    assignments: dict[str, list[str]] = field(default_factory=dict)  # role -> clip ids
    hook: str = ""
    cta: str = ""
    reason: str = ""


def _rows(clips: list[ClipInput]) -> tuple[list[dict], dict[str, str]]:
    rows, alias = [], {}
    for i, c in enumerate(clips, 1):
        key = f"clip_{i}"
        alias[key] = c.clip_id
        sem = c.semantic
        rows.append({"alias": key, "name": prompts.clean(c.name, 40), "scene": sem.scene if sem else "", "tags": sem.tags[:6] if sem else [],
                     "summary": sem.summary if sem else "", "quality": c.analysis.quality_score, "usable": c.analysis.usable})  # fmt: skip
    return rows, alias


def parse_story(data: dict, alias: dict[str, str]) -> StoryPlan:
    raw = data.get("structure")
    found: dict[str, list[str]] = {}
    used: set[str] = set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip().lower()
        if role not in ROLES:
            continue
        for a in item.get("clips", []) if isinstance(item.get("clips"), list) else []:
            key = str(a).strip()
            if key in alias and key not in used:
                found.setdefault(role, []).append(alias[key])
                used.add(key)
        found.setdefault(role, found.get(role, []))
    structure = [r for r in ROLES if r in found]
    if not structure:
        raise AIResponseError("The AI model returned no usable story structure.")
    leftover = [alias[k] for k in alias if k not in used]  # clips the model forgot still get used, in the main section
    if leftover:
        target = "main" if "main" in found else structure[len(structure) // 2]
        found[target] = found.get(target, []) + leftover
    hook = prompts.clean(data.get("hook", "") if isinstance(data.get("hook"), str) else "", 120)
    cta = prompts.clean(data.get("cta", "") if isinstance(data.get("cta"), str) else "", 100)
    reason = prompts.clean(data.get("reason", "") if isinstance(data.get("reason"), str) else "", 200)
    return StoryPlan(structure=structure, assignments=found, hook=hook, cta=cta, reason=reason)


def story_order_hint(plan: StoryPlan, all_clip_ids: list[str]) -> dict[str, float]:
    """clip id -> 0..1 preferred position, following the story from first role to last."""
    order: list[str] = []
    for role in plan.structure:
        order += [c for c in plan.assignments.get(role, []) if c not in order]
    order += [c for c in all_clip_ids if c not in order]
    n = max(len(order) - 1, 1)
    return {c: i / n for i, c in enumerate(order)}


def plan_story(provider: AIProvider, brief: str, language: str, clips: list[ClipInput], duration: int) -> StoryPlan:
    rows, alias = _rows(clips)
    data = provider.generate_structured(
        prompts.SYSTEM_EDITOR,
        f'Plan the story of a {duration}s Reel. Language of any text: {LANGUAGES.get(language, "English")}.\n'
        f'Brief: "{prompts.clean(brief, 300)}".\nClips: {rows}\n'
        f"Choose only the narrative roles this material needs, from {list(ROLES)} (hook = strongest opening moment, payoff = "
        "the satisfying result, cta = call to action). Assign each clip alias to one role, in playing order.\n"
        'Return JSON: {"structure": [{"role": "hook", "clips": ["clip_2"]}], "hook": "<opening line>", '
        '"cta": "<call to action>", "reason": "<one sentence>"}',
        StoryAnswer, task="story", temperature=0.3,
    ).model_dump()
    return parse_story(data, alias)
