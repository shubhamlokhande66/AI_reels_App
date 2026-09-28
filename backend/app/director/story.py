"""What the Reel is about and which clip belongs where: the story, from what the clips actually show.

Everything here works from the vision model's description of each clip (``ClipSemantic``). Without it the app cannot know what a
clip shows, and it says so instead of guessing from file names (file names are only used as a last, disclosed fallback).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.ai.understanding import ClipSemantic

# Words in a clip's description that vote for a category. Deliberately small and plain: a vote needs real words from the model.
_VOTES: dict[str, set[str]] = {
    "food": {"food", "dish", "cook", "cooking", "kitchen", "recipe", "dough", "paratha", "roti", "curry", "pan", "wok", "bowl", "rice", "potato",
             "onion", "spice", "spices", "chop", "chopping", "fry", "frying", "stove", "plate", "plating", "meal", "batter", "flour", "knead", "kneading", "rolling"},
    "jewelry": {"jewelry", "jewellery", "ring", "necklace", "earring", "earrings", "bracelet", "diamond", "pendant", "gold", "gemstone", "bangle"},
    "product": {"product", "bottle", "packaging", "package", "box", "gadget", "device", "cosmetic", "shoe", "bag", "watch"},
    "fashion": {"dress", "outfit", "fashion", "model", "wearing", "saree", "jacket", "clothes", "clothing", "runway"},
    "travel": {"beach", "mountain", "landscape", "travel", "city", "sky", "road", "temple", "sunset", "lake", "forest", "tourist", "trip"},
    "beauty": {"makeup", "skincare", "lipstick", "hair", "face", "salon", "cosmetics"},
    "fitness": {"gym", "workout", "exercise", "running", "yoga", "fitness", "training"},
    "event": {"wedding", "party", "celebration", "festival", "crowd", "concert", "birthday"},
    "education": {"whiteboard", "classroom", "lecture", "teacher", "school"},
    "tutorial": {"tutorial", "laptop", "screen", "diy", "craft", "assembling"},
}
STYLE_HINT = {"food": "food", "travel": "travel", "luxury": "jewelry"}

# Recipe order. Higher = later in the Reel.
STAGE_RANK = {"ingredients": 0, "preparation": 1, "cooking": 2, "plating": 3, "finished": 4}
FINAL_STAGES = ("plating", "finished")


@dataclass
class Category:
    name: str = "other"
    confidence: float = 0.0
    source: str = "none"  # vision | style | none
    evidence: list[str] = field(default_factory=list)


def detect_category(semantics: list[ClipSemantic | None], style_id: str = "", steps: bool = False) -> Category:
    """The main kind of content, by majority of what the clips show (the vision model's own category counts double)."""
    known = [s for s in semantics if s is not None]
    scores: dict[str, float] = {}
    words: dict[str, set[str]] = {}
    for s in known:
        if s.category != "other":
            scores[s.category] = scores.get(s.category, 0) + 2.0
        terms = s.terms
        for cat, vocab in _VOTES.items():
            hit = terms & vocab
            if hit:
                scores[cat] = scores.get(cat, 0) + min(len(hit), 3) * 0.5
                words.setdefault(cat, set()).update(hit)
    if known and scores:
        best = max(scores, key=lambda c: scores[c])
        total = sum(scores.values())
        return Category(best, round(scores[best] / total, 2), "vision", sorted(words.get(best, set()))[:6])
    hint = STYLE_HINT.get(style_id)
    if hint:
        return Category(hint, 0.3, "style", [f"the {style_id} style was chosen"])
    return Category()


def stage_of(sem: ClipSemantic | None) -> str | None:
    """The recipe stage the vision model saw, or None when it did not say (never guessed from the file name)."""
    if sem is None or sem.stage not in STAGE_RANK:
        return None
    return sem.stage


@dataclass
class StoryOrder:
    clips: list  # the clips in story order
    hook: object | None  # the clip that gives the opening teaser (a striking finished result)
    used_vision: bool = False
    moved: list[str] = field(default_factory=list)  # names of clips the story moved away from the base order
    notes: list[str] = field(default_factory=list)


def order_for_food(base: list, log_prefix: str = "") -> StoryOrder:
    """Put clips in recipe order using what they show: ingredients, preparation, cooking, plating, finished dish.

    ``base`` is the fallback order (recording time / the user's list). A clip whose stage is unknown keeps the rank of the clip before
    it, so the story never scatters clips the model could not place. Sorting is stable: within a stage the base order is kept.
    """
    ranks = [STAGE_RANK.get(stage_of(getattr(c, "semantic", None)) or "", None) for c in base]
    if not any(r is not None for r in ranks):
        return StoryOrder(list(base), None)
    carried, filled = 0, []
    for r in ranks:
        carried = r if r is not None else carried
        filled.append(carried)
    order = sorted(range(len(base)), key=lambda i: (filled[i], i))
    clips = [base[i] for i in order]
    moved = [base[i].name for i, j in zip(order, range(len(base))) if i != j]
    notes = []
    if moved:
        notes.append("Clips were arranged by what they show (ingredients, preparation, cooking, then serving) rather than by file name.")
    finals = [c for c in clips if stage_of(getattr(c, "semantic", None)) in FINAL_STAGES]
    hook = None
    if finals:
        hook = max(finals, key=lambda c: (bool(c.semantic.hook_candidate or c.semantic.ending_candidate), c.semantic.importance))
    known = sum(r is not None for r in ranks)
    if known < len(base):
        notes.append(f"The vision model could place {known} of {len(base)} clips in the recipe; the others stay next to the clip before them.")
    return StoryOrder(clips, hook, True, moved, notes)
