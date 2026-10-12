"""Keyframes and speed ramps for a Reel cut by the beat map, decided from the music (video/keyframes.py renders them).

After the plan's shots are placed (video/timeline.apply_plan), every shot gets movement that answers its music:

- a calm shot (low energy, 1.2 s or longer): a slow, eased push-in
- strong beats inside a shot in a loud part: a punch on each (up to MAX_PUNCHES), on top of that push-in
- the shot right before a drop (1 s or longer): a ramp INTO the drop (slow, accelerating into the cut)
- the shot that starts on a drop: its crash zoom stays, and it comes off the drop fast (2x settling to 1x in 0.5 s)
- one isolated hard hit in a long calm shot: slow motion on the hit (once per Reel)

At most MAX_RAMPS ramps per Reel (more would feel like a gimmick), and a ramp that needs more footage than the clip has
is left out. Shots that already flash or stutter on their hits (beat_flash, beat_stutter, shake, roll) keep their own
movement.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field

from app.models.analysis import AudioAnalysis
from app.models.timeline import Keyframe, Segment
from app.video import keyframes as kf

CALM_ENERGY = 0.45  # a shot whose music is quieter than this gets a slow push-in
CALM_MIN = 1.2  # ... when it lasts at least this long
PUSH_IN = 1.06
PUNCH = 1.08  # a punch on a strong beat inside a shot
PUNCH_DECAY = 0.2
MAX_PUNCHES = 3
EDGE = 0.15  # a beat this close to the shot's start or end is the cut itself
DROP_NEAR = 0.12  # a cut this close to a drop is on it
INTO_DROP_MIN = 0.7  # a ramp into a drop needs a shot at least this long
OFF_DROP_MIN = 0.6
SHIFT_MAX = 0.5  # a ramp needing more footage than is left may start its footage this much earlier
SLOW_HIT_MIN = 1.8
HARD_HIT = 0.9  # accent strength of a hit worth slow motion
MAX_RAMPS = 3
KEEP_OWN = ("beat_flash", "beat_stutter", "shake", "roll", "freeze", "speed_ramp")


def _near(times: list[float], t: float, tol: float) -> bool:
    return any(abs(x - t) <= tol for x in times)


@dataclass
class Shot:
    """What the motion rules need to know about a shot (Reel time)."""

    start: float
    end: float
    effect: str = "none"
    way_in: float = 0.0  # the incoming transition's length (a flash lands half-way through it)

    @property
    def length(self) -> float:
        return self.end - self.start


@dataclass
class Motion:
    """A shot's keyframes and what they do, in words (for the plan table and the notes)."""

    keyframes: list[Keyframe] = field(default_factory=list)
    labels: list[str] = field(default_factory=list)
    ramp: str = ""  # into_drop | out_of_drop | slow_hit | ""
    ramp_note: str = ""


def decide(shots: list[Shot], audio: AudioAnalysis, audio_start: float, fits=None) -> list[Motion]:
    """The motion of every shot, from the music: one set of rules for the plan table (no footage yet: every ramp
    fits) and for the Reel (``fits(k, keyframes)`` says whether shot k's clip has the footage a ramp needs)."""
    drops = sorted(audio.drops)
    strong = sorted(audio.strong_beats)
    hard = sorted(t for t, s in zip(audio.accents, audio.accent_strengths or []) if s >= HARD_HIT)
    period = 60.0 / audio.bpm if audio.bpm else 0.5
    reach = max(DROP_NEAR, period * 0.6)  # the plan cuts a drop on its nearest beat, up to about half a beat away

    def on_drop(sh: Shot) -> bool:  # the plan's drop shot (it has the crash zoom), or a cut on a drop
        return sh.effect == "crash_zoom" or _near(drops, audio_start + sh.start + sh.way_in / 2, reach)

    out: list[Motion] = []
    ramps = 0
    slow_hit_used = False
    for k, sh in enumerate(shots):
        m = Motion()
        out.append(m)
        if sh.effect in KEEP_OWN or sh.length < 0.3:
            continue
        a, b = audio_start + sh.start, audio_start + sh.end
        frames: list[Keyframe] = []
        loud = audio.mean_energy(a, b) >= CALM_ENERGY
        # movement: a slow push-in in a calm shot, punches on the strong beats inside a loud one
        if not loud and sh.length >= CALM_MIN and sh.effect in ("none", "zoom_in", "zoom_pulse", "ken_burns"):
            frames += [Keyframe(t=0, zoom=1.0), Keyframe(t=round(sh.length, 3), zoom=PUSH_IN, ease="ease_in_out")]
            m.labels.append("Slow push-in")
        if loud and sh.effect != "crash_zoom":
            hits = [h - a for h in strong if a + EDGE < h < b - EDGE][:MAX_PUNCHES]
            if hits:
                base = frames or [Keyframe(t=0, zoom=1.0)]
                track = kf.tracks(base).get("zoom", [(0.0, 1.0, "linear")])
                frames = list(base)
                for h in hits:
                    z = kf.value_at(track, h, 1.0)
                    frames += [Keyframe(t=round(h - 0.001, 4), zoom=z, ease="hold"), Keyframe(t=round(h, 4), zoom=round(z * PUNCH, 4), ease="hold"),
                               Keyframe(t=round(min(h + PUNCH_DECAY, sh.length), 4), zoom=round(kf.value_at(track, h + PUNCH_DECAY, 1.0), 4), ease="ease_out")]  # fmt: skip
                m.labels.append(f"Punch on {len(hits)} strong beat{'s' if len(hits) > 1 else ''}")
        # speed ramps, synced to the drops (a budget per Reel)
        speed: list[Keyframe] = []
        kind = why = label = ""
        nxt = shots[k + 1] if k + 1 < len(shots) else None
        if ramps < MAX_RAMPS and nxt is not None and on_drop(nxt) and not on_drop(sh) and sh.length >= INTO_DROP_MIN:
            kind, speed = "into_drop", kf.ramp_preset("into_drop", sh.length)
            why, label = f"into the drop at {nxt.start:.2f}s", "Ramp into the drop (0.6x to 2x)"
        elif ramps < MAX_RAMPS and k > 0 and on_drop(sh) and sh.length >= OFF_DROP_MIN:  # not the opening (it fades in)
            kind, speed = "out_of_drop", kf.ramp_preset("out_of_drop", sh.length)
            why, label = f"off the drop at {sh.start:.2f}s", "Fast off the drop (2x to 1x)"
        elif ramps < MAX_RAMPS and not slow_hit_used and not loud and sh.length >= SLOW_HIT_MIN:
            hit = next((h - a for h in hard if a + 0.5 < h < b - 0.7), None)
            if hit is not None:
                kind, speed = "slow_hit", kf.ramp_preset("slow_hit", sh.length, hit)
                why, label = f"slow motion on the hit at {sh.start + hit:.2f}s", f"Slow motion on the hit ({hit:.2f}s in, 0.35x)"
        if speed and (fits is None or fits(k, speed)):
            frames = kf.merge(frames, speed) if frames else speed
            ramps += 1
            m.ramp, m.ramp_note = kind, why
            m.labels.append(label)
            slow_hit_used = slow_hit_used or kind == "slow_hit"
        if frames:
            m.keyframes, _ = kf.validate(frames, sh.length)
    return out


def add_motion(segments: list[Segment], audio: AudioAnalysis, audio_start: float, clip_seconds: Mapping[str, float] | None = None) -> list[str]:
    """Give the Reel's shots their keyframes and ramps (in place). Returns notes for the person."""
    clip_seconds = clip_seconds or {}

    def fits(k: int, frames: list[Keyframe]) -> bool:
        """The ramp's footage is in the clip; when it runs past the clip's end, the footage starts a little earlier
        (up to SHIFT_MAX) instead of giving up the ramp."""
        seg = segments[k]
        span = kf.source_seconds(frames, seg.length)
        dur = clip_seconds.get(seg.clip_id)
        if dur is None or seg.source_start + span <= dur - 0.05:
            return True
        start = dur - 0.05 - span
        if start >= 0 and seg.source_start - start <= SHIFT_MAX:
            seg.source_start = round(start, 3)
            return True
        return False

    shots = [Shot(s.timeline_start, s.timeline_end, s.effect, s.transition_in.duration) for s in segments]
    motions = decide(shots, audio, audio_start, fits)
    for seg, m in zip(segments, motions):
        if not m.keyframes:
            continue
        seg.keyframes = m.keyframes
        if kf.has_speed(seg.keyframes):  # the footage the ramp plays
            span = kf.source_seconds(seg.keyframes, seg.length)
            seg.speed = round(span / max(seg.length, 1e-6), 4)
            seg.source_end = round(seg.source_start + span, 3)
    pushed = sum(any(lb.startswith("Slow push") for lb in m.labels) for m in motions)
    punched = sum(any(lb.startswith("Punch") for lb in m.labels) for m in motions)
    notes = []
    if pushed or punched:
        notes.append(f"Motion from the music: {pushed} slow push-in{'s' if pushed != 1 else ''} in calm shots, "
                     f"punches on the strong beats in {punched} shot{'s' if punched != 1 else ''}.")
    ramps = [m.ramp_note for m in motions if m.ramp]
    if ramps:
        notes.append("Speed ramps: " + "; ".join(ramps) + ".")
    return notes


def annotate_plan(rows: list[dict], audio: AudioAnalysis) -> None:
    """The plan table's cut rows (song time) get the motion their shot will have: ``motion`` (words), ``ramp`` (the
    kind) and ``keyframes``. The same rules as the Reel; footage is checked only when the Reel is made."""
    cuts = [r for r in rows if r["kind"] == "cut"]
    shots = [Shot(r["t"], r["end"], r.get("effect", "none"), float(r.get("tdur") or 0.0)) for r in cuts]
    for r, m in zip(cuts, decide(shots, audio, 0.0)):
        r["motion"] = m.labels
        r["ramp"] = m.ramp
        r["keyframes"] = [k.model_dump(exclude_none=True) for k in m.keyframes]
