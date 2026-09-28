"""Effect registry: the single list of per-shot camera effects the renderer can really execute.

The AI director receives this list (never a hard-coded one) and anything it asks for is mapped onto a registered
effect by ``resolve_effect`` (``"slow_zoom_in"`` -> ``zoom_in``, ``"ken_burns"`` -> ``zoom_in``, unknown -> ``none``),
so a model can never request something FFmpeg cannot do. Transitions have their own registry
(``video/transitions.py``); ``resolve_transition`` maps free-form names onto it the same way.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.video import transitions as tr


@dataclass(frozen=True)
class EffectSpec:
    name: str
    kind: str  # "none" | "zoom" | "pan"
    label: str
    hint: str  # when an editor uses it (sent to the AI)


_REGISTRY: dict[str, EffectSpec] = {}


def register(spec: EffectSpec) -> EffectSpec:
    _REGISTRY[spec.name] = spec
    return spec


register(EffectSpec("none", "none", "No movement", "static, calm, lets the footage speak"))
register(EffectSpec("zoom_in", "zoom", "Slow push in", "builds attention; hero and reveal shots"))
register(EffectSpec("zoom_out", "zoom", "Slow pull out", "reveals context; endings and payoffs"))
register(EffectSpec("punch", "zoom", "Punch in on the cut", "a hit on a strong beat or drop"))
register(EffectSpec("punch_out", "zoom", "Punch building to the cut", "tension right before the next cut"))
register(EffectSpec("zoom_pulse", "zoom", "Beat pulse", "a small zoom pulse on every strong hit of the song inside the shot; energetic, beat-driven sections"))
register(EffectSpec("beat_punch", "zoom", "Punch on every hit", "a clear zoom punch on every strong hit inside the shot; a longer shot in loud, fast music still feels on the beat"))
register(EffectSpec("pan_left", "pan", "Pan left", "smooth travel across a wide or detailed frame"))
register(EffectSpec("pan_right", "pan", "Pan right", "smooth travel across a wide or detailed frame"))
register(EffectSpec("pan_up", "pan", "Tilt up", "reveal from bottom to top (products, buildings, outfits)"))
register(EffectSpec("pan_down", "pan", "Tilt down", "reveal from top to bottom"))
register(EffectSpec("ken_burns", "zoom", "Ken Burns", "slow push in with a diagonal drift; elegant, photos and still moments"))
register(EffectSpec("crash_zoom", "zoom", "Crash zoom", "fast snap in onto the subject; hooks, drops and reveals"))
register(EffectSpec("shake", "motion", "Camera shake", "handheld energy on a hit or drop; use sparingly"))
register(EffectSpec("roll", "motion", "Roll sway", "a gentle rotation sway; dreamy, fashion, dance"))
register(EffectSpec("flash", "look", "Flash", "a bright white pop at the start of the shot; lands a hard beat"))
register(EffectSpec("black_white", "look", "Black & white", "a monochrome moment for contrast, memories, drama"))
register(EffectSpec("beat_flash", "look", "Flash on every hit", "a short light pop on every strong hit inside the shot; drops and very energetic parts, use sparingly"))

# free-form names a model (or a person) might use -> a registered effect
_EFFECT_ALIASES = {
    "slow_zoom_in": "zoom_in", "zoom": "zoom_in", "push_in": "zoom_in", "push": "zoom_in", "dolly_in": "zoom_in", "kenburns": "ken_burns",
    "slow_zoom": "zoom_in", "zoom_in_slow": "zoom_in", "scale_up": "zoom_in",
    "slow_zoom_out": "zoom_out", "pull_out": "zoom_out", "pull_back": "zoom_out", "dolly_out": "zoom_out", "scale_down": "zoom_out",
    "punch_in": "punch", "impact": "punch", "hit": "punch", "camera_shake": "shake", "handheld": "shake", "earthquake": "shake",
    "bounce": "zoom_pulse", "crash": "crash_zoom", "snap_zoom": "crash_zoom", "whip_zoom": "crash_zoom", "fast_zoom": "crash_zoom",
    "rotate": "roll", "rotation": "roll", "dutch_angle": "roll", "sway": "roll", "spin": "roll",
    "white_flash": "flash", "flash_frame": "flash", "strobe": "beat_flash", "bw": "black_white", "b_w": "black_white",
    "black_and_white": "black_white", "monochrome": "black_white", "grayscale": "black_white", "greyscale": "black_white",
    "desaturate": "black_white", "noir": "black_white",
    "pulse": "zoom_pulse", "beat_pulse": "zoom_pulse", "zoom_beat": "zoom_pulse",
    "punch_on_beat": "beat_punch", "punch_on_hits": "beat_punch", "punch_on_every_hit": "beat_punch", "beat_zoom": "beat_punch",
    "flash_on_beat": "beat_flash", "flash_on_hits": "beat_flash", "flash_on_every_hit": "beat_flash", "beat_strobe": "beat_flash",
    "pan": "pan_right", "slide_left": "pan_left", "track_left": "pan_left", "truck_left": "pan_left",
    "slide_right": "pan_right", "track_right": "pan_right", "truck_right": "pan_right",
    "tilt_up": "pan_up", "pan_upward": "pan_up", "tilt_down": "pan_down", "pan_downward": "pan_down",
    "static": "none", "hold": "none", "still": "none", "": "none",
}  # fmt: skip

_TRANSITION_ALIASES = {
    "crossfade": "dissolve", "cross_dissolve": "dissolve", "cross_fade": "dissolve", "mix": "dissolve",
    "fade_black": "fade", "fade_to_black": "fade", "dip_to_black": "fade", "fade_through_black": "fade",
    "fade_white": "flash", "white_flash": "flash", "dip_to_white": "flash", "light_leak": "flash", "flash_cut": "flash",
    "hard_cut": "cut", "jump_cut": "cut", "match_cut": "cut", "none": "cut", "": "cut",
    "zoom_in": "zoom", "zoom_transition": "zoom", "whip": "slide_left", "whip_pan": "slide_left", "swipe": "slide_left",
    "slide_up": "slide", "push": "slide", "wipe": "wipe_left", "glitch": "pixelize", "blur_transition": "blur",
    "focus_pull": "blur", "ramp": "speed_ramp", "speedramp": "speed_ramp",
}  # fmt: skip


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(name or "").strip().lower()).strip("_")


def get_effect(name: str) -> EffectSpec:
    return _REGISTRY.get(name) or _REGISTRY["none"]


def available() -> list[str]:
    return list(_REGISTRY)


def catalogue() -> dict[str, str]:
    """{effect: when to use it} for the AI prompt, built from the registry."""
    return {s.name: s.hint for s in _REGISTRY.values()}


def resolve_effect(name: str) -> tuple[str, bool]:
    """(registered effect, whether it had to be mapped). Never fails."""
    n = _norm(name)
    if n in _REGISTRY:
        return n, False
    if n in _EFFECT_ALIASES:
        return _EFFECT_ALIASES[n], True
    if ("crash" in n or "snap" in n or "fast" in n or "quick" in n) and "zoom" in n:
        return "crash_zoom", True
    if "zoom" in n or "push" in n or "scale" in n:
        return ("zoom_out" if ("out" in n or "back" in n) else "zoom_in"), True
    for d in ("left", "right", "up", "down"):
        if d in n and ("pan" in n or "tilt" in n or "slide" in n or "track" in n):
            return f"pan_{d}", True
    if "pulse" in n or "beat" in n or "bounce" in n:
        return "zoom_pulse", True
    if "shake" in n or "shaky" in n or "handheld" in n:
        return "shake", True
    if "black" in n and "white" in n or "mono" in n or "gray" in n or "grey" in n:
        return "black_white", True
    if "flash" in n or "strobe" in n:
        return "flash", True
    if "roll" in n or "rotat" in n or "sway" in n:
        return "roll", True
    if "punch" in n or "hit" in n:
        return "punch", True
    return "none", True


def resolve_transition(name: str) -> tuple[str, bool]:
    """(registered transition, whether it had to be mapped). Unknown -> ``cut``."""
    n = _norm(name)
    registered = tr.available()
    if n in registered:
        return n, False
    if n in _TRANSITION_ALIASES and _TRANSITION_ALIASES[n] in registered:
        return _TRANSITION_ALIASES[n], True
    for key, target in (("dissolve", "dissolve"), ("fade", "fade"), ("flash", "flash"), ("zoom", "zoom"), ("blur", "blur"),
                        ("slide", "slide"), ("wipe", "wipe_left"), ("ramp", "speed_ramp")):  # fmt: skip
        if key in n:
            return target, True
    return "cut", True
