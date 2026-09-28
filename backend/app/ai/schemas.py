"""Typed shapes of AI answers. Every AI result is validated against one of these before the app uses it.

They are deliberately *lenient in type* (numbers given as strings are accepted, unknown keys are ignored) and
*strict in meaning*: the existing sanitizers (known styles, known clip aliases, length limits ...) still run on the
validated data, so a model can influence preferences but never inject values the app does not support.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field


def _to_text(v: object) -> object:
    """Numbers where text is expected (a hashtag 5, a tag 2024) become text; the sanitizers decide what to keep."""
    return str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else v


Text = Annotated[str, BeforeValidator(_to_text)]


class _Answer(BaseModel):
    model_config = ConfigDict(extra="ignore")


class OrderAnswer(_Answer):
    order: list[Text] = Field(description="every clip alias exactly once, in playing order")
    reason: str = ""


class StyleAnswer(_Answer):
    style: str = Field(description="one style id from the list")
    reason: str = ""


class CopyAnswer(_Answer):
    title: str = Field(description="max 60 characters")
    description: str = Field(description="max 200 characters, 1-2 sentences")
    hashtags: list[Text] = Field(description="5 to 8 hashtags without #")


class StoryRole(_Answer):
    role: str
    clips: list[Text]


class StoryAnswer(_Answer):
    structure: list[StoryRole]
    hook: str = ""
    cta: str = ""
    reason: str = ""


class ClipSemanticAnswer(_Answer):
    scene: str = ""
    objects: list[Text] = []
    people: int = 0
    action: str = ""
    camera: str = "medium"
    tags: list[Text] = []
    summary: str = ""
    importance: float = 0.5
    mood: str = ""
    category: str = "other"
    stage: str = "other"
    hook_candidate: bool = False
    ending_candidate: bool = False


class HooksAnswer(_Answer):
    hooks: list[Text]


class ScriptLineAnswer(_Answer):
    text: str
    pause: float | None = None


class ScriptAnswer(_Answer):
    lines: list[ScriptLineAnswer]


class KeywordsAnswer(_Answer):
    keywords: list[Text]


class RevisionActionAnswer(_Answer):
    action: str
    scope: str | None = None
    shot: int | None = None
    factor: float | None = None
    to: str | int | None = None  # "start" | "end" | a shot number
    value: str | float | None = None  # an effect/style name, or a number (seconds, fade length)


class RevisionAnswer(_Answer):
    actions: list[RevisionActionAnswer]
    unclear: str = ""


class TemplateAnswer(_Answer):
    name: str
    description: str = ""
    duration: float = 15
    style: str = ""
    pace: str = "balanced"
    hook: bool = True
    captions: bool = False
    captionStyle: str = "minimal"
    audioMode: str = "music"
    musicSync: bool = True
    ai: bool = False
    language: str = "en"
    exportPreset: str = ""
