"""Titles, descriptions and hashtags for the finished Reel."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass

from app.ai import prompts
from app.ai.provider import AIProvider, AIResponseError
from app.ai.schemas import CopyAnswer

_TAG = re.compile(r"[^0-9A-Za-z_]")


@dataclass
class PostCopy:
    title: str
    description: str
    hashtags: list[str]

    def to_doc(self) -> dict:
        return asdict(self)


def generate_post_copy(
    provider: AIProvider, project_name: str, style: str, bpm: float, duration: float, clip_names: list[str]
) -> PostCopy:
    data = provider.generate_structured(prompts.SYSTEM_EDITOR, prompts.copy_prompt(project_name, style, bpm, duration, clip_names),
                                        CopyAnswer, task="copy", temperature=0.6).model_dump()  # fmt: skip
    title = prompts.clean(data.get("title", "") if isinstance(data.get("title"), str) else "", 60)
    description = prompts.clean(data.get("description", "") if isinstance(data.get("description"), str) else "", 200)
    tags: list[str] = []
    raw = data.get("hashtags")
    for t in raw if isinstance(raw, list) else []:
        tag = _TAG.sub("", str(t))[:30]
        if tag and tag.lower() not in {x.lower() for x in tags}:
            tags.append(tag)
    if not title and not description:
        raise AIResponseError("The AI model returned no usable title or description.")
    return PostCopy(title=title, description=description, hashtags=tags[:8])
