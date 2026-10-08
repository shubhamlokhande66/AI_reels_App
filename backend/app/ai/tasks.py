"""The AI tasks of the app. Each has a kind (text or vision), which decides the provider/model it runs on, and says
whether it is *essential*: essential tasks are the ones a person asked for directly (chat, a change request, a script);
non-essential ones are automatic polish the pipeline can do without, and those stop first when a budget runs out.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TaskSpec:
    id: str
    kind: str  # "text" | "vision"
    essential: bool
    label: str


TASKS: dict[str, TaskSpec] = {t.id: t for t in (
    TaskSpec("clip_understanding", "vision", False, "Clip understanding"),
    TaskSpec("product_understanding", "vision", False, "Product photo understanding"),
    TaskSpec("style", "text", False, "Style selection"),
    TaskSpec("story", "text", False, "Story planning"),
    TaskSpec("order", "text", False, "Shot order"),
    TaskSpec("director", "text", False, "Creative director"),
    TaskSpec("product_director", "text", False, "Product creative director"),
    TaskSpec("copy", "text", False, "Post copy"),
    TaskSpec("reviewer", "text", False, "Reel reviewer"),
    TaskSpec("library_search", "text", False, "Library search"),
    TaskSpec("hooks", "text", True, "Hook generation"),
    TaskSpec("script", "text", True, "Script writing"),
    TaskSpec("revision", "text", True, "Natural-language revision"),
    TaskSpec("template", "text", True, "Template drafts"),
    TaskSpec("chat", "text", True, "Chat"),
    TaskSpec("test", "text", True, "Connection test"),
    TaskSpec("general", "text", True, "Other"),
)}  # fmt: skip


def get_task(task: str | None) -> TaskSpec:
    return TASKS.get(task or "general") or TASKS["general"]
