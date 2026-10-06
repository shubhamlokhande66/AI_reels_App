"""The song as an editor reads it: beat hierarchy, bars, phrases, pauses and an energy curve, all with real timestamps.

It is built from the existing analysis (beats, strong beats, accents, drops, energy) and needs no re-analysis.
Song sections (intro, build, drop ...) and vocal presence come from audio/structure.py; vocal presence is an estimate
(no source separation), so exact vocal entries and emphasis are not claimed.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.analysis import AudioAnalysis

LEVEL_NAMES = {1: "subtle", 2: "normal", 3: "strong", 4: "major"}
# What each level may trigger (spec section 6). A cut is only *allowed* on level 3+; levels 1-2 are for motion.
LEVEL_ACTION = {1: "micro movement", 2: "camera movement", 3: "cut / zoom / text", 4: "reveal / major transition"}
ENERGY_LEVELS = ((0.85, "very_high"), (0.6, "high"), (0.35, "medium"), (0.0, "low"))
PAUSE_LEVEL, PAUSE_MIN = 0.08, 0.35
ACCENT_NEAR = 0.09  # an accent this close to a beat belongs to it
ACCENT_NORMAL, ACCENT_STRONG = 0.55, 0.9
DROP_NEAR = 0.15


@dataclass
class Beat:
    t: float  # seconds from the start of the Reel
    level: int  # 1 subtle .. 4 major
    downbeat: bool = False


@dataclass
class MusicMap:
    bpm: float
    beats: list[Beat]
    bars: list[float]  # downbeats
    phrases: list[float]  # start of every 4th bar (a musical sentence)
    drops: list[float]
    pauses: list[tuple[float, float]]
    energy_curve: list[tuple[float, float, str]]  # (start, end, low|medium|high|very_high)
    accents: list[tuple[float, float]] = ()  # (t, strength) individual strong hits, may fall between beat-grid times
    sections: list[dict] = ()  # labelled song sections inside the Reel (times relative to the Reel start)
    points: list[dict] = ()  # the normalized timeline: one point per beat (time, section, energy, beat_strength, phrase_position)

    def section_at(self, t: float) -> dict | None:
        for s in self.sections:
            if s["start"] - 1e-6 <= t < s["end"]:
                return s
        return self.sections[-1] if self.sections else None

    def level_at(self, t: float, tol: float = 0.06) -> int:
        """The level of the beat nearest ``t`` (1 when no beat is within ``tol``)."""
        if not self.beats:
            return 1
        b = min(self.beats, key=lambda x: abs(x.t - t))
        return b.level if abs(b.t - t) <= tol else 1

    @property
    def snap_points(self) -> list[float]:
        """Every time a professional edit would cut on: beat-grid times plus real strong accents (which do not always land
        exactly on the grid). Used to judge whether a cut is "on the beat" the way a human editor means it."""
        return sorted({b.t for b in self.beats} | {a for a, s in self.accents if s >= 0.6})

    def energy_at(self, t: float) -> str:
        for a, b, name in self.energy_curve:
            if a - 1e-6 <= t < b:
                return name
        return self.energy_curve[-1][2] if self.energy_curve else "medium"

    def to_doc(self) -> dict:
        return {
            "bpm": round(self.bpm, 1),
            "beats": [{"t": round(b.t, 3), "level": b.level, "downbeat": b.downbeat} for b in self.beats],
            "accents": [{"t": round(t, 3), "strength": round(s, 3)} for t, s in self.accents],
            "bars": [round(t, 3) for t in self.bars],
            "phrases": [round(t, 3) for t in self.phrases],
            "drops": [round(t, 3) for t in self.drops],
            "pauses": [{"start": round(a, 3), "end": round(b, 3)} for a, b in self.pauses],
            "energyCurve": [{"start": round(a, 2), "end": round(b, 2), "level": n} for a, b, n in self.energy_curve],
            "sections": list(self.sections),
            "timeline": list(self.points),
            "notDetected": ["exact vocal entries and emphasis (vocal presence is estimated, not separated)"],
        }


def energy_name(e: float) -> str:
    return next(name for floor, name in ENERGY_LEVELS if e >= floor)


def _curve(audio: AudioAnalysis, start: float, duration: float) -> list[tuple[float, float, str]]:
    """Energy as a few readable stretches (low / medium / high / very high), each at least a second long."""
    step = 0.5
    cells = []
    t = 0.0
    while t < duration - 1e-6:
        e = audio.mean_energy(start + t, start + min(t + step, duration))
        cells.append((t, min(t + step, duration), energy_name(e)))
        t += step
    runs: list[list] = []
    for a, b, n in cells:
        if runs and runs[-1][2] == n:
            runs[-1][1] = b
        else:
            runs.append([a, b, n])
    merged: list[list] = []
    for r in runs:  # a stretch shorter than a second is absorbed by the one before it
        if merged and r[1] - r[0] < 1.0:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    out: list[list] = []
    for r in merged:
        if out and out[-1][2] == r[2]:
            out[-1][1] = r[1]
        else:
            out.append(r)
    return [(a, b, n) for a, b, n in out]


# The longest a shot should last in a loud part of the song at a balanced pace (quiet parts have no limit here).
ENERGY_MAX_SHOT = {"very_high": 2.2, "high": 3.0}
PACE_SCALE = {"calm": 1.8, "balanced": 1.0, "fast": 0.75}
_LOUDNESS = {"low": 0, "medium": 1, "high": 2, "very_high": 3}


def loud_limit(mm: "MusicMap", a: float, b: float, pace: str = "balanced") -> tuple[str, float] | None:
    """(energy, longest shot it allows) for a shot from ``a`` to ``b`` when at least half of it is in a loud part of
    the song; None when the shot is mostly in calm music (long shots are right there)."""
    cover: dict[str, float] = {}
    for s0, s1, name in mm.energy_curve:
        cover[name] = cover.get(name, 0.0) + max(0.0, min(b, s1) - max(a, s0))
    for name in ("very_high", "high"):
        loud = sum(v for k, v in cover.items() if _LOUDNESS.get(k, 0) >= _LOUDNESS[name])
        if b > a and loud >= 0.5 * (b - a):
            return name, round(ENERGY_MAX_SHOT[name] * PACE_SCALE.get(pace, 1.0), 2)
    return None


def song_hits(audio: AudioAnalysis, min_gap: float = 0.08) -> list[float]:
    """Seconds into the song of every strong hit (strong beats and strong accents), for beat-reactive effects."""
    ts = sorted({*audio.strong_beats, *(t for t, s in zip(audio.accents, audio.accent_strengths) if s >= 0.6)})
    out: list[float] = []
    for t in ts:
        if not out or t - out[-1] >= min_gap:
            out.append(round(float(t), 3))
    return out


def build_music_map(audio: AudioAnalysis, start: float, duration: float) -> MusicMap:
    """The music map for the part of the song the Reel uses. Times are relative to the Reel start."""
    rel = lambda t: round(t - start, 3)  # noqa: E731
    inside = lambda t: -0.03 <= t - start <= duration + 0.03  # noqa: E731
    beats_abs = [b for b in audio.beats if inside(b)]
    strong = {rel(b) for b in audio.strong_beats if inside(b)}
    drops = [rel(d) for d in audio.drops if inside(d)]
    accents = [(rel(t), s) for t, s in zip(audio.accents, audio.accent_strengths) if inside(t)]

    beats: list[Beat] = []
    for b in beats_abs:
        t = max(rel(b), 0.0)
        near = [s for a, s in accents if abs(a - t) <= ACCENT_NEAR]
        hit = max(near) if near else 0.0
        if any(abs(d - t) <= DROP_NEAR for d in drops):
            level = 4
        elif t in strong or rel(b) in strong or hit >= ACCENT_STRONG:
            level = 3
        elif hit >= ACCENT_NORMAL:
            level = 2
        else:
            level = 1
        beats.append(Beat(round(t, 3), level, downbeat=(rel(b) in strong)))

    bars = [b.t for b in beats if b.downbeat]
    phrases = bars[::4]

    pauses: list[tuple[float, float]] = []
    lo = None
    n = int(duration / audio.energy_hop)
    for i in range(n + 1):
        low = audio.energy_at(start + i * audio.energy_hop) < PAUSE_LEVEL and i < n
        if low and lo is None:
            lo = i * audio.energy_hop
        elif not low and lo is not None:
            if i * audio.energy_hop - lo >= PAUSE_MIN:
                pauses.append((round(lo, 3), round(i * audio.energy_hop, 3)))
            lo = None
    sections = [
        {"start": round(max(s.start - start, 0.0), 2), "end": round(min(s.end - start, duration), 2), "label": s.label,
         "energy": s.energy, "vocal": s.vocal, "density": s.density, "cutOn": s.cut_on, "confidence": s.confidence}
        for s in audio.song_sections if s.end > start + 0.05 and s.start < start + duration - 0.05
    ]  # fmt: skip
    points = []
    for b in beats:
        sec = next((s for s in sections if s["start"] - 1e-6 <= b.t < s["end"]), sections[-1] if sections else None)
        ps = [p for p in phrases if p <= b.t + 1e-6]
        nxt = [p for p in phrases if p > b.t + 1e-6]
        span = (nxt[0] if nxt else duration) - (ps[-1] if ps else 0.0)
        hit = max([s for a, s in accents if abs(a - b.t) <= ACCENT_NEAR], default=0.0)
        points.append({
            "time": b.t, "section": sec["label"] if sec else None, "energy": round(audio.energy_at(start + b.t), 3),
            "beatStrength": round(max(hit, b.level / 4), 3),
            "phrasePosition": round((b.t - (ps[-1] if ps else 0.0)) / span, 3) if span > 0 else 0.0,
        })  # fmt: skip
    return MusicMap(audio.bpm, beats, bars, phrases, drops, pauses, _curve(audio, start, duration), accents=accents,
                    sections=sections, points=points)  # fmt: skip
