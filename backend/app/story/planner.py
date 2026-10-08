"""Story text -> scenes. One AI call writes the plan; without AI the story is split into scenes by sentence (plainer, but
it always works). The plan is only words: nothing here makes pictures or sound."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

from app.ai.provider import AIResponseError, AIUnavailable, get_provider
from app.core.errors import ValidationFailed
from app.story.models import ART_STYLES, Character, StoryPlan, StoryScene

log = logging.getLogger(__name__)
MIN_SCENES, MAX_SCENES = 3, 14
LANG_NAMES = {"hi": "Hindi", "en": "English", "mr": "Marathi", "hinglish": "Hinglish (Hindi in Latin letters)"}
MOODS = {"calm", "devotional", "joyful", "tense", "sad", "epic", "mysterious"}

SYSTEM = """You are a film director turning a story into a vertical short video (Instagram Reel) told with one picture per
scene and a narrator's voice. Reply with JSON only."""

PROMPT = """Story:
<<<
{story}
>>>

Make a plan for a {seconds}-second Reel with {scenes} scenes (fewer if the story is short).
Rules:
- Scene 1 is a hook: the most gripping moment or question of the story, told so a viewer keeps watching.
- narration: what the narrator says in {language}, 8-25 words per scene, natural and spoken, in story order after the hook.
  Keep names and Sanskrit words correct. The last scene ends the story with a feeling or a lesson.
- visual: what the single picture shows, in English, one or two sentences: who, doing what, where, light and mood. Describe
  people by their character name. No text or letters in the picture.
- characters: every recurring person once, with a fixed visual description in English (age, skin, hair, clothing, ornaments,
  weapon or symbol) so every picture shows them the same. Respectful, traditional depictions for deities and epic heroes.
- keywords: 2-5 English words for searching a matching painting (names first, e.g. "Krishna", "Arjuna", "chariot").
- shot: wide | medium | close. mood: calm | devotional | joyful | tense | sad | epic | mysterious.
- post: a short title, a one-line description and 5-8 hashtags for posting.

JSON shape:
{{"title": "...", "music_mood": "devotional", "characters": [{{"name": "...", "look": "..."}}],
  "scenes": [{{"narration": "...", "visual": "...", "characters": ["..."], "keywords": ["..."], "shot": "wide", "mood": "epic"}}],
  "post": {{"title": "...", "description": "...", "hashtags": ["#..."]}}}}"""


def _clean(s: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()[:limit]


def _scene(d: dict[str, Any], names: set[str]) -> StoryScene | None:
    narration, visual = _clean(d.get("narration"), 600), _clean(d.get("visual"), 700)
    if not narration or not visual:
        return None
    shot = d.get("shot") if d.get("shot") in ("wide", "medium", "close") else "medium"
    mood = d.get("mood") if d.get("mood") in MOODS else "calm"
    chars = [c for c in (_clean(x, 60) for x in d.get("characters") or []) if c in names]
    keywords = [k for k in (_clean(x, 40) for x in d.get("keywords") or []) if k][:5]
    return StoryScene(id=uuid.uuid4().hex[:10], narration=narration, visual=visual, characters=chars, keywords=keywords, shot=shot, mood=mood)


def from_ai(data: dict[str, Any], language: str, art_style: str, fallback_title: str) -> StoryPlan:
    """Validate the AI's reply: unknown values become defaults, empty scenes are dropped, limits are enforced."""
    characters = [Character(name=_clean(c.get("name"), 60), look=_clean(c.get("look"), 300))
                  for c in data.get("characters") or [] if isinstance(c, dict) and _clean(c.get("name"), 60)][:8]  # fmt: skip
    names = {c.name for c in characters}
    scenes = [s for s in (_scene(d, names) for d in data.get("scenes") or [] if isinstance(d, dict)) if s][:MAX_SCENES]
    if len(scenes) < 2:
        raise ValidationFailed("The AI could not turn this story into scenes. Try a longer or clearer story.", code="STORY_PLAN_EMPTY")
    post = data.get("post") if isinstance(data.get("post"), dict) else None
    post_copy = None
    if post:
        tags = [t if str(t).startswith("#") else f"#{t}" for t in (post.get("hashtags") or []) if str(t).strip()][:10]
        post_copy = {"title": _clean(post.get("title"), 100), "description": _clean(post.get("description"), 300), "hashtags": tags}
    return StoryPlan(title=_clean(data.get("title"), 120) or fallback_title, language=language, art_style=art_style,
                     music_mood=_clean(data.get("music_mood"), 30) or "devotional", characters=characters, scenes=scenes,
                     post_copy=post_copy)  # fmt: skip


def simple_plan(story: str, language: str, art_style: str, scenes: int, title: str) -> StoryPlan:
    """No AI: the story's sentences grouped into scenes; each picture is described by its own words."""
    sentences = [s.strip() for s in re.split(r"(?<=[.!?।|])\s+|\n+", story) if s.strip()]
    if not sentences:
        raise ValidationFailed("Write the story first.", code="STORY_EMPTY")
    n = max(1, min(scenes, len(sentences)))
    per = -(-len(sentences) // n)
    out = []
    for i in range(0, len(sentences), per):
        text = " ".join(sentences[i : i + per])[:600]
        out.append(StoryScene(id=uuid.uuid4().hex[:10], narration=text, visual=text[:700], mood="calm", shot="wide" if not out else "medium"))
    return StoryPlan(title=title, language=language, art_style=art_style, scenes=out)


def plan_story(story: str, language: str = "hi", art_style: str = "ravi_varma", scenes: int = 8, seconds: int = 60) -> StoryPlan:
    story = story.strip()
    if len(story) < 40:
        raise ValidationFailed("Write a little more of the story (at least a few sentences).", code="STORY_TOO_SHORT")
    if art_style not in ART_STYLES:
        raise ValidationFailed("Unknown art style.", code="INVALID_ART_STYLE")
    scenes = min(max(scenes, MIN_SCENES), MAX_SCENES)
    title = _clean(story.split("\n", 1)[0], 60) or "My story"
    try:
        data = get_provider().chat_json(
            SYSTEM, PROMPT.format(story=story[:12000], seconds=seconds, scenes=scenes, language=LANG_NAMES.get(language, "Hindi")),
            temperature=0.6, task="general",
        )
        plan = from_ai(data, language, art_style, title)
    except (AIUnavailable, AIResponseError) as exc:  # no AI, or a reply that is not a plan: the plain split still works
        log.info("story planner without AI: %s", exc)
        plan = simple_plan(story, language, art_style, scenes, title).model_copy(update={"planned_by": "simple"})
    return plan.model_copy(update={"source_text": story[:12000], "seconds": seconds})
