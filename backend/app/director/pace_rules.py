"""How fast to cut, from how far apart the beats are: one table, used by the beat-map cut plan (audio/beatmap.py) and
given to the AI editor (director/ai_timeline.py), so both edit the same way. Tune the numbers here.

| beat gap   | BPM      | pace        | cuts                                                    | transitions                       |
|------------|----------|-------------|---------------------------------------------------------|-----------------------------------|
| > 0.80 s   | < 75     | slow        | every beat; every 2nd in calm parts                     | smooth on ~1 cut in 3             |
| 0.50-0.80  | 75-120   | medium      | every beat in loud parts, every 2nd in calm ones        | occasional (~1 in 4), on bars     |
| 0.40-0.50  | 120-150  | medium_fast | every 2nd beat (pulse between); every beat in drops     | occasional (~1 in 5), short       |
| 0.20-0.40  | 150-300  | fast        | every 2nd hit (0.4-0.8 s shots), punch / flash between  | rare (~1 in 8), very short        |
| < 0.20 s   | > 300    | roll        | no cut per hit: a longer shot, stutter / pulse / ramp   | none (a 2-3 cut burst into a drop)|

On top of the table: build-ups cut twice as fast and breakdowns twice as slow; the drop always cuts (a hero shot with
a flash); no shot is ever shorter than the minimum clip length; a transition never lasts more than ~40% of the shot.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Pace:
    name: str
    min_gap: float  # beat gap (s) from ...
    max_gap: float  # ... up to
    step_loud: int  # beats per cut in loud / high-energy parts
    step_calm: int  # beats per cut in calm parts
    transition_every: int  # about one smooth transition every n cuts (the others are hard cuts on the beat)
    max_transition: float  # seconds
    accents: tuple[str, ...]  # what the beats / hits between cuts get (renderer effect names)
    summary: str


PACES: tuple[Pace, ...] = (
    Pace("slow", 0.80, math.inf, 1, 2, 3, 0.5, ("zoom_in", "ken_burns"),
         "normal clips, a cut on the beat, smooth transitions (dissolve, slide) on about 1 cut in 3"),
    Pace("medium", 0.50, 0.80, 1, 2, 4, 0.3, ("zoom_pulse", "punch"),
         "beat-synced cuts (every beat in loud parts, every 2nd in calm ones), an occasional transition on a bar start"),
    Pace("medium_fast", 0.40, 0.50, 2, 2, 5, 0.2, ("zoom_pulse", "beat_punch"),
         "a cut every 2nd beat with a pulse on the beat between; every beat only in a drop or the most energetic part"),
    Pace("fast", 0.20, 0.40, 2, 3, 8, 0.15, ("beat_punch", "beat_flash"),
         "a cut on every 2nd hit (0.4-0.8 s shots) with punch-ins / flashes on the hits between; fast-cut bursts only in a build-up (2 s at most)"),
    Pace("roll", 0.0, 0.20, 4, 6, 0, 0.0, ("beat_stutter", "zoom_pulse", "speed_ramp"),
         "no cut per hit: a longer shot with rapid accents (stutter punches, pulses) or a speed ramp; a 2-3 cut burst only into a drop"),
)  # fmt: skip
DROP_EVERY_BEAT = ("medium_fast",)  # paces that cut on every beat right after a drop
DROP_BARS = 2  # ... for this many bars


def pace_for(gap: float) -> Pace:
    """The pace for a beat gap (seconds between beats)."""
    for p in PACES:
        if p.min_gap <= gap < p.max_gap:
            return p
    return PACES[0]


def cut_step(pace: Pace, gap: float, loud: bool, trend: str = "", in_drop: bool = False, min_shot: float = 0.35) -> int:
    """Beats per cut here: the table, then build-ups (faster) and breakdowns (slower), never under ``min_shot``."""
    step = pace.step_loud if loud else pace.step_calm
    if in_drop and loud and pace.name in DROP_EVERY_BEAT:
        step = 1
    if trend == "rise":
        step = max(1, step // 2)
    elif trend == "fall":
        step *= 2
    return max(step, math.ceil(min_shot / max(gap, 1e-3) - 1e-9))


def wants_transition(pace: Pace, cuts_since: int, on_bar: bool) -> bool:
    """A smooth transition on this cut? About one every ``transition_every`` cuts, preferably on a bar start."""
    if pace.transition_every <= 0:
        return False
    return cuts_since >= pace.transition_every or (on_bar and cuts_since >= max(pace.transition_every - 1, 1))


def transition_seconds(pace: Pace, wanted: float, gap: float, shot: float | None = None) -> float:
    """How long a transition may last: the pace's limit, under half a beat, at most ~40% of the shot."""
    limit = min(pace.max_transition, gap * 0.45, *( [shot * 0.4] if shot else []))
    return round(max(min(wanted, limit), 0.0), 2)


def describe(gap: float) -> dict[str, object]:
    """The rules for the AI editor: the whole table and the pace of this song."""
    p = pace_for(gap)
    return {
        "this_song": {"beat_gap_sec": round(gap, 3), "pace": p.name, "how_to_cut": p.summary, "beats_per_cut_loud": p.step_loud,
                      "beats_per_cut_calm": p.step_calm, "one_smooth_transition_every_n_cuts": p.transition_every or None,
                      "max_transition_sec": p.max_transition, "accents_between_cuts": list(p.accents)},
        "table": [{"beat_gap_sec": f"{x.min_gap:g}-{x.max_gap:g}" if x.max_gap != math.inf else f"> {x.min_gap:g}", "pace": x.name, "how_to_cut": x.summary}
                  for x in PACES],
        "always": ["build-ups (BUILD_UP / ENERGY_RISE) cut twice as fast, breakdowns (ENERGY_DROP) twice as slow",
                   "a MUSIC_DROP always gets a cut: the hero shot with CRASH_ZOOM, entered with a FLASH",
                   "SILENCE: hold the shot or fade; never cut in the middle of silence",
                   "no shot shorter than the minimum clip length; a transition at most 40% of its shot"],
    }  # fmt: skip
