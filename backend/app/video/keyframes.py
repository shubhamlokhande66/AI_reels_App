"""The keyframe engine: a shot's animation as keyframes, checked, then rendered by FFmpeg as per-frame expressions.

A keyframe (models/timeline.Keyframe) sets some properties at a moment of the shot; each property is a separate
track that moves from keyframe to keyframe with the easing of the later keyframe. Before rendering, ``validate``
puts every value in its safe range and in time order, and says what it changed.

Rendering (``motion_chain``, ``frame_filters``): the tracks become FFmpeg expressions of the frame time ``t`` (a sum
of eased, clamped ramps: no nesting, so a hundred keyframes stay a short expression).

- zoom, x, y, rotation: the picture is drawn at twice the size (half-pixel smooth motion), scaled by the zoom, rotated,
  and cropped where x / y say; the window always stays inside the picture, and a rotation enlarges the picture just
  enough that no corner shows
- opacity and brightness: one ``eq`` (opacity fades towards black; brightness adds light)
- blur: the picture is scaled down and back up by the amount (a soft, smooth blur that can change every frame)

``preset(effect, length)``: the renderer's fixed effects (video/cutter.py) as keyframes, so they can be combined with
other keyframes and edited like any animation. Beat-reactive and wobbling effects (beat_punch, shake, roll...) stay
procedural in the renderer.
"""

from __future__ import annotations

import math
from typing import Iterable

from app.models.timeline import KEYFRAME_PROPS, Keyframe

RANGES: dict[str, tuple[float, float]] = {
    "zoom": (1.0, 3.0), "x": (-1.0, 1.0), "y": (-1.0, 1.0), "rotation": (-20.0, 20.0),
    "opacity": (0.0, 1.0), "blur": (0.0, 1.0), "brightness": (-0.5, 0.5), "speed": (0.25, 4.0),
}  # fmt: skip
DEFAULTS = {"zoom": 1.0, "x": 0.0, "y": 0.0, "rotation": 0.0, "opacity": 1.0, "blur": 0.0, "brightness": 0.0, "speed": 1.0}
MOTION = ("zoom", "x", "y", "rotation")
MAX_KEYFRAMES = 120
BLUR_SCALE = 12.0  # blur 1 = the picture drawn at 1/13 size and scaled back up
SAME_TIME = 0.002


# ---------------------------------------------------------------------- checking
def validate(keyframes: Iterable[Keyframe], length: float) -> tuple[list[Keyframe], list[str]]:
    """The keyframes made safe for a shot of ``length`` seconds: inside the shot, in time order, one per moment, values
    in range, at most MAX_KEYFRAMES. Returns (keyframes, what changed)."""
    notes: list[str] = []
    out: list[Keyframe] = []
    for k in sorted(keyframes, key=lambda k: k.t):
        t = min(max(k.t, 0.0), max(length, 0.0))
        if abs(t - k.t) > 1e-6:
            notes.append(f"keyframe at {k.t:.3f} s is outside the {length:.3f} s shot: moved to {t:.3f} s")
        values = {}
        for prop in KEYFRAME_PROPS:
            v = getattr(k, prop)
            if v is None:
                continue
            if not math.isfinite(v):
                notes.append(f"keyframe at {t:.3f} s: {prop} is not a number, left out")
                continue
            lo, hi = RANGES[prop]
            c = min(max(v, lo), hi)
            if abs(c - v) > 1e-9:
                notes.append(f"keyframe at {t:.3f} s: {prop} {v:g} -> {c:g} (allowed {lo:g}..{hi:g})")
            values[prop] = c
        if not values:
            continue
        if out and abs(out[-1].t - t) < SAME_TIME:  # the same moment twice: the later values win
            merged = {p: getattr(out[-1], p) for p in KEYFRAME_PROPS if getattr(out[-1], p) is not None}
            out[-1] = Keyframe(t=out[-1].t, ease=k.ease, **{**merged, **values})
            continue
        out.append(Keyframe(t=round(t, 4), ease=k.ease, **values))
    if len(out) > MAX_KEYFRAMES:
        notes.append(f"{len(out)} keyframes: only the first {MAX_KEYFRAMES} are kept")
        out = out[:MAX_KEYFRAMES]
    return out, notes


def tracks(keyframes: list[Keyframe]) -> dict[str, list[tuple[float, float, str]]]:
    """Per property: [(t, value, ease)] for the keyframes that set it."""
    out: dict[str, list[tuple[float, float, str]]] = {}
    for k in keyframes:
        for prop in KEYFRAME_PROPS:
            v = getattr(k, prop)
            if v is not None:
                out.setdefault(prop, []).append((k.t, float(v), k.ease))
    return out


def animates(keyframes: list[Keyframe], props: Iterable[str]) -> bool:
    return any(getattr(k, p) is not None for k in keyframes for p in props)


# ---------------------------------------------------------------------- value at a time (tests, previews)
def _ease(p: float, ease: str) -> float:
    p = min(max(p, 0.0), 1.0)
    return {"linear": p, "ease_in": p * p, "ease_out": p * (2 - p), "ease_in_out": 0.5 - 0.5 * math.cos(math.pi * p), "hold": 1.0 if p >= 1 else 0.0}[ease]


def value_at(track: list[tuple[float, float, str]], t: float, default: float = 0.0) -> float:
    if not track:
        return default
    v = track[0][1]
    for (t0, v0, _), (t1, v1, ease) in zip(track, track[1:]):
        if t >= t1:
            v = v1
        elif t > t0:
            return v0 + (v1 - v0) * _ease((t - t0) / max(t1 - t0, 1e-6), ease)
    return v


# ---------------------------------------------------------------------- FFmpeg expressions
def _num(v: float) -> str:
    return f"{v:.6g}"


def _ease_expr(p: str, ease: str) -> str:
    # ease_in_out is the renderer's own slider curve (video/cutter.pan_expression): smooth start and stop
    return {"linear": p, "ease_in": f"pow({p},2)", "ease_out": f"({p})*(2-({p}))", "ease_in_out": f"(0.5-0.5*cos(PI*{p}))",
            "hold": f"gte({p},1)"}[ease]  # fmt: skip


def expression(track: list[tuple[float, float, str]], default: float, var: str = "t") -> str:
    """A track as one FFmpeg expression of ``var``: the first value, plus each step's change times its eased progress
    (clamped to 0..1). A sum, not nested ifs: long animations stay short and fast to evaluate."""
    if not track:
        return _num(default)
    terms = [_num(track[0][1])]
    for (t0, v0, _), (t1, v1, ease) in zip(track, track[1:]):
        dv = v1 - v0
        if abs(dv) < 1e-9:
            continue
        p = f"clip(({var}-{_num(t0)})/{_num(max(t1 - t0, 1e-4))},0,1)"
        terms.append(f"{_num(dv)}*{_ease_expr(p, ease)}")
    return "(" + "+".join(terms) + ")"


def _rotation_cover(max_deg: float, aspect: float) -> float:
    """How much a picture of ``aspect`` (w/h) must be enlarged so that, rotated by up to ``max_deg``, it still covers
    its own frame (no corner shows)."""
    a = math.radians(abs(max_deg))
    ratio = max(aspect, 1 / aspect)
    return math.cos(a) + ratio * math.sin(a)


def motion_chain(keyframes: list[Keyframe], w: int, h: int) -> str:
    """Zoom / position / rotation as filters producing a ``w`` x ``h`` picture (constant size, like video/cutter.py's
    own motion chains: drawn at twice the size so slow moves are smooth)."""
    tr = tracks(keyframes)
    rot = tr.get("rotation", [])
    cover = _rotation_cover(max((abs(v) for _, v, _ in rot), default=0.0), w / h) if rot else 1.0
    z = expression(tr.get("zoom", []), 1.0)
    if cover > 1.0:
        z = f"max({z},{_num(cover * 1.004)})"  # a hair above the cover: the rounded picture is never smaller than the window
    W2, H2 = 2 * w, 2 * h
    chain = [f"scale=w='trunc({W2}*{z}/2)*2':h='trunc({H2}*{z}/2)*2':eval=frame:flags=bicubic"]
    x, y = expression(tr.get("x", []), 0.0), expression(tr.get("y", []), 0.0)
    if rot:
        # rotate needs a picture of constant size: a fixed window, enlarged by the cover factor, is cut out first (the
        # zoom never goes below the cover, so it fits), rotated, and its centre kept: no corner ever shows
        CW, CH = int(W2 * cover / 2) * 2, int(H2 * cover / 2) * 2
        chain.append(f"crop=w={CW}:h={CH}:x='(in_w-out_w)/2*(1+({x}))':y='(in_h-out_h)/2*(1+({y}))'")
        chain.append(f"rotate=a='({expression(rot, 0.0)})*PI/180':fillcolor=black")
        chain.append(f"crop={W2}:{H2}")
    else:
        chain.append(f"crop=w={W2}:h={H2}:x='(in_w-out_w)/2*(1+({x}))':y='(in_h-out_h)/2*(1+({y}))'")
    chain.append(f"scale={w}:{h}:flags=area")
    return ",".join(chain)


def frame_filters(keyframes: list[Keyframe], w: int, h: int) -> list[str]:
    """Opacity, brightness and blur, on the finished ``w`` x ``h`` picture."""
    tr = tracks(keyframes)
    out: list[str] = []
    if "blur" in tr:
        b = expression(tr["blur"], 0.0)
        out.append(f"scale=w='max(trunc({w}/(1+{BLUR_SCALE}*{b})/2)*2,16)':h='max(trunc({h}/(1+{BLUR_SCALE}*{b})/2)*2,16)':eval=frame:flags=bicubic")
        out.append(f"scale={w}:{h}:flags=bicubic")
    if "opacity" in tr or "brightness" in tr:
        o = expression(tr.get("opacity", []), 1.0)
        b = expression(tr.get("brightness", []), 0.0)
        # out = in * opacity (towards black) + brightness: eq's contrast pivots on mid-grey, so the brightness
        # term moves the pivot back to black
        out.append(f"eq=contrast='{o}':brightness='0.5*({o}-1)+{b}':saturation='{o}':eval=frame")
    return out


# ---------------------------------------------------------------------- the renderer's effects as keyframes
def preset(effect: str, length: float) -> list[Keyframe]:
    """The keyframes of a fixed effect (the renderer's own numbers, video/cutter.py), or [] for an effect that is not a
    keyframe animation (beat-reactive, shake, roll, looks)."""
    from app.video import cutter as c

    d = max(length, 0.1)
    K = Keyframe
    if effect == "zoom_in":
        return [K(t=0, zoom=1.0), K(t=d, zoom=1 + c.ZOOM_AMOUNT)]
    if effect == "zoom_out":
        return [K(t=0, zoom=1 + c.ZOOM_AMOUNT), K(t=d, zoom=1.0)]
    if effect == "punch":
        return [K(t=0, zoom=1 + c.PUNCH_AMOUNT), K(t=min(c.PUNCH_SECONDS, d), zoom=1 + c.PUNCH_AMOUNT * max(0.0, 1 - d / c.PUNCH_SECONDS))]
    if effect == "punch_out":
        start = max(d - c.PUNCH_SECONDS, 0.0)
        return [K(t=start, zoom=1 + c.PUNCH_AMOUNT * max(0.0, 1 - d / c.PUNCH_SECONDS)), K(t=d, zoom=1 + c.PUNCH_AMOUNT)]
    if effect == "crash_zoom":
        return [K(t=0, zoom=1.0), K(t=min(c.CRASH_SECONDS, d), zoom=1 + c.CRASH_AMOUNT * min(d / c.CRASH_SECONDS, 1.0))]
    if effect == "ken_burns":  # a slow push in, the window travelling from bottom-left to top-right
        return [K(t=0, zoom=1.0, x=-1.0, y=1.0), K(t=d, zoom=1 + c.KEN_BURNS_AMOUNT, x=1.0, y=-1.0)]
    pans = {"pan_right": ("x", -1.0, 1.0), "pan_left": ("x", 1.0, -1.0), "pan_down": ("y", -1.0, 1.0), "pan_up": ("y", 1.0, -1.0)}
    if effect in pans:
        axis, a, b = pans[effect]
        return [K(t=0, zoom=c.PAN_SCALE, **{axis: a}), K(t=d, zoom=c.PAN_SCALE, ease="ease_in_out", **{axis: b})]
    if effect == "flash":
        return [K(t=0, brightness=c.FLASH_STRENGTH), K(t=min(c.FLASH_SECONDS, d), brightness=0.0)]
    return []


def merge(base: list[Keyframe], over: list[Keyframe]) -> list[Keyframe]:
    """``over``'s tracks replace ``base``'s for the properties ``over`` animates; ``base`` keeps the rest (an effect's
    flash under a hand-made zoom, for instance)."""
    taken = {p for k in over for p in KEYFRAME_PROPS if getattr(k, p) is not None}
    kept = []
    for k in base:
        values = {p: getattr(k, p) for p in KEYFRAME_PROPS if getattr(k, p) is not None and p not in taken}
        if values:
            kept.append(Keyframe(t=k.t, ease=k.ease, **values))
    return sorted([*kept, *over], key=lambda k: k.t)


# ---------------------------------------------------------------------- speed ramps (time remapping)
RAMP_STEP = 0.05  # seconds of the shot per piece of the time map (fine enough that the remap is smooth)


def has_speed(keyframes: list[Keyframe]) -> bool:
    return animates(keyframes, ["speed"])


def source_seconds(keyframes: list[Keyframe], t: float, base: float = 1.0) -> float:
    """How much footage has played ``t`` seconds into the shot: the speed track integrated (``base`` without one)."""
    track = tracks(keyframes).get("speed")
    if not track:
        return base * t
    n = max(int(math.ceil(t / RAMP_STEP * 4)), 1)
    dt = t / n
    return sum(value_at(track, (i + 0.5) * dt, base) for i in range(n)) * dt  # midpoint rule, fine steps


def average_speed(keyframes: list[Keyframe], length: float, base: float = 1.0) -> float:
    return source_seconds(keyframes, length, base) / max(length, 1e-6)


def speed_setpts(keyframes: list[Keyframe], length: float) -> str:
    """The setpts filter that plays the footage at the speed track: each source moment is moved to the shot time
    when it should show (the inverse of ``source_seconds``, piecewise linear every RAMP_STEP seconds of the shot)."""
    steps = max(int(math.ceil(length / RAMP_STEP)), 1)
    shot_t = [min(i * RAMP_STEP, length) for i in range(steps + 1)]
    src_t = [source_seconds(keyframes, t) for t in shot_t]
    s = "(PTS-STARTPTS)*TB"
    terms = [_num(shot_t[0])]
    for (s0, t0), (s1, t1) in zip(zip(src_t, shot_t), zip(src_t[1:], shot_t[1:])):
        if s1 - s0 > 1e-6:
            terms.append(f"{_num(t1 - t0)}*clip(({s}-{_num(s0)})/{_num(s1 - s0)},0,1)")
    # footage past the end of the map keeps the last speed
    last = value_at(tracks(keyframes)["speed"], length, 1.0)
    terms.append(f"max({s}-{_num(src_t[-1])},0)/{_num(last)}")
    return f"setpts='({'+'.join(terms)})/TB'"


def slowest(keyframes: list[Keyframe]) -> float:
    track = tracks(keyframes).get("speed") or [(0.0, 1.0, "linear")]
    return min(v for _, v, _ in track)


def ramp_preset(kind: str, length: float, at: float | None = None) -> list[Keyframe]:
    """Ready-made speed ramps, timed to the music: ``into_drop`` (slow, then accelerating into the cut at the end: the
    drop), ``slow_hit`` (normal, slow motion on the hit at ``at``, back to normal), ``out_of_drop`` (fast off the cut,
    settling to normal), ``slow_fast_slow``."""
    d = max(length, 0.2)
    h = min(max(at if at is not None else d / 2, 0.1), d - 0.1)
    K = Keyframe
    if kind == "into_drop":
        return [K(t=0, speed=0.6), K(t=d * 0.6, speed=0.6), K(t=d, speed=2.0, ease="ease_in")]
    if kind == "slow_hit":
        return [K(t=0, speed=1.0), K(t=max(h - 0.15, 0), speed=1.0), K(t=h, speed=0.35, ease="ease_out"), K(t=min(h + 0.6, d), speed=1.0, ease="ease_in_out")]
    if kind == "out_of_drop":
        return [K(t=0, speed=2.0), K(t=min(0.5, d), speed=1.0, ease="ease_out")]
    if kind == "slow_fast_slow":
        return [K(t=0, speed=0.5), K(t=d / 2, speed=2.0, ease="ease_in_out"), K(t=d, speed=0.5, ease="ease_in_out")]
    return []
