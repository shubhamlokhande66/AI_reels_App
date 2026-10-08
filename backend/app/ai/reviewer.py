"""AI Reviewer: reads the measured score card and the edit, and names what to fix, from a fixed vocabulary.

It never scores (the numbers are measured, director/scorecard.py) and never edits: each fix it names is one of the
deterministic revisions the Quality Reviewer already knows how to make (creative_review.revise_once) or a music fix
from the quality checker. Anything else it says is kept as advice for the person. Compact facts only, no frames:
this is a cheap text call, made only when a Reel scores below the threshold.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import Field

from app.ai.provider import AIProvider
from app.ai.schemas import Text, _Answer
from app.models.timeline import Timeline

FIXES = {
    "replace_opening": "open on a stronger shot (the hook is weak)",
    "hero_on_drop": "put the strongest moment on the music's drop / peak",
    "strengthen_middle": "replace a weak shot in the middle (give the time in seconds)",
    "strengthen_ending": "end on a stronger shot",
    "swap_repetitive": "replace a shot that looks like the one before it (give the time)",
    "calm_transitions": "turn unnecessary transitions into clean cuts",
    "split_long_shot": "split a shot that drags in a loud part (give the time)",
    "match_motion": "replace a shot whose movement reverses the one before (give the time)",
    "fade_out_music": "fade the music out at the end",
    "lower_music": "lower the music (it is too loud or clips)",
}


class ReviewerFix(_Answer):
    fix: str = Field(description="|".join(FIXES))
    at: float | None = Field(default=None, description="seconds on the Reel the fix is about, when it is about one shot")
    problem: str = Field(default="", description="one short sentence: what is wrong")


class ReviewerAnswer(_Answer):
    summary: str = Field(default="", description="one sentence: the Reel's biggest weakness")
    fixes: list[ReviewerFix] = []
    advice: list[Text] = Field(default=[], description="anything else for the person, short sentences")


SYSTEM = """You are the reviewing creative director of short vertical videos (Instagram Reels). You get a Reel's measured \
score card (0-100 per area; the numbers are measured, do not argue with them), its creative plan and its shot list. \
Name the fixes that would raise the weakest scores the most, most important first, at most 4, using ONLY these fix names:
""" + "\n".join(f"- {k}: {v}" for k, v in FIXES.items()) + """
Never ask for a fix the shot list shows is already fine. Shots marked locked were set by the person: never fix those.
Answer JSON only: {"summary": "...", "fixes": [{"fix": "...", "at": seconds or null, "problem": "..."}], "advice": ["..."]}"""


def review_facts(card: dict[str, Any], tl: Timeline, plan: dict | None) -> dict[str, Any]:
    shots = [{"at": round(s.timeline_start, 2), "len": round(s.length, 2), "clip": s.video[:30], "effect": s.effect,
              "transition": s.transition_in.type, "locked": s.locked, "why": (s.reason or "")[:80]} for s in tl.segments][:60]  # fmt: skip
    return {"scores": {k: v for k, v in card.items() if k not in ("issues", "measured")}, "measured_issues": card.get("issues", []),
            "plan": {k: (plan or {}).get(k) for k in ("concept", "story", "pacing", "hookType", "hook", "ending") if (plan or {}).get(k)},
            "reel_seconds": round(tl.duration, 2), "shots": shots,
            "texts": [{"text": o.text, "from": round(o.start, 1), "to": round(o.end, 1), "role": o.role} for o in tl.overlays]}  # fmt: skip


def ask_reviewer(provider: AIProvider, card: dict[str, Any], tl: Timeline, plan: dict | None) -> ReviewerAnswer:
    ans = provider.generate_structured(SYSTEM, json.dumps(review_facts(card, tl, plan), ensure_ascii=False), ReviewerAnswer,
                                       task="reviewer", temperature=0.2)  # fmt: skip
    ans.fixes = [f for f in ans.fixes if f.fix in FIXES][:4]  # nothing outside the vocabulary survives
    ans.advice = [a[:200] for a in ans.advice][:4]
    return ans
