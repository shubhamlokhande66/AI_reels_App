"""Where sound effects belong: the director places them on the edit's own events, never at random.

* whoosh: on a moving transition (zoom, slide, whip, speed ramp ...), timed to land on the cut
* riser: building into the music's drop
* impact: on the drop / the hero moment
* pop: when an on-screen text appears

Few and purposeful: at most ``MAX_EFFECTS``, never two within ``MIN_GAP`` seconds, and none for luxury-calm cuts
(dissolves and fades get no whoosh).
"""

from __future__ import annotations

from app.audio.sfx import LENGTH
from app.director.music_map import MusicMap
from app.models.timeline import SoundEffect, Timeline

MOVING = ("zoom", "slide", "speed_ramp", "flash", "wipe", "smooth", "squeeze", "wind", "cover", "reveal", "whip", "circle", "slice")
MAX_EFFECTS = 12
MIN_GAP = 0.4


def plan_sfx(tl: Timeline, mm: MusicMap | None) -> list[SoundEffect]:
    wanted: list[tuple[int, SoundEffect]] = []  # (priority, effect): lower = more important
    for s in tl.segments[1:]:
        t = s.transition_in.type
        if t != "cut" and any(t.startswith(m) for m in MOVING):
            at = max(s.timeline_start - LENGTH["whoosh"] * 0.6, 0.0)
            wanted.append((2, SoundEffect(type="whoosh", at=round(at, 3), volume=0.55)))
    drops = [d for d in (mm.drops if mm else []) if 1.0 < d < tl.duration - 0.5]
    for d in drops[:2]:
        if d >= LENGTH["riser"] + 0.3:
            wanted.append((1, SoundEffect(type="riser", at=round(d - LENGTH["riser"], 3), volume=0.45)))
        wanted.append((0, SoundEffect(type="impact", at=round(d, 3), volume=0.8)))
    for o in sorted(tl.overlays, key=lambda o: o.start)[:4]:
        wanted.append((3, SoundEffect(type="pop", at=round(o.start, 3), volume=0.5)))

    chosen: list[SoundEffect] = []
    for _, e in sorted(wanted, key=lambda pe: (pe[0], pe[1].at)):
        if len(chosen) >= MAX_EFFECTS:
            break
        if e.type != "riser" and any(abs(e.at - c.at) < MIN_GAP and c.type != "riser" for c in chosen):
            continue
        chosen.append(e)
    return sorted(chosen, key=lambda e: e.at)
