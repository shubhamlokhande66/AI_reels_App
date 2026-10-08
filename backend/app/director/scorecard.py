"""The Reviewer's score card: the ten scores a creative director gives a finished Reel, 0-100, plus its issues.

Every score is *measured*, never guessed by a model (an AI reviewer may add issues and fixes, never change a number):

* hook, story, pacing, ending, text_readability  from the Quality Reviewer's review of the EDL (creative_review.py)
* music_sync      share of cuts on a beat / strong hit
* visual_quality  footage quality on screen and motion flow, minus black / frozen frames found in the rendered file
* audio           the rendered file's audio: present, not clipping, near platform loudness, no abrupt start or end
* brand_fit       the edit against the brand kit / brief: its look, its call to action, its colours on the text
* retention       how likely viewers stay: hook, story, pacing and variety together
"""

from __future__ import annotations

from typing import Any

from app.director.creative_review import CreativeReview
from app.models.timeline import Timeline

SCORE_KEYS = ("hook", "story", "pacing", "music_sync", "visual_quality", "brand_fit", "text_readability", "audio", "ending", "retention")
WEIGHTS = {"hook": 0.16, "story": 0.12, "pacing": 0.10, "music_sync": 0.10, "visual_quality": 0.12, "brand_fit": 0.08,
           "text_readability": 0.06, "audio": 0.10, "ending": 0.06, "retention": 0.10}  # fmt: skip
AUDIO_COST = {"NO_AUDIO": 60, "AUDIO_CLIPPING": 25, "AUDIO_LOUDNESS": 12, "AUDIO_ABRUPT_START": 5, "MUSIC_ABRUPT_END": 15, "AUDIO_ENDS_EARLY": 15}
PICTURE_COST = {"BLACK_FRAMES": 15, "DUPLICATE_FRAMES": 12, "WRONG_RESOLUTION": 20}


def _clamp(x: float) -> int:
    return int(round(min(max(x, 0.0), 100.0)))


def _brand_fit(tl: Timeline, brief: dict | None, brand: dict | None) -> tuple[int, list[str]]:
    score, notes = 100.0, []
    brief = brief or {}
    inferred = set(brief.get("inferred") or [])
    look = (brand or {}).get("visualStyle") or (brief.get("style") if "style" not in inferred else None)
    if look and look not in ("auto", tl.style):
        score -= 25
        notes.append(f"the edit's style ({tl.style.replace('_', ' ')}) is not the brand look ({look.replace('_', ' ')})")
    cta = (brand or {}).get("cta") or (brief.get("cta") if "cta" not in inferred else "")
    if cta and not any(o.role == "cta" for o in tl.overlays):
        score -= 20
        notes.append(f"the call to action '{cta}' never appears on screen")
    elif cta and tl.duration > 0:
        last_cta = max(o.start for o in tl.overlays if o.role == "cta")
        if last_cta < tl.duration * 0.6:
            score -= 8
            notes.append("the call to action comes early and is gone by the end")
    if brand and brand.get("colors") and tl.overlays and not tl.caption_color:
        score -= 5  # the text is not in the brand's colours
    if not brand and not look:
        score = min(score, 85)  # nothing to measure against: a neutral score, said plainly
        notes.append("no brand kit: brand fit is judged only on the brief")
    return _clamp(score), notes


def scorecard(review: CreativeReview, *, timeline: Timeline, file_issues: list | None = None, brief: dict | None = None,
              brand: dict | None = None, expect_audio: bool = True, threshold: int = 70) -> dict[str, Any]:  # fmt: skip
    """``file_issues``: quality.checker.check_render_file issues of the rendered file (None = not rendered yet)."""
    c = review.categories
    codes = [i.code for i in file_issues or []]
    audio = 100.0
    for code in codes:
        if code == "NO_AUDIO" and not expect_audio:
            continue
        audio -= AUDIO_COST.get(code, 0)
    picture_cost = sum(PICTURE_COST.get(code, 0) for code in codes)
    brand_fit, brand_notes = _brand_fit(timeline, brief, brand)
    scores = {
        "hook": c.get("hook", 60), "story": c.get("story", 60), "pacing": c.get("pacing", 60), "music_sync": c.get("beat", 70),
        "visual_quality": _clamp(0.8 * c.get("visual", 60) + 0.2 * c.get("motion", 80) - picture_cost),
        "brand_fit": brand_fit, "text_readability": c.get("text", 100), "audio": _clamp(audio),
        "ending": _clamp(c.get("ending", 70) - (15 if "MUSIC_ABRUPT_END" in codes else 0)),
        "retention": _clamp(0.35 * c.get("hook", 60) + 0.25 * c.get("story", 60) + 0.2 * c.get("pacing", 60) + 0.2 * c.get("diversity", 60)),
    }  # fmt: skip
    overall = _clamp(sum(WEIGHTS[k] * scores[k] for k in SCORE_KEYS))
    issues = [i.problem for i in review.issues if i.category != "technical"][:8]
    issues += [i.message for i in file_issues or [] if i.severity != "info" or i.code in AUDIO_COST]
    issues += brand_notes[:2]
    return {"overallScore": overall, **{_camel(k): v for k, v in scores.items()}, "issues": issues[:12], "threshold": threshold,
            "measured": file_issues is not None}  # fmt: skip


def _camel(k: str) -> str:
    head, *rest = k.split("_")
    return head + "".join(w.capitalize() for w in rest)


def weakest(card: dict[str, Any], n: int = 3) -> list[str]:
    """The lowest scores, worst first (snake_case keys), for the correction loop and the AI reviewer."""
    return sorted(SCORE_KEYS, key=lambda k: card.get(_camel(k), 100))[:n]
