"""Which footage a shot may use: only the GOOD parts of a clip (its usable windows: not dark, blurry or shaky), and
never a moment already shown in the Reel.

The one deliberate exception is a slow-motion *replay* (a speed effect): when every good moment has been used, a shot
may show an earlier moment again, but only slowed down, and it is reported.
"""

from __future__ import annotations

from app.models.analysis import UsableWindow

OVERLAP_TOLERANCE = 0.1  # seconds of shared footage that still count as "a different moment" (frame rounding)
MIN_SLOW = 0.5  # a stretched shot never plays slower than this
REPLAY_SPEED = 0.6  # a replay of a moment already shown is always visibly slowed down


def joined(windows: list[UsableWindow], gap: float = 0.08) -> list[UsableWindow]:
    """Usable windows with touching pieces of the same continuous shot joined again (the analyzer cuts long shots into
    pieces of at most 6 s; for choosing footage they are one good part)."""
    out: list[UsableWindow] = []
    for w in sorted(windows, key=lambda w: w.start):
        prev = out[-1] if out else None
        if prev is not None and w.shot == prev.shot and 0 <= w.start - prev.end <= gap:
            out[-1] = prev.model_copy(update={"end": w.end, "quality": min(prev.quality, w.quality)})
        else:
            out.append(w)
    return out


def overlap_seconds(a0: float, a1: float, used: list[tuple[float, float]]) -> float:
    return sum(max(0.0, min(a1, b1) - max(a0, b0)) for b0, b1 in used)


def is_fresh(a0: float, a1: float, used: list[tuple[float, float]]) -> bool:
    return overlap_seconds(a0, a1, used) <= OVERLAP_TOLERANCE


def free_spans(windows: list[UsableWindow], used: list[tuple[float, float]]) -> list[tuple[float, float, UsableWindow]]:
    """The good parts of a clip that have not been shown yet: usable windows minus the used ranges."""
    out: list[tuple[float, float, UsableWindow]] = []
    for w in windows:
        pieces = [(w.start, w.end)]
        for u0, u1 in sorted(used):
            nxt = []
            for p0, p1 in pieces:
                if u1 <= p0 or u0 >= p1:
                    nxt.append((p0, p1))
                    continue
                if u0 > p0:
                    nxt.append((p0, u0))
                if u1 < p1:
                    nxt.append((u1, p1))
            pieces = nxt
        out += [(a, b, w) for a, b in pieces if b - a > 0.05]
    return out


def place(windows: list[UsableWindow], need: float, used: list[tuple[float, float]], near: float | None = None,
          ) -> tuple[float, float, UsableWindow] | None:  # fmt: skip
    """A fresh range of ``need`` seconds inside a good part, as close to ``near`` as possible (None = the best part)."""
    spans = [s for s in free_spans(windows, used) if s[1] - s[0] >= need - 1e-6]
    if not spans:
        return None
    if near is None:
        a, b, w = max(spans, key=lambda s: (s[2].quality, s[1] - s[0]))
        return a, a + need, w

    def start_in(s: tuple[float, float, UsableWindow]) -> float:
        return min(max(near, s[0]), s[1] - need)

    a, b, w = min(spans, key=lambda s: abs(start_in(s) - near))
    st = start_in((a, b, w))
    return st, st + need, w


def longest_free(windows: list[UsableWindow], used: list[tuple[float, float]]) -> tuple[float, float, UsableWindow] | None:
    spans = free_spans(windows, used)
    return max(spans, key=lambda s: s[1] - s[0]) if spans else None
