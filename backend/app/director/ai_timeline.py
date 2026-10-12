"""Step 2 of music-first editing: the AI plans the Reel's timeline from the song analysis.

The song analysis (audio/analysis_json.py, measurements only) is cut down to the part of the song the Reel uses and
sent with the clips' good footage (ai/reel_director.clip_facts) to the AI configured in Settings. It answers with a
timeline in this shape:

    {"timeline": [{"timeline_start_sec", "timeline_end_sec", "clip_id", "source_start_sec", "source_end_sec", "speed",
                   "effects": [{"type", "start_offset_sec", "duration_sec"}],
                   "transition_out": {"type", "duration_sec"} | null}]}

The answer is never used as it comes: ``check`` makes it playable and says what it changed - shots back to back from 0
to the Reel's length, cut points on a beat or event, no shot shorter than the minimum, footage that exists and is a good
part of the clip (never a moment shown twice), speeds and transitions in range, known effect and transition names.
The same song, clips and settings give the same timeline: the checked answer is saved and reused.
"""

from __future__ import annotations

import hashlib
import json
import logging
from typing import Any

from pydantic import BaseModel, Field

from app.video.timeline import ClipInput

log = logging.getLogger(__name__)
VERSION = 1
SNAP_SURE, SNAP_UNSURE = 0.15, 0.04  # a cut moves onto a beat this close: far for a sure beat, barely for an unsure one
ON_EVENT = 0.03  # a cut this close to an event (a drop, a fill's end...) was put there on purpose: it stays on the event
MIN_SPEED, MAX_SPEED = 0.5, 2.0
MAX_TRANSITION = 0.6
SHOW_EVENTS = ("STRONG_BEAT", "MUSIC_DROP", "BUILD_UP", "ROLL", "FILL", "IMPACT", "ENERGY_RISE", "ENERGY_DROP", "SILENCE",
               "PHRASE_END", "VOCAL_ENTRY", "VOCAL_PAUSE", "REVERB_TAIL", "TEMPO_CHANGE")  # fmt: skip

# the AI's names -> the renderer's (video/cutter.py effects, video/transitions.py transitions)
EFFECTS: dict[str, tuple[str, str]] = {
    "ZOOM_IN": ("zoom_in", "slow push in over the shot (with duration <= 0.4 s: a quick punch-in)"),
    "ZOOM_OUT": ("zoom_out", "slow pull out over the shot"),
    "PUNCH_ZOOM": ("punch", "a quick punch-in on the hit"),
    "CRASH_ZOOM": ("crash_zoom", "a fast snap zoom: for a drop"),
    "PULSE": ("zoom_pulse", "a soft pulse on the beats the shot holds"),
    "BEAT_PUNCH": ("beat_punch", "a punch on every strong hit inside the shot"),
    "STUTTER": ("beat_stutter", "quick punches on a fast roll"),
    "FLASH": ("flash", "a white flash on a hard hit (put it at the hit's offset)"),
    "SHAKE": ("shake", "handheld energy"),
    "KEN_BURNS": ("ken_burns", "a slow drift: calm parts"),
    "ROLL": ("roll", "a gentle rotation sway"),
    "GLOW": ("glow", "highlights bloom: dreamy, luxury"),
    "BLACK_WHITE": ("black_white", "black and white"),
    "VIGNETTE": ("vignette", "darker edges"),
}
QUICK_ZOOM = 0.4  # ZOOM_IN this short is a punch-in
LOOK_EFFECTS = ("GLOW", "BLACK_WHITE", "VIGNETTE")  # colour looks: laid on top, combined with any movement
KEYED_EFFECTS = ("ZOOM_IN", "ZOOM_OUT", "PUNCH_ZOOM", "CRASH_ZOOM", "KEN_BURNS", "FLASH")  # become keyframes at their moment
EASES = ("linear", "ease_in", "ease_out", "ease_in_out", "hold")
TRANSITIONS: dict[str, tuple[str, str]] = {
    "HARD_CUT": ("cut", "an instant cut on the beat (most cuts)"),
    "FLASH": ("flash", "a white flash: drops, impacts"),
    "CROSSFADE": ("dissolve", "a soft blend: calm parts"),
    "FADE": ("fade", "through black: openings, endings"),
    "ZOOM": ("zoom", "zoom through: energy"),
    "WHIP_LEFT": ("slide_left", "a fast push to the left"),
    "WHIP_RIGHT": ("slide_right", "a fast push to the right"),
    "SLIDE_DOWN": ("slide_down", "the next shot slides down"),
    "COVER_UP": ("cover_up", "the next shot covers from below"),
    "WIPE_LEFT": ("wipe_left", "a wipe"),
    "WIPE_RIGHT": ("wipe_right", "a wipe"),
    "CIRCLE_OPEN": ("circle_open", "an iris opening: reveals"),
    "BLUR": ("blur", "focus pull through blur"),
    "GLITCH": ("pixelize", "a digital glitch"),
    "SPEED_RAMP": ("speed_ramp", "the shot speeds up into the cut"),
}


class AIEffect(BaseModel):
    type: str
    start_offset_sec: float = 0.0
    duration_sec: float = 0.2


class AITransition(BaseModel):
    type: str = "HARD_CUT"
    duration_sec: float = 0.0


class AIKeyframe(BaseModel):
    """A moment of the shot's animation (video/keyframes.py); only the properties given are animated."""

    t: float  # seconds into the shot
    zoom: float | None = None
    x: float | None = None
    y: float | None = None
    rotation: float | None = None
    opacity: float | None = None
    blur: float | None = None
    brightness: float | None = None
    speed: float | None = None
    ease: str = "linear"


class AIShot(BaseModel):
    timeline_start_sec: float
    timeline_end_sec: float
    clip_id: str
    source_start_sec: float
    source_end_sec: float
    speed: float = 1.0
    effects: list[AIEffect] = []
    keyframes: list[AIKeyframe] = []
    transition_out: AITransition | None = None
    why: str = ""


class AITimeline(BaseModel):
    timeline: list[AIShot] = Field(min_length=1)


SYSTEM = ("You are a professional short-video editor. You cut Reels to music: every cut lands on a beat or a musical event "
          "from the analysis, the energy of the edit follows the song, and footage is used only from the clips' good parts. "
          "Reply with JSON only.")  # fmt: skip


# ---------------------------------------------------------------------- what the AI is told
def music_for_reel(doc: dict[str, Any], start: float, duration: float) -> dict[str, Any]:
    """The song analysis (schema 1.0, audio/analysis_json.video_shape) cut down to the part of the song the Reel plays,
    in Reel time (0 = the Reel's first frame)."""
    end = start + duration

    def rel(t: float | None) -> float | None:
        return None if t is None else round(t - start, 3)

    def inside(t: float | None, a: float | None = None, b: float | None = None) -> bool:
        if t is not None:
            return start <= t <= end
        return a is not None and b is not None and b >= start and a <= end

    beats = [{"t": rel(b["time_sec"]), "strength": b["strength"], "confidence": b.get("confidence"), **({"downbeat": True} if b.get("downbeat") else {})}
             for b in doc["beats"] if inside(b["time_sec"])]  # fmt: skip
    events = []
    for e in doc["candidate_events"]:
        if e["type"] not in SHOW_EVENTS or not inside(e["time_sec"], e["start_sec"], e["end_sec"]):
            continue
        row: dict[str, Any] = {"type": e["type"], "confidence": e["confidence"]}
        if e["time_sec"] is not None:
            row["t"] = rel(e["time_sec"])
        else:
            row["start"], row["end"] = max(rel(e["start_sec"]) or 0.0, 0.0), min(rel(e["end_sec"]) or duration, duration)
        events.append(row)
    tempo = doc["tempo"]
    step = doc["energy_curve"]["sample_interval_sec"]
    values = doc["energy_curve"]["values"]
    return {
        "reel_seconds": duration, "song_starts_at_sec": round(start, 3), "bpm": tempo["bpm"], "beat_interval_sec": tempo["beat_interval_sec"],
        "tempo_sections": [{"start": max(rel(s["start_sec"]) or 0, 0), "end": min(rel(s["end_sec"]) or duration, duration), "bpm": s["bpm"]}
                           for s in tempo.get("sections", []) if s["end_sec"] >= start and s["start_sec"] <= end],
        "sections": [{"type": s["type"], "energy_level": s["energy_level"], "start": max(rel(s["start_sec"]) or 0, 0),
                      "end": min(rel(s["end_sec"]) or duration, duration)} for s in doc["sections"] if s["end_sec"] >= start and s["start_sec"] <= end],
        "energy_every_half_second": [values[k] for k in range(int(start / step), min(int(end / step) + 1, len(values)), max(int(0.5 / step), 1))],
        "beats": beats, "events": events,
    }  # fmt: skip


def clips_for_ai(clips: list[ClipInput]) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """The clips' facts with readable ids (clip_01, clip_02...) and the map back to the real ids."""
    from app.ai.reel_director import clip_facts

    rows, alias = clip_facts(clips)
    out, back = [], {}
    for k, row in enumerate(rows):
        name = f"clip_{k + 1:02d}"
        back[name] = alias[row["clip"]]
        out.append({**row, "clip": name})
    return out, back


def request(music: dict[str, Any], clips: list[dict[str, Any]], min_clip: float, brief: str = "") -> str:
    rules = [
        f"The timeline covers exactly 0 to {music['reel_seconds']} s: shots back to back, the first starting at 0, the last ending at {music['reel_seconds']}.",
        "Every cut (a shot's timeline_end_sec) lands on a beat time or an event time from the music. Put important cuts (the drop, a new section, a hero shot) on beats with high confidence or on downbeats; a beat with low confidence is a weak place for a cut.",
        f"No shot is shorter than {min_clip} s. Follow the pace rules: how far apart the beats are sets how often to cut and how often to use a transition.",
        "source_end_sec - source_start_sec = (timeline_end_sec - timeline_start_sec) * speed, inside ONE usable window of that clip.",
        "Never show the same moment of a clip twice. speed 1.0 normally; 0.5-0.8 for slow motion in calm parts; up to 2.0 to speed up.",
        "MUSIC_DROP: a hero shot with CRASH_ZOOM or FLASH, entered with a FLASH transition. STRONG_BEAT / IMPACT: PUNCH_ZOOM or a whip.",
        "Most transitions are HARD_CUT (see the pace rules for how often a smooth one fits). Transition duration 0 for HARD_CUT, otherwise at most the pace's max_transition_sec and 40% of the shot.",
        "effects: start_offset_sec is seconds into the shot (put a FLASH or PUNCH_ZOOM on a hit inside it); duration_sec how long it lasts.",
        "The last shot's transition_out is null. Open with the strongest hook shot, end on a satisfying shot.",
        "keyframes animate a shot (optional, but use them to give every shot life). t = seconds into the shot; each property "
        "moves from one keyframe that sets it to the next, with the later keyframe's ease. Ranges: zoom 1-3 (1 = framed), "
        "x / y -1..1 (where the zoomed window sits; 0 = centre), rotation -20..20 degrees (keep it under 4 for taste), "
        "opacity 0-1 (0 = black), blur 0-1, brightness -0.5..0.5 (0.4 = a flash). ease: linear, ease_in, ease_out, ease_in_out, hold.",
        "Keyframe ideas: a slow push-in through a calm shot (zoom 1.0 at 0 -> 1.08 at the end, ease_in_out); a punch on a beat "
        "inside the shot (zoom 1.12 at the beat's time minus the shot start, back to 1.0 0.25 s later, ease_out); a pan across "
        "a wide shot (x -0.8 -> 0.8, with zoom 1.15); a flash on a hit (brightness 0.4 at the hit, 0 0.2 s later); fade the last "
        "shot out (opacity 1 -> 0 over its last 0.5 s). Beats inside a shot: beats with t between the shot's start and end.",
        "GLOW, BLACK_WHITE and VIGNETTE are colour looks: they combine with any movement.",
        "Speed ramps: a keyframe 'speed' (0.25-4) remaps time inside the shot and the footage follows it (leave speed at 1 "
        "and source times consistent; the check recomputes the footage a ramp needs). Ideas synced to the music: slow (0.6) "
        "accelerating to 2.0 right into a MUSIC_DROP cut (ease_in); slow motion (0.35) on a big hit inside a shot and back "
        "to 1.0; fast (2.0) off a drop settling to 1.0 within 0.5 s. Use ramps on 1-3 key moments, not every shot.",
    ]
    from app.director import pace_rules

    task = {
        "music": music, "clips": clips, "rules": rules, "pace_rules": pace_rules.describe(float(music.get("beat_interval_sec") or 0.5)),
        "effects": {k: v[1] for k, v in EFFECTS.items()}, "transitions": {k: v[1] for k, v in TRANSITIONS.items()},
        "instructions": brief or "(none)",
        "answer": {"timeline": [{"timeline_start_sec": 0.0, "timeline_end_sec": 0.0, "clip_id": "clip_01", "source_start_sec": 0.0,
                                 "source_end_sec": 0.0, "speed": 1.0, "effects": [{"type": "ZOOM_IN", "start_offset_sec": 0, "duration_sec": 0.2}],
                                 "keyframes": [{"t": 0.0, "zoom": 1.0}, {"t": 0.43, "zoom": 1.12, "ease": "ease_out"}, {"t": 0.68, "zoom": 1.0}],
                                 "transition_out": {"type": "HARD_CUT", "duration_sec": 0}, "why": "short reason"}]},
    }  # fmt: skip
    return json.dumps(task, ensure_ascii=False)


# ---------------------------------------------------------------------- making the answer playable
def check(plan: AITimeline, music: dict[str, Any], clips: list[ClipInput], alias: dict[str, str], min_clip: float) -> tuple[AITimeline, list[str]]:
    """A playable timeline from the AI's answer, and what had to change (for the person and the logs)."""
    from collections import defaultdict

    from app.director.ai_plan import _pick_footage

    from app.director import pace_rules

    duration = float(music["reel_seconds"])
    pace = pace_rules.pace_for(float(music.get("beat_interval_sec") or 0.5))
    longest = pace.max_transition or 0.15  # a roll-paced song still allows a short flash into a drop
    notes: list[str] = []
    events = sorted({e["t"] for e in music["events"] if "t" in e} | {x for e in music["events"] for x in (e.get("start"), e.get("end")) if x is not None})
    beats = [(b["t"], 0.6 if b.get("confidence") is None else float(b["confidence"])) for b in music["beats"]]

    def snap(t: float) -> float:
        """Onto the event the AI aimed at, else onto a nearby beat: from far for a sure beat, from close for an unsure one."""
        ev = min(events, key=lambda p: abs(p - t)) if events else None
        if ev is not None and abs(ev - t) <= ON_EVENT:
            return ev
        best, score = t, 1.0
        for b, conf in beats:
            reach = SNAP_UNSURE + (SNAP_SURE - SNAP_UNSURE) * min(max(conf, 0.0), 1.0)
            if abs(b - t) / reach <= score:  # within reach, and the nearest relative to how far each beat may pull
                best, score = b, abs(b - t) / reach
        return best
    by_id = {c.clip_id: c for c in clips}
    shots = sorted(plan.timeline, key=lambda s: s.timeline_start_sec)

    # 1. cut points: on a beat / event, in order, no shot shorter than the minimum, the last at the Reel's end. A shot
    #    that would be too short is left out and the next shot takes its time.
    chosen: list[AIShot] = []
    cuts: list[float] = []
    for s in shots[:-1]:
        t = snap(s.timeline_end_sec)
        prev = cuts[-1] if cuts else 0.0
        if t - prev < min_clip or duration - t < min_clip:
            notes.append(f"the shot ending at {s.timeline_end_sec:.2f} s would be under {min_clip} s: left out, the next shot takes its time")
            continue
        chosen.append(s)
        cuts.append(round(t, 3))
    chosen.append(shots[-1])
    bounds = [0.0, *cuts, duration]
    if abs(shots[-1].timeline_end_sec - duration) > 0.05:
        notes.append(f"the timeline ended at {shots[-1].timeline_end_sec:.2f} s: set to the Reel's {duration:g} s")

    # 2. footage: a real clip, a good part of it, never a moment shown twice
    used: dict[str, list[tuple[float, float]]] = defaultdict(list)
    uses: dict[str, int] = defaultdict(int)
    out: list[AIShot] = []
    for k, s in enumerate(chosen):
        a, b = bounds[k], bounds[k + 1]
        length = b - a
        real = alias.get(s.clip_id)
        if real not in by_id:
            real = min(by_id, key=lambda i: (uses[i], -by_id[i].analysis.quality_score))
            notes.append(f"shot {k + 1}: unknown clip {s.clip_id!r}, used {next(n for n, r in alias.items() if r == real)}")
        keyframes = check_keyframes(s.keyframes, length, f"shot {k + 1}", notes)
        ramp = _ramp_speed(keyframes, length)
        speed = ramp if ramp is not None else min(max(s.speed or 1.0, MIN_SPEED), MAX_SPEED)
        if ramp is None and abs(speed - (s.speed or 1.0)) > 1e-6:
            notes.append(f"shot {k + 1}: speed {s.speed} -> {speed}")
        clip, src_a, src_b, speed, why = _pick_footage(by_id[real], s.source_start_sec, length, speed, used, clips, uses)
        notes += [f"shot {k + 1}: {w}" for w in why]
        used[clip.clip_id].append((src_a, src_b))
        uses[clip.clip_id] += 1
        name = next((n for n, r in alias.items() if r == clip.clip_id), s.clip_id)

        effects = []
        for e in s.effects:
            kind = e.type.strip().upper()
            if kind not in EFFECTS:
                notes.append(f"shot {k + 1}: unknown effect {e.type!r} left out")
                continue
            off = min(max(e.start_offset_sec, 0.0), max(length - 0.05, 0.0))
            effects.append(AIEffect(type=kind, start_offset_sec=round(off, 3), duration_sec=round(min(max(e.duration_sec, 0.05), length - off), 3)))
        tr = None
        if k < len(chosen) - 1:
            raw = s.transition_out or AITransition()
            kind = raw.type.strip().upper()
            if kind not in TRANSITIONS:
                notes.append(f"shot {k + 1}: unknown transition {raw.type!r} -> HARD_CUT")
                kind = "HARD_CUT"
            nxt = bounds[k + 2] - bounds[k + 1]
            dur = 0.0 if kind == "HARD_CUT" else round(min(max(raw.duration_sec, 0.1), MAX_TRANSITION, longest, 0.4 * min(length, nxt)), 3)
            if kind != "HARD_CUT" and raw.duration_sec > dur + 0.02:
                notes.append(f"shot {k + 1}: {kind} {raw.duration_sec:g} s -> {dur:g} s (the {pace.name} pace allows {longest:g} s)")
            tr = AITransition(type=kind, duration_sec=dur)
        out.append(AIShot(timeline_start_sec=round(a, 3), timeline_end_sec=round(b, 3), clip_id=name, source_start_sec=src_a, source_end_sec=src_b,
                          speed=round(speed, 3), effects=effects, keyframes=keyframes, transition_out=tr, why=s.why[:120]))  # fmt: skip
    return AITimeline(timeline=out), notes


def _ramp_speed(keyframes: list[AIKeyframe], length: float) -> float | None:
    """The average speed of a speed ramp (how much footage it plays per second of the shot), None without one."""
    from app.models.timeline import Keyframe
    from app.video import keyframes as kf

    kfs = [Keyframe(**k.model_dump()) for k in keyframes]  # type: ignore[arg-type]
    return round(kf.average_speed(kfs, length), 4) if kf.has_speed(kfs) else None


def check_keyframes(raw: list[AIKeyframe], length: float, where: str, notes: list[str]) -> list[AIKeyframe]:
    """The shot's keyframes made safe (video/keyframes.validate): inside the shot, in order, values in range, a known ease."""
    from app.models.timeline import Keyframe
    from app.video import keyframes as kf

    fixed = []
    for k in raw:
        ease = k.ease if k.ease in EASES else "linear"
        if ease != k.ease:
            notes.append(f"{where}: unknown ease {k.ease!r} -> linear")
        fixed.append(Keyframe(t=k.t, ease=ease, **{p: getattr(k, p) for p in ("zoom", "x", "y", "rotation", "opacity", "blur", "brightness", "speed")}))  # type: ignore[arg-type]
    good, why = kf.validate(fixed, length)
    notes += [f"{where}: {w}" for w in why]
    return [AIKeyframe(**k.model_dump(exclude_none=True)) for k in good]


# ---------------------------------------------------------------------- the call (cached: same inputs, same timeline)
def cache_key(music: dict[str, Any], clips: list[dict[str, Any]], min_clip: float, brief: str, model: str) -> str:
    blob = json.dumps({"m": music, "c": clips, "min": min_clip, "b": brief, "model": model, "v": VERSION}, sort_keys=True)
    return hashlib.sha1(blob.encode()).hexdigest()[:24]


def plan_timeline(doc: dict[str, Any], clips: list[ClipInput], start: float, duration: float, min_clip: float = 0.4, brief: str = "",
                  provider: Any = None, cache: Any = None) -> dict[str, Any]:  # fmt: skip
    """{"timeline": [...], "notes": [...], "provider", "model", "cached"}. ``cache``: (load(key) -> dict | None, save(key, dict))."""
    from app.ai.provider import get_provider
    from app.ai.structured import run_structured
    from app.ai.types import AIRequest
    from app.core.errors import ValidationFailed

    if doc.get("status") != "completed":
        raise ValidationFailed("The song analysis failed: " + "; ".join(doc.get("errors") or ["unknown reason"]), code="ANALYSIS_FAILED")
    if "schema_version" not in doc:  # the full internal document: the AI reads schema 1.0
        from app.audio.analysis_json import video_shape

        doc = video_shape(doc)
    music = music_for_reel(doc, start, duration)
    rows, alias = clips_for_ai(clips)
    if not rows:
        raise ValidationFailed("None of the clips has usable footage.", code="NO_USABLE_CLIPS")
    provider = provider or get_provider("director")
    key = cache_key(music, rows, min_clip, brief, getattr(provider, "model", ""))
    if cache is not None and (hit := cache[0](key)):
        return {**hit, "cached": True}
    req = AIRequest(system=SYSTEM, user=request(music, rows, min_clip, brief), temperature=0.0, task="director", max_output_tokens=16000)
    answer, res = run_structured(provider, req, AITimeline)
    checked, notes = check(answer, music, clips, alias, min_clip)
    out = {**checked.model_dump(), "notes": notes, "provider": res.provider, "model": res.model}
    if cache is not None:
        cache[1](key, out)
    return {**out, "cached": False}


# ---------------------------------------------------------------------- the plan as the renderer's timeline
PRESET_OF = {"ZOOM_IN": "zoom_in", "ZOOM_OUT": "zoom_out", "PUNCH_ZOOM": "punch", "CRASH_ZOOM": "crash_zoom", "KEN_BURNS": "ken_burns", "FLASH": "flash"}


def shot_animation(shot: AIShot) -> tuple[str, list[Any], list[str], list[str]]:
    """(procedural effect, keyframes, looks, notes) for a shot. Effects that are animations become keyframes at their
    moment (a punch at 0.84 s is a zoom up at 0.84 s and back 0.25 s later), so several can follow each other in one shot;
    the AI's own keyframes win for the properties they animate; colour looks stack on top; a beat-reactive or wobbling
    effect (BEAT_PUNCH, STUTTER, PULSE, SHAKE, ROLL) drives the whole shot, one per shot."""
    from app.models.timeline import Keyframe
    from app.video import keyframes as kf

    length = shot.timeline_end_sec - shot.timeline_start_sec
    notes: list[str] = []
    looks, effect_kfs, procedural = [], [], "none"
    for e in sorted(shot.effects, key=lambda e: e.start_offset_sec):
        if e.type in LOOK_EFFECTS:
            looks.append(EFFECTS[e.type][0])
        elif e.type in KEYED_EFFECTS:
            name = PRESET_OF[e.type]
            if e.type == "ZOOM_IN" and e.duration_sec <= QUICK_ZOOM:
                name = "punch"  # a quick zoom-in is a punch-in
            span = max(min(e.duration_sec if name in ("zoom_in", "zoom_out", "ken_burns") else length, length - e.start_offset_sec), 0.1)
            effect_kfs += [Keyframe(**{**k.model_dump(), "t": round(k.t + e.start_offset_sec, 4)}) for k in kf.preset(name, span)]
        elif procedural == "none":
            procedural = EFFECTS[e.type][0]
            if e.start_offset_sec > 0.15:
                notes.append(f"{e.type} drives the whole shot (it follows the beats / wobbles from the start)")
        else:
            notes.append(f"{e.type} left out: one beat-reactive / wobbling effect per shot ({procedural} kept)")
    own = [Keyframe(**k.model_dump()) for k in shot.keyframes]  # type: ignore[arg-type]
    keyframes, why = kf.validate(kf.merge(sorted(effect_kfs, key=lambda k: k.t), own) if own else effect_kfs, length)
    return procedural, keyframes, list(dict.fromkeys(looks)), notes + why


def to_timeline(plan: AITimeline, alias: dict[str, str], clips: list[ClipInput], audio: Any, audio_start: float,
                style: str = "fast_trending") -> tuple[Any, list[str]]:  # fmt: skip
    """(Timeline, notes). Each shot becomes one segment with its keyframes (its effects as keyframes at their moments,
    the AI's own keyframes over them) and its colour looks. The way into a shot is the previous shot's transition_out."""
    from app.director.music_map import song_hits
    from app.models.timeline import Segment, Timeline, Transition

    names = {c.clip_id: c.name for c in clips}
    notes: list[str] = []
    segments: list[Segment] = []
    way_in = Transition(type="cut", duration=0.0)
    for k, shot in enumerate(plan.timeline):
        real = alias.get(shot.clip_id, shot.clip_id)
        effect, keyframes, looks, why = shot_animation(shot)
        notes += [f"shot {k + 1}: {w}" for w in why]
        from app.video import keyframes as kfm

        if kfm.has_speed(keyframes):  # the footage the ramp plays
            shot = shot.model_copy(update={"speed": round(kfm.average_speed(keyframes, shot.timeline_end_sec - shot.timeline_start_sec), 4)})
        segments.append(Segment(
            clip_id=real, video=names.get(real, real), source_start=round(shot.source_start_sec, 3), source_end=round(shot.source_end_sec, 3),
            timeline_start=round(shot.timeline_start_sec, 3), timeline_end=round(shot.timeline_end_sec, 3), speed=shot.speed,
            effect=effect, keyframes=keyframes, looks=looks, transition_in=way_in, reason=shot.why or None, locked=True,
        ))  # fmt: skip
        out = shot.transition_out
        way_in = Transition(type=TRANSITIONS[out.type][0], duration=out.duration_sec) if out and out.type in TRANSITIONS else Transition(type="cut", duration=0.0)
    duration = plan.timeline[-1].timeline_end_sec
    tl = Timeline(duration=round(duration, 3), bpm=float(getattr(audio, "bpm", 0.0) or 0.0), audio_start=round(audio_start, 3), style=style,
                  segments=segments, music_hits=song_hits(audio) if audio is not None else [],
                  notes=["Edited by the AI from the song analysis (director/ai_timeline.py).", *notes])  # fmt: skip
    return tl, notes
