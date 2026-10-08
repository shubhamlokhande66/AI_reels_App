"""Director patches: creative change requests the Creative Director carries out on the CURRENT edit, without rebuilding.

"Make the first 3 seconds stronger" / "change the hook"   -> replace_hook   (the strongest unused opening)
"Use the music drop for the product reveal"               -> drop_reveal    (the strongest moment onto the drop)
"Show the product earlier"                                -> product_earlier (the clearest product shot moves to shot 2)

Each is an edit patch ``{"operation", "target", "reason"}`` carried out by the same deterministic revisions the Reviewer
uses (creative_review.revise_once), so the cuts, the music sync, the text and every other shot stay as they are. The
person's request names its target, so a shot they locked by hand may change here (and only that one); it stays locked.

``to_patch`` describes ANY revise action as a patch, so the person and the API see one vocabulary.
"""

from __future__ import annotations

import re
from typing import Any

from app.director.creative_review import CreativeReview, Issue, _peak_index, _window, revise_once
from app.models.timeline import Timeline

DIRECTOR_KINDS = ("replace_hook", "drop_reveal", "product_earlier")
PRODUCT_CATEGORIES = {"product", "jewelry", "fashion", "beauty"}


def _has(c: str, pat: str) -> bool:
    return re.search(pat, c) is not None


def parse_director(c: str):
    """A revise rule (actions.py): the creative requests above, or None."""
    from app.revise.actions import Action

    if _has(c, r"\b(?:change|replace|swap|new|different|better|stronger|improve)\b.*\b(?:hook|opening|intro|start)\b(?!\s*text)") or \
            _has(c, r"\b(?:first|opening)\s+(?:\d|one|two|three|few)?\s*(?:seconds?|secs?|moments?|shot)\b.*\b(?:stronger|better|punchier|more (?:engaging|exciting))\b") or \
            _has(c, r"\b(?:hook|opening|intro|start)\b.*\b(?:stronger|better|punchier|weak|boring)\b"):  # fmt: skip
        if not _has(c, r"\bhook text\b|\bhook\s*(?::|=|says?|reads?|to\s*[\"'])"):
            return [Action("replace_hook", scope="first")]
    if _has(c, r"\bdrop\b") and _has(c, r"\b(?:reveal|best|hero|strongest|product|highlight)\b"):
        return [Action("drop_reveal")]
    if _has(c, r"\b(?:product|item|it|ring|dress|dish|bag|shoe|watch)\b.*\b(?:earlier|sooner|first|at the start|right away|upfront)\b") and \
            _has(c, r"\b(?:show|reveal|bring|see|put)\b"):  # fmt: skip
        return [Action("product_earlier")]
    return None


def describe(kind: str) -> str:
    return {"replace_hook": "A stronger opening: the best unused hook moment in your footage",
            "drop_reveal": "The strongest moment lands on the music's drop",
            "product_earlier": "The clearest product shot comes earlier (shot 2)"}[kind]  # fmt: skip


def to_patch(a, tl: Timeline | None = None) -> dict[str, Any]:
    """Any revise Action as an edit patch: {operation, target, reason, value?}."""
    n = len(tl.segments) if tl is not None else 0
    target = {"first": "timeline[0]", "last": f"timeline[{max(n - 1, 0)}]" if n else "timeline[-1]"}.get(a.scope)
    if a.scope == "shot" and a.shot:
        target = f"timeline[{a.shot - 1}]"
    op = {"replace_hook": "replace_hook", "drop_reveal": "move_hero_to_drop", "product_earlier": "move_product_earlier", "delete": "remove_shot",
          "move": "move_shot", "speed": "set_speed", "effect": "set_effect", "transition": "set_transition", "duration": "set_duration",
          "style": "change_style", "pace": "change_pace", "reshuffle": "rebuild", "captions_on": "add_captions", "captions_off": "remove_captions",
          "music_volume": "set_music_volume", "mute_music": "mute_music", "music_fade": "fade_music", "grade": "set_grade", "cta": "set_cta",
          "hook_text": "set_hook_text", "text_off": "remove_text", "text_less": "reduce_text", "framing": "set_crop"}.get(a.kind, a.kind)  # fmt: skip
    if target is None:
        target = {"music_volume": "music", "mute_music": "music", "music_fade": "music", "grade": "look", "style": "edit", "pace": "edit",
                  "duration": "edit", "cta": "text", "hook_text": "text", "text_off": "text", "text_less": "text",
                  "drop_reveal": "music.drop", "product_earlier": "timeline[1]"}.get(a.kind, "timeline")  # fmt: skip
    out = {"operation": op, "target": target, "reason": "user_request" if a.source == "rules" else "user_request_ai_interpreted"}
    if a.value is not None:
        out["value"] = a.value
    return out


def _product_value(clip, w) -> float:
    sem = clip.semantic if clip is not None else None
    is_product = sem is not None and sem.category in PRODUCT_CATEGORIES
    vis = clip.analysis.product_visibility if clip is not None and clip.analysis.product_visibility is not None else None
    base = vis if vis is not None else (0.5 * w.subject + 0.3 * w.quality + (0.2 if w.shot_size == "close" else 0.0))
    return base + (0.5 if is_product else 0.0)


def swap_footage(tl: Timeline, i: int, k: int, by_id: dict) -> bool:
    """Swap the footage of shots ``i`` and ``k``, keeping every cut time (rhythm and music sync unchanged). Undone, and
    False, when a slot of a different length would make a shot show a moment another shot of that clip already shows."""
    from app.video import footage

    a, b = tl.segments[i], tl.segments[k]
    before = (a.model_copy(), b.model_copy())
    fa = (a.clip_id, a.video, a.source_start, a.speed, a.focus_x, a.focus_y, a.focus_source, a.reason)
    fb = (b.clip_id, b.video, b.source_start, b.speed, b.focus_x, b.focus_y, b.focus_source, b.reason)
    for seg, f in ((a, fb), (b, fa)):
        seg.clip_id, seg.video, seg.source_start, seg.speed, seg.focus_x, seg.focus_y, seg.focus_source, seg.reason = f
        seg.source_end = round(seg.source_start + seg.length * seg.speed, 3)
        room = by_id[seg.clip_id].analysis.metadata.duration if seg.clip_id in by_id else None
        if room is not None and seg.source_end > room:  # a longer slot than the footage had: start earlier
            seg.source_start = round(max(room - seg.length * seg.speed, 0.0), 3)
            seg.source_end = round(min(room, seg.source_start + seg.length * seg.speed), 3)
    for j in (i, k):
        s = tl.segments[j]
        others = [(o.source_start, o.source_end) for n, o in enumerate(tl.segments) if n != j and o.clip_id == s.clip_id]
        if footage.overlap_seconds(s.source_start, s.source_end, others) > 0.1:
            tl.segments[i], tl.segments[k] = before
            return False
    return True


def apply_patches(tl: Timeline, kinds: list[str], clips, mm, *, brief: str = "") -> tuple[Timeline, list[str]]:
    """Carry out the director patches on a copy of ``tl``. Returns (new timeline, notes)."""
    out = tl.model_copy(deep=True)
    notes: list[str] = []
    by_id = {c.clip_id: c for c in clips}

    def run(fix: str, index: int, problem: str) -> list[str]:
        seg = out.segments[index]
        was = seg.locked
        seg.locked = False  # the person's request names this shot
        changed = revise_once(out, CreativeReview(0, {}, [Issue(seg.timeline_start, problem, "high", "request", fix)]), clips, mm, brief=brief)
        seg.locked = was or bool(changed)  # a shot changed on request is the person's choice now: keep it locked
        return changed

    for kind in kinds:
        if kind == "replace_hook" and out.segments:
            done = run("replace_opening", 0, "the person asked for a stronger opening")
            notes += done or ["The opening is already the strongest unused moment in your footage."]
        elif kind == "drop_reveal":
            peak = _peak_index(out, mm)
            if peak is None:
                notes.append("This part of the song has no clear drop or peak inside the Reel to put the reveal on.")
                continue
            done = run("hero_on_drop", peak, "the person asked for the reveal on the drop")
            notes += done or [f"The strongest moment is already on the music's peak (shot {peak + 1})."]
        elif kind == "product_earlier":
            if len(out.segments) < 3:
                notes.append("The Reel is too short to move the product earlier.")
                continue
            vals = [(i, _product_value(by_id.get(s.clip_id), _window(by_id.get(s.clip_id), s.source_start))) for i, s in enumerate(out.segments)
                    if _window(by_id.get(s.clip_id), s.source_start) is not None]  # fmt: skip
            if not vals:
                notes.append("The footage of this Reel was not analysed, so the product shot could not be found.")
                continue
            best_i = max(vals, key=lambda v: v[1])[0]
            if best_i <= 1:
                notes.append("The clearest product shot is already at the start.")
                continue
            a, b = out.segments[1], out.segments[best_i]
            if a.locked and best_i != 1:
                notes.append("Shot 2 was set by hand, so the product shot was not moved there.")
                continue
            if not swap_footage(out, 1, best_i, by_id):
                notes.append("The clearest product shot could not move to shot 2 without showing a moment twice.")
                continue
            a.locked = True
            notes.append(f"Moved the clearest product shot ({a.video}) to shot 2; the cuts and the music sync are unchanged.")
    return out, notes
