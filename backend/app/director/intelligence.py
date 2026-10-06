"""Creative judgement as plain, deterministic scoring: which opening hooks hardest, which moment deserves the music's
biggest hit, which shots flow into each other, and a one-line reason for every choice.

Pure functions over the existing analyses (no I/O, no AI). The rule-based editor uses them to choose shots; the AI
director receives their results as facts; the reviewer uses the same numbers to judge a finished edit. So the whole app
agrees on what "a strong hook" or "the hero moment" means.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.analysis import UsableWindow
from app.video.timeline import ClipInput, _windows_of, brief_terms, relevance

HOOK_CANDIDATES = 3  # openings compared before one is chosen (spec: "generate 3 possible openings")
HERO_SPAN = 1.5  # seconds of footage that make "the hero moment"
HERO_MARGIN = 1.08  # it must beat the typical moment by this much to be worth holding back
HOOK_WEIGHTS = {"impact": 0.30, "motion": 0.15, "clarity": 0.20, "curiosity": 0.15, "novelty": 0.10, "relevance": 0.10}


@dataclass
class HookCandidate:
    clip_id: str
    name: str
    start: float
    end: float
    score: float
    parts: dict[str, float] = field(default_factory=dict)

    @property
    def reason(self) -> str:
        best = sorted(((k, v * HOOK_WEIGHTS[k]) for k, v in self.parts.items()), key=lambda kv: -kv[1])[:2]
        words = {"impact": "sharp, well-lit picture", "motion": "movement from the first frame", "clarity": "a clear subject",
                 "curiosity": "a striking subject", "novelty": "looks unlike the rest", "relevance": "matches the brief"}
        return " and ".join(words[k] for k, _ in best)

    def to_doc(self) -> dict:
        return {"clipId": self.clip_id, "asset": self.name, "start": round(self.start, 2), "end": round(self.end, 2),
                "score": round(self.score, 3), "parts": {k: round(v, 3) for k, v in self.parts.items()}, "reason": self.reason}


@dataclass
class HeroMoment:
    clip_id: str
    name: str
    start: float
    end: float
    score: float

    def to_doc(self) -> dict:
        return {"clipId": self.clip_id, "asset": self.name, "start": round(self.start, 2), "end": round(self.end, 2), "score": round(self.score, 3)}


def _distinct(sig: list[float], others: list[list[float]]) -> float:
    """0..1: how different this colour signature is from the average of the other windows."""
    others = [o for o in others if o and len(o) == len(sig)]
    if not sig or not others:
        return 0.5
    mean = [sum(col) / len(others) for col in zip(*others)]
    return min(max(1.0 - sum(min(a, b) for a, b in zip(sig, mean)), 0.0), 1.0)


def hook_parts(clip: ClipInput, w: UsableWindow, terms: set[str], others: list[list[float]]) -> dict[str, float]:
    sem = clip.semantic
    clarity = 1.0 if w.face else (0.75 if w.focus_source in ("subject", "motion") else 0.45)
    curiosity = (0.6 * sem.importance + (0.4 if sem.hook_candidate else 0.0)) if sem else 0.4
    return {
        "impact": 0.6 * w.quality + 0.4 * w.sharpness,
        "motion": 1.0 - abs(w.motion - 0.6) / 0.6,  # something happening, but not a blur
        "clarity": clarity,
        "curiosity": min(curiosity, 1.0),
        "novelty": _distinct(w.signature, others),
        "relevance": relevance(clip, terms),
    }


def hook_score(parts: dict[str, float]) -> float:
    return sum(HOOK_WEIGHTS[k] * min(max(v, 0.0), 1.0) for k, v in parts.items())


def rank_hooks(clips: list[ClipInput], brief: str = "", k: int = HOOK_CANDIDATES) -> list[HookCandidate]:
    """The ``k`` strongest possible openings, at most one per clip, best first."""
    pool = [c for c in clips if c.analysis.usable] or clips
    terms = brief_terms(brief)
    sigs = [w.signature for c in pool for w in _windows_of(c)]
    best: dict[str, HookCandidate] = {}
    for c in pool:
        for w in _windows_of(c):
            parts = hook_parts(c, w, terms, [s for s in sigs if s is not w.signature])
            s = hook_score(parts)
            if c.clip_id not in best or s > best[c.clip_id].score:
                best[c.clip_id] = HookCandidate(c.clip_id, c.name, w.start, w.end, s, parts)
    return sorted(best.values(), key=lambda h: -h.score)[:k]


PRODUCT_CATEGORIES = {"product", "jewelry", "fashion", "beauty", "food"}


def subject_value(clip: ClipInput, w: UsableWindow) -> float:
    """0..1: how clearly a moment shows a subject (a face, a product, a framed object) rather than general footage."""
    sem = clip.semantic
    framed = 1.0 if w.face else (0.7 if w.focus_source in ("subject", "motion") else 0.2)
    product = 1.0 if sem is not None and sem.category in PRODUCT_CATEGORIES else (0.4 if sem is None else 0.1)
    return 0.5 * framed + 0.3 * product + 0.2 * w.sharpness


def hero_value(clip: ClipInput, w: UsableWindow, a: float, b: float) -> float:
    """0..1: how much a moment deserves the strongest point of the music (quality, movement, importance)."""
    imp = clip.semantic.importance if clip.semantic else 0.5
    return 0.5 * w.quality + 0.3 * w.motion_between(a, b) + 0.2 * imp


def find_hero(clips: list[ClipInput], span: float = HERO_SPAN) -> HeroMoment | None:
    """The single strongest moment of all the footage: kept back for the music's biggest hit."""
    pool = [c for c in clips if c.analysis.usable] or clips
    best: HeroMoment | None = None
    per_window: list[float] = []
    for c in pool:
        for w in _windows_of(c):
            if w.length < span * 0.6:
                continue
            length = min(span, w.length)
            steps = max(int((w.length - length) / 0.25), 0) + 1
            top = 0.0
            for i in range(steps):
                a = w.start + i * 0.25
                v = hero_value(c, w, a, a + length)
                top = max(top, v)
                if best is None or v > best.score:
                    best = HeroMoment(c.clip_id, c.name, round(a, 3), round(a + length, 3), v)
            per_window.append(top)
    if best is None or len(per_window) < 2:
        return best
    typical = sorted(per_window)[len(per_window) // 2]
    return best if best.score >= typical * HERO_MARGIN else None  # nothing stands out: nothing is held back


def hero_slot(slots, high_energy: float = 0.6) -> int | None:
    """Index of the slot the hero moment belongs to: the most intense one in the middle of the Reel (a drop, else the
    loudest strong beat). None when the music has no clear peak (then nothing is reserved)."""
    middle = [s for s in slots[1:-1]]
    if not middle:
        return None
    total = slots[-1].end or 1.0
    # loudest strong moment; when the music is evenly loud, the classic peak about 60% into the Reel
    best = max(middle, key=lambda s: s.energy + (0.25 if s.on_strong else 0.0) - 0.15 * abs(s.start / total - 0.6))
    return best.index if best.energy >= high_energy or best.on_strong else None


def motion_match(prev: UsableWindow | None, w: UsableWindow) -> float:
    """+1 when the next shot continues the previous movement, -1 when it reverses it (a jarring cut), 0 otherwise."""
    if prev is None:
        return 0.0
    a, b = prev.direction, w.direction
    if a == "still" or b == "still":
        return 0.0
    if a == b:
        return 1.0
    return -1.0 if {a, b} in ({"left", "right"}, {"up", "down"}) else 0.0


def shot_reason(*, index: int, n: int, clip_name: str, first_use: bool, hook: HookCandidate | None, hero: bool,
                drop_at: float | None, match: float, energy: float, quality: float, slow: bool, relevant: bool,
                prev_direction: str) -> str:  # fmt: skip
    """One sentence a person understands: why this shot, here."""
    if index == 0 and hook is not None:
        return f"Opens on {clip_name}: the strongest of {HOOK_CANDIDATES} possible openings ({hook.reason})."
    bits: list[str] = []
    if hero:
        where = f"the drop at {drop_at:.1f}s" if drop_at is not None else "the music's peak"
        bits.append(f"saved the strongest moment of the footage for {where}")
    if match > 0:
        bits.append(f"keeps the {prev_direction}ward movement of the shot before (a natural match cut)")
    if slow:
        bits.append("slowed down because the music is calm here")
    if relevant:
        bits.append("shows what the brief asks for")
    if index == n - 1:
        bits.append("ends on a clean, high-quality shot")
    if not bits:
        if energy >= 0.6:
            bits.append("a lively moment for an energetic part of the song")
        elif energy < 0.4:
            bits.append("a steady moment for a calm part of the song")
        else:
            bits.append(f"the best unused footage here (quality {quality:.2f})")
    if first_use and not hero and index not in (0, n - 1):
        bits.append("brings in new footage")
    text = "; ".join(bits)
    return f"{clip_name}: {text[0].upper()}{text[1:]}."
