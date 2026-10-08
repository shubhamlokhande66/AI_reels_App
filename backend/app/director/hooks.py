"""The hook engine: up to five possible openings for the Reel's first 1-3 seconds, each typed and scored.

Candidates come from the measured best moments of every clip (video/moments.py) and each usable window's strongest
stretch, scored with the same hook judgement the whole app uses (director/intelligence.py), plus:

* clarity          is one subject clearly readable at a glance (face / salient subject, composition, not empty)
* curiosity        does it make you want the next second (striking subject, unlike the rest, a moment mid-action)
* visual_strength  sharp, well-lit, with movement from the first frame

Each candidate gets a hook type (what kind of opening it is) so the Creative Director can choose a *kind* of hook,
not just a clip. Openings from the same clip are limited to two, and different types are preferred, so the five
options are real alternatives. Pure functions, no AI, no I/O.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.director import intelligence as intel
from app.models.analysis import UsableWindow
from app.video.timeline import ClipInput, _windows_of, brief_terms

MAX_HOOKS = 5
HOOK_MIN, HOOK_MAX = 1.0, 2.5  # seconds an opening shot lasts
HOOK_TYPES = ("visual_surprise", "product_reveal", "fast_movement", "curiosity", "transformation", "close_up",
              "pattern_interrupt", "text_hook")  # fmt: skip
PRODUCT = {"product", "jewelry", "fashion", "beauty"}
WHY = {
    "visual_surprise": "something appears out of an empty frame", "product_reveal": "the product comes into full view",
    "fast_movement": "strong movement from the first frame", "curiosity": "a person mid-moment: viewers want the next second",
    "transformation": "opens on the finished result, then shows how it got there", "close_up": "a sharp close-up with one clear subject",
    "pattern_interrupt": "looks unlike anything else in the feed", "text_hook": "a calm, clean shot that lets the hook text do the work",
}  # fmt: skip


@dataclass
class HookOption:
    clip_id: str
    name: str
    start: float
    end: float
    type: str
    hook_score: float
    clarity: float
    curiosity: float
    visual_strength: float
    reason: str
    text: str = ""

    def to_doc(self) -> dict:
        r = lambda x: round(float(x), 3)  # noqa: E731
        return {"clipId": self.clip_id, "asset": self.name, "start": round(self.start, 2), "end": round(self.end, 2), "type": self.type,
                "hookScore": r(self.hook_score), "clarity": r(self.clarity), "curiosity": r(self.curiosity),
                "visualStrength": r(self.visual_strength), "reason": self.reason, "text": self.text}  # fmt: skip


def _hook_type(clip: ClipInput, w: UsableWindow, moment: str | None, novelty: float) -> str:
    sem = clip.semantic
    cat = sem.category if sem else None
    if moment == "reveal":
        return "product_reveal" if cat in PRODUCT else "visual_surprise"
    if moment == "subject_close" and cat in PRODUCT:
        return "product_reveal"
    if sem is not None and (sem.ending_candidate or sem.stage == "finished") and cat in ("food", "beauty", "fashion"):
        return "transformation"
    if moment == "face_appears" or (w.face and w.subject_motion > 0.3):
        return "curiosity"
    if max(w.subject_motion, w.camera_motion, w.motion) >= 0.55 or moment == "action_peak" and w.motion >= 0.4:
        return "fast_movement"
    if w.shot_size == "close" or moment in ("subject_close", "focus_peak"):
        return "close_up"
    if novelty >= 0.45:
        return "pattern_interrupt"
    return "visual_surprise" if moment == "camera_settles" else "close_up" if w.subject >= 0.5 else "curiosity"


def _span(w: UsableWindow, t: float | None) -> tuple[float, float]:
    """An opening of HOOK_MIN..HOOK_MAX seconds that starts a beat before the event (or at the window's motion peak)."""
    length = min(HOOK_MAX, max(HOOK_MIN, (w.end - w.start) * 0.5), w.end - w.start)
    if t is None:
        t = w.start + (w.motion_curve.index(max(w.motion_curve)) * w.curve_dt if w.motion_curve else 0.0)
    a = min(max(t - 0.4, w.start), w.end - length)
    return round(a, 3), round(a + length, 3)


def generate_hooks(clips: list[ClipInput], brief: str = "", hook_text: str = "", k: int = MAX_HOOKS) -> list[HookOption]:
    pool = [c for c in clips if c.analysis.usable] or clips
    terms = brief_terms(brief)
    sigs = [w.signature for c in pool for w in _windows_of(c)]
    cands: list[HookOption] = []
    for c in pool:
        events = {(round(m.t, 2), m.kind) for m in c.analysis.moments}
        for w in _windows_of(c):
            spots: list[tuple[float | None, str | None]] = [(t, kind) for t, kind in events if w.start <= t <= w.end] or [(None, None)]
            for t, kind in spots:
                parts = intel.hook_parts(c, w, terms, [s for s in sigs if s is not w.signature])
                a, b = _span(w, t)
                motion = w.motion_between(a, b)
                clarity = parts["clarity"]
                curiosity = min(0.55 * parts["curiosity"] + 0.3 * parts["novelty"] + (0.15 if kind else 0.0), 1.0)
                visual = min(0.6 * parts["impact"] + 0.4 * (1.0 - abs(motion - 0.6) / 0.6), 1.0)
                event_bonus = 0.06 if kind in ("reveal", "face_appears", "action_peak", "subject_close") else 0.03 if kind else 0.0
                score = min(intel.hook_score(parts) + event_bonus, 1.0)
                htype = _hook_type(c, w, kind, parts["novelty"])
                cands.append(HookOption(c.clip_id, c.name, a, b, htype, score, clarity, curiosity, visual, WHY[htype]))
    out: list[HookOption] = []
    per_clip: dict[str, int] = {}
    types: set[str] = set()
    for h in sorted(cands, key=lambda h: -h.hook_score):  # the best first, then different clips and different kinds of hook
        if len(out) >= k:
            break
        if per_clip.get(h.clip_id, 0) >= 2 or any(o.clip_id == h.clip_id and o.start < h.end and h.start < o.end for o in out):
            continue
        if h.type in types and len(out) >= 1 and any(c.type not in types for c in cands if c.hook_score >= h.hook_score - 0.08 and c is not h
                                                      and per_clip.get(c.clip_id, 0) < 2):  # fmt: skip
            continue  # a nearly as strong opening of another kind exists: offer that instead
        out.append(h)
        per_clip[h.clip_id] = per_clip.get(h.clip_id, 0) + 1
        types.add(h.type)
    if len(out) < k:  # top up with the remaining best, whatever their type
        for h in sorted(cands, key=lambda h: -h.hook_score):
            if len(out) >= k:
                break
            if h not in out and per_clip.get(h.clip_id, 0) < 2 and not any(o.clip_id == h.clip_id and o.start < h.end and h.start < o.end for o in out):
                out.append(h)
                per_clip[h.clip_id] = per_clip.get(h.clip_id, 0) + 1
    if hook_text and out:  # a text hook: the calmest clean option carries the words
        calm = min(out, key=lambda h: abs(h.visual_strength - 0.6) + (0.3 if h.type == "fast_movement" else 0.0))
        out.append(HookOption(calm.clip_id, calm.name, calm.start, calm.end, "text_hook", round(calm.hook_score * 0.95, 3),
                              calm.clarity, min(calm.curiosity + 0.2, 1.0), calm.visual_strength, WHY["text_hook"], text=hook_text[:80]))  # fmt: skip
        out = sorted(out, key=lambda h: -h.hook_score)[:k]
    return sorted(out, key=lambda h: -h.hook_score)
