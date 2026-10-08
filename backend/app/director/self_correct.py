"""Self-correction after rendering: review -> identify the problems -> change the EDL -> render again -> review again.

Bounded: at most ``max_iterations`` reviews in all (the first render counts), and a correction is kept only when the
measured score goes up, so the loop always ends and never makes the Reel worse. Every change is a deterministic edit
decision the app already knows how to make:

* creative fixes from the Quality Reviewer's issues and the AI reviewer's named fixes (creative_review.revise_once):
  a stronger opening, the hero moment on the drop, a stronger middle / ending, a repetitive or direction-reversing
  shot swapped, needless transitions turned into cuts, a dragging shot split on the beat;
* audio fixes from the rendered file (quality/checker.py): clipping / loudness -> music volume, abrupt start / end ->
  fades.

Shots the person locked by editing them by hand are never changed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.director.creative_review import CreativeReview, Issue, revise_once
from app.models.timeline import Timeline
from app.quality.checker import TARGET_LUFS

MAX_ITERATIONS = 3
AUDIO_FIXES = ("AUDIO_CLIPPING", "AUDIO_LOUDNESS", "MUSIC_ABRUPT_END", "AUDIO_ABRUPT_START")


@dataclass
class Round:
    iteration: int
    score_before: int
    score_after: int | None = None
    changes: list[str] = field(default_factory=list)
    kept: bool = False
    ai_summary: str = ""

    def to_doc(self) -> dict:
        return {"iteration": self.iteration, "scoreBefore": self.score_before, "scoreAfter": self.score_after,
                "changes": self.changes, "kept": self.kept, "aiSummary": self.ai_summary}  # fmt: skip


def _seg_start_near(tl: Timeline, t: float | None) -> float | None:
    if t is None or not tl.segments:
        return None
    return min(tl.segments, key=lambda s: abs(s.timeline_start - t)).timeline_start


def audio_fixes(tl: Timeline, file_issues: list, ai_fixes: list) -> list[str]:
    """Apply the music fixes the rendered file calls for, in place. Returns what changed."""
    done: list[str] = []
    codes = {i.code: i for i in file_issues}
    names = {f.fix for f in ai_fixes}
    if "AUDIO_CLIPPING" in codes or "lower_music" in names:
        tl.music_volume = max(round(tl.music_volume * 0.85, 3), 0.2)
        done.append(f"lowered the music to {tl.music_volume:.2f}x so it does not clip")
    elif "AUDIO_LOUDNESS" in codes:
        lufs = codes["AUDIO_LOUDNESS"].details.get("lufs")
        if lufs is not None:
            tl.music_volume = round(min(max(tl.music_volume * 10 ** ((TARGET_LUFS - lufs) / 20), 0.2), 2.0), 3)
            done.append(f"set the music to {tl.music_volume:.2f}x for platform loudness")
    if ("MUSIC_ABRUPT_END" in codes or "fade_out_music" in names) and (tl.music_fade_out or 0) < 1.0:
        tl.music_fade_out = 1.5
        done.append("faded the music out at the end")
    if "AUDIO_ABRUPT_START" in codes and (tl.music_fade_in or 0) < 0.2:
        tl.music_fade_in = 0.3
        done.append("faded the music in")
    return done


def correct(tl: Timeline, review: CreativeReview, file_issues: list, ai_fixes: list, clips, mm, *, brief: str = "",
            max_transition_ratio: float = 0.5) -> tuple[Timeline, list[str]]:  # fmt: skip
    """One correction round on a copy of ``tl``. Returns (candidate, changes); no changes = nothing more to try."""
    cand = tl.model_copy(deep=True)
    issues = [i for i in review.issues if i.fix]
    for f in ai_fixes:  # the AI reviewer's named fixes join the measured ones (same deterministic revisions)
        if f.fix in ("fade_out_music", "lower_music"):
            continue
        at = _seg_start_near(cand, f.at) if f.at is not None else (cand.segments[-1].timeline_start if f.fix == "strengthen_ending" else 0.0)
        if at is not None and not any(i.fix == f.fix and abs(i.timestamp - at) < 1e-3 for i in issues):
            issues.append(Issue(at, f.problem or f.fix, "medium", "ai_review", f.fix))
    changes = revise_once(cand, CreativeReview(review.overall_score, review.categories, issues), clips, mm, brief=brief,
                          max_transition_ratio=max_transition_ratio) if issues else []  # fmt: skip
    changes += audio_fixes(cand, file_issues, ai_fixes)
    return cand, changes
