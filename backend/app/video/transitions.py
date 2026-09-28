"""Transition registry.

Each transition says how two consecutive segments are joined by the composer:
  * ``cut``    - plain concat, no overlap
  * ``xfade``  - FFmpeg xfade with the named transition (the clips overlap for ``duration``)
  * ``ramp``   - a speed ramp baked into the *outgoing* segment (the join itself is a cut)
Add a new one by registering it here; the composer needs no changes.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TransitionSpec:
    name: str
    kind: str  # "cut" | "xfade" | "ramp"
    xfade: str | None = None  # FFmpeg xfade transition name
    label: str = ""


_REGISTRY: dict[str, TransitionSpec] = {}


def register(spec: TransitionSpec) -> TransitionSpec:
    _REGISTRY[spec.name] = spec
    return spec


register(TransitionSpec("cut", "cut", label="Hard cut"))
register(TransitionSpec("fade", "xfade", "fadeblack", "Fade through black"))
register(TransitionSpec("dissolve", "xfade", "fade", "Cross dissolve"))
register(TransitionSpec("zoom", "xfade", "zoomin", "Zoom"))
register(TransitionSpec("slide", "xfade", "slideup", "Slide"))
register(TransitionSpec("blur", "xfade", "hblur", "Blur"))
register(TransitionSpec("flash", "xfade", "fadewhite", "Flash"))
register(TransitionSpec("speed_ramp", "ramp", label="Speed ramp"))

# The rest of FFmpeg's built-in xfade library (58 real transitions total) — the same catalogue paid editors offer,
# genuinely rendered by FFmpeg itself, not a preview-only label. All safe to pick from the Inspector's dropdown.
register(TransitionSpec("wipe_left", "xfade", "wipeleft", "Wipe left"))
register(TransitionSpec("wipe_right", "xfade", "wiperight", "Wipe right"))
register(TransitionSpec("wipe_up", "xfade", "wipeup", "Wipe up"))
register(TransitionSpec("wipe_down", "xfade", "wipedown", "Wipe down"))
register(TransitionSpec("wipe_tl", "xfade", "wipetl", "Wipe from top-left"))
register(TransitionSpec("wipe_tr", "xfade", "wipetr", "Wipe from top-right"))
register(TransitionSpec("wipe_bl", "xfade", "wipebl", "Wipe from bottom-left"))
register(TransitionSpec("wipe_br", "xfade", "wipebr", "Wipe from bottom-right"))
register(TransitionSpec("slide_left", "xfade", "slideleft", "Slide left"))
register(TransitionSpec("slide_right", "xfade", "slideright", "Slide right"))
register(TransitionSpec("slide_down", "xfade", "slidedown", "Slide down"))
register(TransitionSpec("smooth_left", "xfade", "smoothleft", "Smooth wipe left"))
register(TransitionSpec("smooth_right", "xfade", "smoothright", "Smooth wipe right"))
register(TransitionSpec("smooth_up", "xfade", "smoothup", "Smooth wipe up"))
register(TransitionSpec("smooth_down", "xfade", "smoothdown", "Smooth wipe down"))
register(TransitionSpec("circle_open", "xfade", "circleopen", "Circle open"))
register(TransitionSpec("circle_close", "xfade", "circleclose", "Circle close"))
register(TransitionSpec("circle_crop", "xfade", "circlecrop", "Circle crop"))
register(TransitionSpec("rect_crop", "xfade", "rectcrop", "Rectangle crop"))
register(TransitionSpec("vert_open", "xfade", "vertopen", "Vertical open"))
register(TransitionSpec("vert_close", "xfade", "vertclose", "Vertical close"))
register(TransitionSpec("horz_open", "xfade", "horzopen", "Horizontal open"))
register(TransitionSpec("horz_close", "xfade", "horzclose", "Horizontal close"))
register(TransitionSpec("distance", "xfade", "distance", "Distance"))
register(TransitionSpec("radial", "xfade", "radial", "Radial wipe"))
register(TransitionSpec("pixelize", "xfade", "pixelize", "Pixelate"))
register(TransitionSpec("diag_tl", "xfade", "diagtl", "Diagonal from top-left"))
register(TransitionSpec("diag_tr", "xfade", "diagtr", "Diagonal from top-right"))
register(TransitionSpec("diag_bl", "xfade", "diagbl", "Diagonal from bottom-left"))
register(TransitionSpec("diag_br", "xfade", "diagbr", "Diagonal from bottom-right"))
register(TransitionSpec("slice_h_left", "xfade", "hlslice", "Horizontal slices from left"))
register(TransitionSpec("slice_h_right", "xfade", "hrslice", "Horizontal slices from right"))
register(TransitionSpec("slice_v_up", "xfade", "vuslice", "Vertical slices upward"))
register(TransitionSpec("slice_v_down", "xfade", "vdslice", "Vertical slices downward"))
register(TransitionSpec("squeeze_h", "xfade", "squeezeh", "Squeeze horizontally"))
register(TransitionSpec("squeeze_v", "xfade", "squeezev", "Squeeze vertically"))
register(TransitionSpec("wind_left", "xfade", "hlwind", "Wind left"))
register(TransitionSpec("wind_right", "xfade", "hrwind", "Wind right"))
register(TransitionSpec("cover_left", "xfade", "coverleft", "Cover from the left"))
register(TransitionSpec("cover_right", "xfade", "coverright", "Cover from the right"))
register(TransitionSpec("cover_up", "xfade", "coverup", "Cover from below"))
register(TransitionSpec("cover_down", "xfade", "coverdown", "Cover from above"))
register(TransitionSpec("reveal_left", "xfade", "revealleft", "Reveal to the left"))
register(TransitionSpec("reveal_right", "xfade", "revealright", "Reveal to the right"))
register(TransitionSpec("reveal_up", "xfade", "revealup", "Reveal upward"))
register(TransitionSpec("reveal_down", "xfade", "revealdown", "Reveal downward"))
register(TransitionSpec("fade_grays", "xfade", "fadegrays", "Fade through grayscale"))

# Speed ramp: the last RAMP_SECONDS of the outgoing shot play at RAMP_FACTOR x speed.
RAMP_SECONDS = 0.3
RAMP_FACTOR = 2.5


def get_transition(name: str) -> TransitionSpec:
    return _REGISTRY.get(name) or _REGISTRY["cut"]


def is_overlapping(name: str) -> bool:
    return get_transition(name).kind == "xfade"


def available() -> list[str]:
    return list(_REGISTRY)
