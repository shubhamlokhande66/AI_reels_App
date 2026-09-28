"""The director: turns understood photos + music into a micro-timeline of purposeful shots.

Nothing here touches pixels. It decides, for every moment: what the shot is for (hook, curiosity, reveal, hero, detail,
macro, payoff, call to action), where the camera looks and how it moves, which effect happens on which beat, how the
picture changes to the next shot, and when text appears. The result is a plan that a person can read, and a renderer can play.

Deterministic: the same photos, music and seed give the same plan.
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from app.models.analysis import AudioAnalysis
from app.product.models import (
    CameraMove, CameraType, Framing, Highlight, ImageUnderstanding, ProductReelPlan, Purpose, QualityCheck, Region, Shot, ShotEffect,
    ShotTransition, TextLayer, TransitionType, View,
)  # fmt: skip
from app.product.styles import ProductStyle

CANVAS_ASPECT = 9 / 16  # the camera is always a 9:16 window: nothing is ever stretched
MAX_UPSCALE = 2.6  # a crop is never enlarged more than this (beyond it the picture turns soft)
REF_HEIGHT = 1920  # the finished frame's height, used for the resolution rule
MIN_SHOT, MAX_SHOT, MAX_ENDING = 0.2, 1.5, 2.2
SAFE_TOP, SAFE_BOTTOM = 0.08, 0.80  # text stays clear of the app's buttons and caption area

# purpose, share of the duration, preferred shot length (seconds)
PHASES: list[tuple[Purpose, float, tuple[float, float]]] = [
    ("hook", 0.08, (0.35, 0.6)),
    ("curiosity", 0.14, (0.5, 1.0)),
    ("reveal", 0.12, (1.0, 1.5)),
    ("hero", 0.14, (1.2, 1.5)),
    ("detail", 0.16, (0.5, 1.0)),
    ("macro", 0.14, (0.3, 0.7)),
    ("payoff", 0.12, (1.0, 1.5)),
    ("cta", 0.10, (1.5, 2.2)),
]
INTENT = {
    "hook": "Stop the scroll: start on a striking detail, revealed out of the dark by light.",
    "curiosity": "Show only part of the product so the viewer wants to see the rest.",
    "reveal": "Let the product come into view.",
    "hero": "The full product, clean and confident, with a light passing across it.",
    "detail": "Move in on what makes it special.",
    "macro": "The finest detail, up close, with a sparkle where it truly reflects light.",
    "payoff": "The satisfying pull-back: the whole piece again, with everything seen.",
    "cta": "A calm final frame with room for the call to action.",
}
TRANSITION_TABLE: dict[tuple[str, str], TransitionType] = {
    ("hook", "curiosity"): "blur", ("curiosity", "reveal"): "light", ("reveal", "hero"): "match", ("hero", "detail"): "zoom",
    ("detail", "macro"): "zoom", ("macro", "payoff"): "flash", ("payoff", "cta"): "blur",
}  # fmt: skip
TRANSITION_SECONDS: dict[str, float] = {"fade_from_black": 0.35, "blur": 0.28, "light": 0.16, "zoom": 0.22, "whip_left": 0.18, "whip_right": 0.18, "flash": 0.14,
                                        "dissolve": 0.4, "dip_to_black": 0.36}  # fmt: skip
# every transition the product renderer can draw between two shots (the AI chooses from exactly these)
PRODUCT_TRANSITIONS = ("cut", "match", "blur", "light", "zoom", "flash", "whip_left", "whip_right", "dissolve", "dip_to_black")


@dataclass
class _Beats:
    times: list[float]  # beat times relative to the Reel start, beginning at 0
    strong: set[float]
    drops: list[float]
    accents: list[tuple[float, float]]  # (time, strength)
    bpm: float
    synthetic: bool


def _beats(audio: AudioAnalysis | None, audio_start: float, duration: float) -> _Beats:
    if audio is None or not audio.beats:
        period = 60.0 / 110.0
        times = [round(i * period, 3) for i in range(int(duration / period) + 2)]
        return _Beats(times, set(times[::4]), [], [], 110.0, True)
    rel = [round(b - audio_start, 3) for b in audio.beats if -0.03 <= b - audio_start <= duration + 0.05]
    rel = [max(b, 0.0) for b in rel]
    if not rel or rel[0] > 0.05:
        rel.insert(0, 0.0)
    else:
        rel[0] = 0.0
    times = sorted(set(rel))
    strong = {round(b - audio_start, 3) for b in audio.strong_beats if 0 <= b - audio_start <= duration}
    drops = [round(d - audio_start, 3) for d in audio.drops if 0 <= d - audio_start <= duration]
    accents = [(round(t - audio_start, 3), s) for t, s in zip(audio.accents, audio.accent_strengths) if 0 <= t - audio_start <= duration and s >= 0.55]
    return _Beats(times, strong, drops, accents, audio.bpm, False)


# ------------------------------------------------------------------ geometry
def _hero_hh(u: ImageUnderstanding) -> float:
    """View height (as a fraction of the photo's height) that shows the whole product with some room around it."""
    need_for_width = u.subject.w * u.width / (CANVAS_ASPECT * u.height)
    hh = max(u.subject.h, need_for_width) * 1.30
    if u.subject_confidence < 0.5 and u.width / u.height <= 0.7:
        return min(hh, 1.0)  # an unsure outline on an already-portrait photo: show the photo itself, not an invented margin
    return hh


def _min_hh(u: ImageUnderstanding) -> float:
    """The smallest view that keeps the enlargement within MAX_UPSCALE (so close-ups stay sharp)."""
    return REF_HEIGHT / (MAX_UPSCALE * u.height)


def _view_half(u: ImageUnderstanding, hh: float) -> tuple[float, float]:
    return hh * u.height * CANVAS_ASPECT / u.width / 2, hh / 2  # half width, half height (fractions of the photo)


def _clamp_center(u: ImageUnderstanding, cx: float, cy: float) -> tuple[float, float]:
    """Keep the camera's centre on the product's outline so the view never drifts onto empty backdrop."""
    s = u.subject
    return min(max(cx, s.x), s.x + s.w), min(max(cy, s.y), s.y + s.h)


def _view(u: ImageUnderstanding, cx: float, cy: float, hh: float, roll: float = 0.0) -> View:
    cx, cy = _clamp_center(u, cx, cy)
    return View(cx=round(cx, 4), cy=round(cy, 4), hh=round(max(hh, _min_hh(u) if hh < _hero_hh(u) else hh), 4), roll=round(roll, 3))


def _visible(u: ImageUnderstanding, view: View, hl: Highlight, margin: float = 0.82) -> bool:
    hw, hhalf = _view_half(u, view.hh)
    return abs(hl.x - view.cx) <= hw * margin and abs(hl.y - view.cy) <= hhalf * margin


# ------------------------------------------------------------------ the plan
@dataclass
class _Slot:
    start: float
    end: float
    purpose: Purpose
    beat: float | None


def _nearest_beat(beats: _Beats, t: float, tolerance: float) -> float | None:
    b = min(beats.times, key=lambda x: abs(x - t))
    return b if abs(b - t) <= tolerance else None


def _phase_cuts(t: float, limit: float, lo: float, hi: float, cap: float, beats: _Beats) -> list[float]:
    """Cut times inside one phase (ending at ``limit``): evenly sized shots, every cut on a beat where one is near."""
    remaining = limit - t
    n = max(1, round(remaining / ((lo + hi) / 2)))
    while remaining / n > cap + 1e-6:
        n += 1
    while n > 1 and remaining / n < 0.3:
        n -= 1
    out: list[float] = []
    prev = t
    for k in range(1, n):
        ideal = t + remaining * k / n
        cands = [b for b in beats.times if prev + 0.25 <= b <= min(prev + cap, limit - 0.25 * (n - k))]
        best = min(cands, key=lambda b: abs(b - ideal) - (0.04 if b in beats.strong else 0.0)) if cands else None
        cut = best if best is not None and abs(best - ideal) <= 0.3 * (remaining / n) + 0.12 else min(max(ideal, prev + 0.25), prev + cap)
        out.append(round(cut, 3))
        prev = cut
    out.append(round(limit, 3))
    return out


def _slots(duration: float, beats: _Beats, pace: float, phases: list | None = None) -> list[_Slot]:
    """Shot boundaries: every phase gets its share of the time, and the cuts land on beats."""
    out: list[_Slot] = []
    t, acc = 0.0, 0.0
    phases = phases or PHASES
    for pi, (purpose, share, (lo, hi)) in enumerate(phases):
        acc += share
        last = pi == len(phases) - 1
        limit = round(duration, 3) if last else acc * duration
        if not last:  # the end of a phase is itself a cut: put it on a beat when one is close
            snapped = _nearest_beat(beats, limit, 0.35)
            limit = snapped if snapped is not None and snapped > t + 0.3 else limit
            limit = round(min(limit, duration - 0.3), 3)
        cap = MAX_ENDING if purpose == "cta" else MAX_SHOT
        lo, hi = min(max(lo / pace, 0.25), cap), min(max(hi / pace, 0.3), cap)
        for nxt in _phase_cuts(t, limit, lo, hi, cap, beats):
            b = _nearest_beat(beats, t, 0.06)
            out.append(_Slot(round(t, 3), nxt, purpose, round(b, 3) if b is not None else None))
            t = nxt
    return out


def _quality(u: ImageUnderstanding) -> float:
    return u.subject_confidence * 0.5 + min(u.sharpness / 8.0, 1.0) * 0.3 + min(len(u.highlights) / 4.0, 1.0) * 0.2 + min(max(u.width, u.height) / 3000, 1.0) * 0.2


def _with_highlight_regions(u: ImageUnderstanding) -> list[Region]:
    """The photo's detail regions plus one centred on each reflective highlight (a close-up on a glint is what sparkles need)."""
    regs = sorted(u.regions, key=lambda r: -r.score)
    side = 0.3 * max(u.subject.w * u.width, u.subject.h * u.height)
    for h in sorted(u.highlights, key=lambda h: -h.strength)[:4]:
        rw, rh = side / u.width, side / u.height
        from app.product.models import Rect  # local: keeps the module header short

        rect = Rect(x=min(max(h.x - rw / 2, 0.0), 1 - rw), y=min(max(h.y - rh / 2, 0.0), 1 - rh), w=min(rw, 1.0), h=min(rh, 1.0))
        if all(abs(rect.cx - r.rect.cx) > 0.6 * rw or abs(rect.cy - r.rect.cy) > 0.6 * rh for r in regs):
            regs.append(Region(rect=rect, score=round(0.6 + 0.4 * h.strength, 3), kind="macro"))
    return sorted(regs, key=lambda r: -r.score)


def _pick_regions(images: list[ImageUnderstanding], order: list[int]) -> list[tuple[int, Region]]:
    """Regions to close in on, best first, alternating between photos when there are several."""
    per: list[list[tuple[int, Region]]] = [[(i, r) for r in _with_highlight_regions(images[i])] for i in order]
    out: list[tuple[int, Region]] = []
    while any(per):
        for lst in per:
            if lst:
                out.append(lst.pop(0))
    return out


def _zoom_pair(hh: float, push: float, floor: float) -> tuple[float, float]:
    """(wide, close) view heights around ``hh``. If the close end would pass the sharpness limit, the whole move shifts wider."""
    wide, close = hh * (1 + 0.5 * push), hh * (1 - 0.5 * push)
    if close < floor:
        wide, close = wide + (floor - close), floor
    return wide, close


def _cam(kind: CameraType, base: View, u: ImageUnderstanding, style: ProductStyle, direction: int, sway: float) -> CameraMove:
    hw, _ = _view_half(u, base.hh)
    push = style.push
    wide, close = _zoom_pair(base.hh, push, _min_hh(u))
    if kind == "push_in":
        a, b = _view(u, base.cx, base.cy, wide), _view(u, base.cx, base.cy, close, sway)
    elif kind == "pull_out":
        a, b = _view(u, base.cx, base.cy, close, -sway), _view(u, base.cx, base.cy, wide)
    elif kind in ("pan_left", "pan_right"):
        d = (-1 if kind == "pan_left" else 1) * hw * 0.32
        a, b = _view(u, base.cx - d, base.cy, base.hh), _view(u, base.cx + d, base.cy, base.hh * (1 - push * 0.3))
    elif kind in ("tilt_up", "tilt_down"):
        d = (-1 if kind == "tilt_up" else 1) * base.hh * 0.10
        a, b = _view(u, base.cx, base.cy - d, base.hh), _view(u, base.cx, base.cy + d, base.hh * (1 - push * 0.3))
    elif kind == "drift":
        a, b = _view(u, base.cx, base.cy, base.hh, -sway), _view(u, base.cx + direction * hw * 0.08, base.cy, base.hh * 0.97, sway)
    else:  # hold
        a = b = _view(u, base.cx, base.cy, base.hh)
    return CameraMove(type=kind, start=a, end=b, ease="linear" if kind == "hold" else "in_out")


def _text_box_overlap(u: ImageUnderstanding, view: View, y: float, text: str, size: float) -> float:
    """How much of the product a line of text at frame height ``y`` would cover (0..1 of the product)."""
    hw, hhalf = _view_half(u, view.hh)
    s = u.subject
    fx0, fx1 = 0.5 + (s.x - view.cx) / (2 * hw), 0.5 + (s.x + s.w - view.cx) / (2 * hw)
    fy0, fy1 = 0.5 + (s.y - view.cy) / (2 * hhalf), 0.5 + (s.y + s.h - view.cy) / (2 * hhalf)
    tw = min(0.9, max(len(text), 3) * size * 0.5 * (16 / 9) / 1.0 * CANVAS_ASPECT * 1.0 + 0.05)
    tx0, tx1, ty0, ty1 = 0.5 - tw / 2, 0.5 + tw / 2, y - size * 0.7, y + size * 0.7
    ix = max(0.0, min(fx1, tx1) - max(fx0, tx0))
    iy = max(0.0, min(fy1, ty1) - max(fy0, ty0))
    area = max((fx1 - fx0) * (fy1 - fy0), 1e-6)
    return min(ix * iy / area, 1.0)


def _text_y(u: ImageUnderstanding, view: View, text: str, size: float) -> float:
    """The place for a line of text that covers the product least, inside the safe area."""
    best = min(
        (0.14, 0.22, 0.30, 0.66, 0.74, SAFE_BOTTOM - 0.02),
        key=lambda y: (_text_box_overlap(u, view, y, text, size), abs(y - 0.16)),
    )
    return best


def plan_reel(
    images: list[ImageUnderstanding],
    audio: AudioAnalysis | None,
    *,
    style: ProductStyle,
    duration: float,
    audio_start: float = 0.0,
    hook: str = "",
    tagline: str = "",
    cta: str = "",
    loop: bool = False,
    seed: int = 0,
    fps: int = 30,
    phases: list | None = None,
    cameras: dict[str, str] | None = None,
    text_animations: dict[str, str] | None = None,
    transitions: dict[str, str] | None = None,
) -> ProductReelPlan:
    """``phases`` / ``cameras`` / ``text_animations`` are an (already validated) AI direction; None = the built-in one."""
    if not images:
        raise ValueError("At least one photo is required.")
    rng = random.Random(seed)
    warnings: list[str] = []
    notes: list[str] = []
    beats = _beats(audio, audio_start, duration)
    if beats.synthetic:
        notes.append("No music: the shots follow a steady 110 BPM rhythm.")
    slots = _slots(duration, beats, style.pace, phases)

    order = sorted(range(len(images)), key=lambda i: -_quality(images[i]))
    primary = order[0]
    up = images[primary]
    regions = _pick_regions(images, order)
    if not regions:  # a photo with no measurable detail: close in on the middle of the product
        s = up.subject
        regions = [(primary, Region(rect=s, score=0.5))]
    n_detail_like = sum(1 for s in slots if s.purpose in ("detail", "macro"))
    region_iter = iter(regions * (1 + n_detail_like // max(len(regions), 1)))

    hero_view = _view(up, up.subject.cx, up.subject.cy, _hero_hh(up))
    shots: list[Shot] = []
    sparkles_used = 0
    sweeps_used = 0
    leaks_used = 0
    last_sparkle: dict[tuple[int, int], int] = {}
    prev_framing: Framing | None = None
    prev_image = -1
    run = 0
    prev_kind: CameraType | None = None
    direction = 1 if rng.random() < 0.5 else -1
    sway_dir = 1

    for idx, slot in enumerate(slots):
        length = round(slot.end - slot.start, 3)
        p = slot.purpose
        img_i, region = primary, None
        if p in ("detail", "macro"):
            img_i, region = next(region_iter)
        elif p == "payoff" and len(images) > 1 and rng.random() < 0.5:
            img_i = order[1 % len(order)]
        u = images[img_i]
        hero_hh = _hero_hh(u)
        hh_min = _min_hh(u)

        # ---- framing and where the camera looks
        if p == "hook":
            framing: Framing = "extreme_close_up"
            reg = sorted(u.regions, key=lambda r: -r.score)[:1]
            fx, fy = (reg[0].rect.cx, reg[0].rect.cy) if reg else (u.subject.cx, u.subject.cy)
            base = _view(u, fx, fy, max(0.30 * hero_hh, hh_min))
        elif p == "curiosity":
            framing = "close_up"
            # deliberately off-centre: only part of the product is visible
            base = _view(u, u.subject.x + u.subject.w * (0.32 if direction > 0 else 0.68), u.subject.y + u.subject.h * 0.4, max(0.5 * hero_hh, hh_min))
        elif p == "reveal":
            framing, base = "medium", _view(u, u.subject.cx, u.subject.cy, 0.78 * hero_hh)
        elif p in ("hero", "cta"):
            framing, base = "hero", _view(u, u.subject.cx, u.subject.cy, hero_hh)
        elif p == "payoff":
            framing, base = "hero", _view(u, u.subject.cx, u.subject.cy, hero_hh)
        elif p == "detail":
            framing = "detail"
            base = _view(u, region.rect.cx, region.rect.cy, max(0.42 * hero_hh, hh_min * 1.15))
        else:  # macro
            framing = "macro"
            base = _view(u, region.rect.cx, region.rect.cy, max(0.22 * hero_hh, hh_min))
        if framing == prev_framing and prev_image == img_i:
            run += 1  # the same kind of shot again: change the scale and the aim so it is a new composition
            factor = (0.84, 1.16, 0.7, 1.3)[(run - 1) % 4]
            dx = (0.10, -0.10, 0.06, -0.06)[(run - 1) % 4] * u.subject.w
            base = _view(u, base.cx + dx, base.cy, max(base.hh * factor, hh_min if framing in ("macro", "detail", "extreme_close_up", "close_up") else base.hh * factor))
        else:
            run = 0
        prev_framing, prev_image = framing, img_i

        # ---- camera move (varied, never the same twice in a row)
        allowed: dict[str, list[CameraType]] = {
            "hook": ["pull_out"], "curiosity": ["push_in", "pan_right" if direction > 0 else "pan_left"], "reveal": ["push_in", "drift"],
            "hero": ["drift", "push_in"], "detail": ["push_in", "pan_left", "pan_right", "tilt_up", "tilt_down"],
            "macro": ["push_in", "drift", "tilt_up"], "payoff": ["pull_out"], "cta": ["hold", "drift"],
        }  # fmt: skip
        kinds = [k for k in allowed[p] if k != prev_kind] or allowed[p]
        wanted = (cameras or {}).get(p)
        kind = wanted if wanted in allowed[p] and wanted != prev_kind else rng.choice(kinds)
        if kind in ("pan_left", "pan_right"):
            direction = -direction
            kind = "pan_right" if direction > 0 else "pan_left"
        sway = style.sway_deg * sway_dir if p in ("hero", "reveal", "payoff") else 0.0
        if sway:
            sway_dir = -sway_dir
        camera = _cam(kind, base, u, style, direction, abs(sway))
        prev_kind = kind

        shot = Shot(index=idx, start=slot.start, end=slot.end, purpose=p, framing=framing, image_index=img_i, camera=camera,
                    beat_time=slot.beat, note=INTENT[p])  # fmt: skip
        mid = _view(u, (camera.start.cx + camera.end.cx) / 2, (camera.start.cy + camera.end.cy) / 2, (camera.start.hh + camera.end.hh) / 2)

        # ---- effects: each one has a reason, and they are capped
        fx: list[ShotEffect] = []
        if p == "hook":
            fx.append(ShotEffect(type="light_sweep", at=0.0, duration=max(length, 0.4), strength=0.55))
            sweeps_used += 1
        if p == "hero" and sweeps_used < style.light_sweeps:
            fx.append(ShotEffect(type="light_sweep", at=min(0.15, length * 0.2), duration=min(length, 1.0), strength=0.5))
            sweeps_used += 1
        if p in ("hero", "payoff") and style.glow > 0:
            fx.append(ShotEffect(type="glow", at=0.0, duration=length, strength=style.glow))
        if p in ("hook", "payoff") and leaks_used < style.light_leaks:
            fx.append(ShotEffect(type="light_leak", at=max(length - 0.45, 0.0), duration=min(0.5, length), strength=0.4))
            leaks_used += 1
        if style.dust and p in ("detail", "macro"):
            fx.append(ShotEffect(type="dust", at=0.0, duration=length, strength=0.35))
        if p in ("hero", "detail", "macro", "payoff") and sparkles_used < style.sparkle_max and u.highlights:
            times = [min(0.08, length * 0.2)]
            hit = [t for t, _ in beats.accents if slot.start + 0.25 <= t <= slot.end - 0.15]
            if hit and length >= 0.7:
                times.append(round(max(hit, key=lambda t: dict(beats.accents)[t]) - slot.start, 3))
            for at in times:
                if sparkles_used >= style.sparkle_max:
                    break
                for h in sorted(u.highlights, key=lambda h: -h.strength):
                    key = (img_i, int(h.x * 100) * 1000 + int(h.y * 100))
                    if idx - last_sparkle.get(key, -99) < 3 or not _visible(u, mid, h) or not u.subject.contains(h.x, h.y):
                        continue
                    last_sparkle[key] = idx
                    fx.append(ShotEffect(type="sparkle", at=at, duration=0.32, strength=min(0.55 + h.strength * 0.45, 1.0), x=h.x, y=h.y, on_beat=True))
                    sparkles_used += 1
                    break
        if style.flash_on_drops and any(abs(d - slot.start) <= 0.12 for d in beats.drops):
            fx.append(ShotEffect(type="flash", at=0.0, duration=0.12, strength=0.7, on_beat=True))
        shot.effects = fx
        shots.append(shot)

    _limit_effects(shots, duration)
    _assign_transitions(shots, beats, style, rng, loop, transitions)

    # ---- loop: the last frame is the first frame
    if loop and shots:
        first, last = shots[0], shots[-1]
        if first.image_index != last.image_index:
            last.image_index = first.image_index
        first.camera = first.camera.model_copy(update={"start": hero_view if first.image_index == primary else first.camera.start})
        last.camera = last.camera.model_copy(update={"end": first.camera.start})
        shots[0].transition_in = ShotTransition(type="cut", duration=0.0)
        notes.append("Loop: the last frame returns to the first, so the Reel plays round seamlessly.")

    texts = _plan_texts(shots, images, hook, tagline, cta, loop, duration, text_animations or {})
    concept = _concept(shots, images, style, hook, cta, loop)
    plan = ProductReelPlan(
        style=style.id, duration=round(duration, 3), fps=fps, bpm=round(beats.bpm, 1), audio_start=audio_start, concept=concept,
        images=[im.media_id for im in images], shots=shots, texts=texts, loop=loop, warnings=warnings, notes=notes,
    )  # fmt: skip
    plan.quality = check_plan(plan, images, beats, phases)
    return plan


MAX_EFFECTS_PER_SECOND = 1.2  # "never overload the video"


def _limit_effects(shots: list[Shot], duration: float) -> None:
    """Drop the least important effects until the reel is no busier than the cap (a short Reel gets fewer)."""
    allowed = max(int(MAX_EFFECTS_PER_SECOND * duration), 3)
    rank = {"dust": 0, "light_leak": 1, "flash": 2, "sparkle": 3, "light_sweep": 4}  # lowest goes first; glow is not counted (it is a constant soft bloom)

    def counted() -> list[tuple[Shot, ShotEffect]]:
        return [(s, e) for s in shots for e in s.effects if e.type != "glow"]

    while len(counted()) > allowed:
        s, e = min(counted(), key=lambda se: (rank.get(se[1].type, 9), se[1].strength, -se[0].index))
        s.effects.remove(e)


def _assign_transitions(shots: list[Shot], beats: _Beats, style: ProductStyle, rng: random.Random, loop: bool,
                        wanted: dict[str, str] | None = None) -> None:  # fmt: skip
    """``wanted``: an (already validated) AI choice of the transition INTO each story part: used at the first shot of that
    part; cuts inside a part keep the built-in alternation. The safety rules (never twice in a row, fits both shots,
    match cuts only on the same photo) still apply."""
    prev: str = ""
    used: list[str] = []
    for i, s in enumerate(shots):
        if i == 0:
            s.transition_in = ShotTransition(type="cut" if loop else "fade_from_black", duration=0.0 if loop else TRANSITION_SECONDS["fade_from_black"])
            prev = s.transition_in.type
            used.append(prev)
            continue
        before = shots[i - 1]
        kind: str = TRANSITION_TABLE.get((before.purpose, s.purpose), "")
        ai_kind = (wanted or {}).get(s.purpose) if before.purpose != s.purpose else None
        if ai_kind in PRODUCT_TRANSITIONS:
            kind = ai_kind
        if not kind:  # two shots of the same kind: alternate, so the cut does not feel repeated
            alt = [a for a in style.alt_transitions if a != prev] or list(style.alt_transitions)
            kind = alt[(i + rng.randrange(len(alt))) % len(alt)]
            if kind in ("whip_left", "whip_right"):
                kind = "whip_left" if (i % 2 == 0) else "whip_right"
        if kind in ("whip_left", "whip_right") and not style.whip and kind != ai_kind:
            kind = "match"
        if kind == "flash" and not style.flash_on_drops and style.id == "clean_product" and kind != ai_kind:
            kind = "zoom"
        if kind == prev and kind not in ("cut", "match"):
            alt = [a for a in style.alt_transitions if a != prev]
            kind = alt[0] if alt else "cut"
        if kind == "match" and before.image_index == s.image_index:
            # a match cut continues the movement: the new shot starts where the last one ended
            c = before.camera.end
            s.camera = s.camera.model_copy(update={"start": View(cx=c.cx, cy=c.cy, hh=round(s.camera.start.hh, 4), roll=0.0)})
        elif kind == "match":
            kind = "cut"
        dur = TRANSITION_SECONDS.get(kind, 0.0)
        dur = round(min(dur, 0.45 * before.length, 0.45 * s.length), 3)
        if dur < 0.06 and kind not in ("cut", "match"):
            kind, dur = "cut", 0.0
        s.transition_in = ShotTransition(type=kind, duration=dur)  # type: ignore[arg-type]
        prev = kind
        used.append(kind)


def _plan_texts(shots: list[Shot], images: list[ImageUnderstanding], hook: str, tagline: str, cta: str, loop: bool, duration: float,
                animations: dict[str, str] | None = None) -> list[TextLayer]:  # fmt: skip
    """Text is its own layer: minimal, timed to a shot, and placed where it covers the product least."""
    out: list[TextLayer] = []

    def shot_of(purpose: str) -> Shot | None:
        return next((s for s in shots if s.purpose == purpose), None)

    def place(s: Shot, text: str, size: float) -> float:
        u = images[s.image_index]
        v = View(cx=s.camera.end.cx, cy=s.camera.end.cy, hh=s.camera.end.hh)
        return _text_y(u, v, text, size)

    hook, tagline, cta = hook.strip(), tagline.strip(), cta.strip()
    if hook:
        s = shot_of("reveal") or shots[0]
        out.append(TextLayer(id="t1", text=hook, start=s.start, end=min(s.end + 0.5, duration), y=place(s, hook, 0.07), size=0.07, animation_in=(animations or {}).get("hook", "mask_reveal"), role="hook"))
    if tagline:
        s = shot_of("payoff") or shots[-1]
        out.append(TextLayer(id="t2", text=tagline, start=s.start, end=min(s.end, duration), y=place(s, tagline, 0.055), size=0.055, animation_in=(animations or {}).get("tagline", "slide_up"), role="tagline"))
    if cta:
        s = shot_of("cta") or shots[-1]
        end = duration - (0.4 if loop else 0.05)
        out.append(TextLayer(id="t3", text=cta, start=s.start + 0.1, end=end, y=place(s, cta, 0.06), size=0.06, animation_in=(animations or {}).get("cta", "blur_sharp"), role="cta"))
    return [t for t in out if t.end - t.start >= 0.3]


def _concept(shots: list[Shot], images: list[ImageUnderstanding], style: ProductStyle, hook: str, cta: str, loop: bool) -> dict[str, str]:
    n_macro = sum(s.purpose in ("detail", "macro") for s in shots)
    return {
        "hook": "Opens on the finest detail, revealed out of darkness by a sweep of light." if not loop else "Opens on the whole piece and moves straight in to its finest detail.",
        "story": f"{len(shots)} micro-shots: curiosity (part of the product), reveal, hero, {n_macro} detail/macro shots, then a pull-back payoff. Style: {style.name}.",
        "ending": ("A calm final frame with the call to action" + (", returning to the first frame so it loops." if loop else ".")) if cta else ("A calm final frame" + (", returning to the first frame so it loops." if loop else ".")),
    }  # fmt: skip


# ------------------------------------------------------------------ quality check
def check_plan(plan: ProductReelPlan, images: list[ImageUnderstanding], beats: _Beats | None = None, phases: list | None = None) -> list[QualityCheck]:
    """The plan is judged against the brief's own rules before anything is rendered."""
    shots = plan.shots
    out: list[QualityCheck] = []

    def add(name: str, ok: bool, detail: str = "") -> None:
        out.append(QualityCheck(name=name, ok=ok, detail=detail))

    gaps = [round(b.start - a.end, 3) for a, b in zip(shots, shots[1:])]
    add("Timeline is continuous", abs(shots[0].start) < 1e-6 and abs(shots[-1].end - plan.duration) < 0.01 and all(abs(g) < 0.005 for g in gaps),
        f"{len(shots)} shots covering {plan.duration:g}s")  # fmt: skip
    long_shots = [s.index + 1 for s in shots if s.length > (MAX_ENDING if s.purpose == "cta" else MAX_SHOT) + 0.01 or s.length < MIN_SHOT - 0.01]
    add("Every shot is a micro-moment (0.2-1.5 s; the ending up to 2.2 s)", not long_shots, f"shots out of range: {long_shots}" if long_shots else "")
    story = [p for p, _, _ in (phases or PHASES)]
    add("Every part of the story is present", {s.purpose for s in shots} >= set(story), " > ".join(story))
    def near(x: View, y: View) -> bool:
        return abs(x.hh - y.hh) / max(x.hh, 1e-6) < 0.06 and abs(x.cx - y.cx) < 0.03 and abs(x.cy - y.cy) < 0.03

    repeats = [
        s.index + 1 for a, s in zip(shots, shots[1:])
        if a.framing == s.framing and a.image_index == s.image_index and s.transition_in.type != "match"  # a match cut continues the move on purpose
        and near(a.camera.start, s.camera.start) and near(a.camera.end, s.camera.end)
    ]  # fmt: skip
    add("No framing repeated back to back", not repeats, f"repeated at shots {repeats}" if repeats else "")
    kinds = {s.transition_in.type for s in shots[1:]}
    need = min(3, max(len(shots) // 3, 1))
    add("Transitions are varied", len(kinds) >= need, f"{len(kinds)} kinds: {', '.join(sorted(kinds))}")
    same = [s.index + 1 for a, s in zip(shots[1:], shots[2:]) if a.transition_in.type == s.transition_in.type and a.transition_in.type not in ("cut", "match")]
    add("No transition twice in a row", not same, f"repeated before shots {same}" if same else "")
    n_fx = sum(1 for s in shots for e in s.effects if e.type != "glow")
    add("Effects are restrained (never overloaded)", n_fx / max(plan.duration, 1) <= 1.4, f"{n_fx} effects in {plan.duration:g}s")
    bad_sparkles = 0
    for s in shots:
        u = images[s.image_index]
        for e in s.effects:
            if e.type == "sparkle" and not (e.x is not None and e.y is not None and u.subject.contains(e.x, e.y) and any(abs(e.x - h.x) < 1e-3 and abs(e.y - h.y) < 1e-3 for h in u.highlights)):
                bad_sparkles += 1
    add("Sparkles sit only on real reflective highlights of the product", bad_sparkles == 0, f"{bad_sparkles} misplaced" if bad_sparkles else "")
    # the product is never distorted: every view is a plain 9:16 window and every move is a uniform zoom/shift
    add("Product protected (only crop, scale and light: nothing is regenerated or stretched)", True, "views are 9:16 windows over the original photo")
    soft = []
    for s in shots:
        u = images[s.image_index]
        for v in (s.camera.start, s.camera.end):
            if REF_HEIGHT / (v.hh * u.height) > MAX_UPSCALE + 0.05:
                soft.append(s.index + 1)
    add("Close-ups stay sharp (no more than 2.6x enlargement)", not soft, f"soft at shots {sorted(set(soft))}" if soft else "")
    if beats is not None and not beats.synthetic:
        on = sum(1 for s in shots if s.beat_time is not None)
        add("Shots start on the beat", on / len(shots) >= 0.7, f"{on} of {len(shots)}")
    over = []
    for t in plan.texts:
        s = next((x for x in shots if x.start <= t.start + 0.01 < x.end), shots[-1])
        u = images[s.image_index]
        v = View(cx=s.camera.end.cx, cy=s.camera.end.cy, hh=s.camera.end.hh)
        if _text_box_overlap(u, v, t.y, t.text, t.size) > 0.25:
            over.append(t.id)
    add("Text stays off the product and in the safe area", not over and all(SAFE_TOP <= t.y <= SAFE_BOTTOM for t in plan.texts), f"covers the product: {over}" if over else "")
    add("Text is minimal", len(plan.texts) <= 3)
    if plan.loop:
        f, l = shots[0].camera.start, shots[-1].camera.end
        add("Loop closes (last frame matches the first)", abs(f.cx - l.cx) < 1e-3 and abs(f.cy - l.cy) < 1e-3 and abs(f.hh - l.hh) < 1e-3, "")
    return out


def describe_shot(s: Shot) -> str:
    """One readable line per shot: the director's shot list."""
    fx = ", ".join(e.type.replace("_", " ") for e in s.effects) or "no effect"
    return (f"{s.start:5.2f}-{s.end:5.2f}  {s.purpose.upper():9s} {s.framing.replace('_', ' '):17s} {s.camera.type.replace('_', ' '):9s} "
            f"in: {s.transition_in.type:15s} fx: {fx}")  # fmt: skip


# ------------------------------------------------------------------ AI direction -> validated inputs of plan_reel
@dataclass
class Direction:
    phases: list
    cameras: dict[str, str]
    transitions: dict[str, str]
    style: ProductStyle
    hook: str
    tagline: str
    cta: str
    animations: dict[str, str]
    notes: list[str]


def apply_direction(d, style: ProductStyle, duration: float, images: list[ImageUnderstanding], *, hook: str, tagline: str, cta: str) -> Direction:
    """Validate an AI ``ProductDirection``: known purposes only, starts with a hook, ends on the CTA when there is one,
    every share 4-35% (re-normalised), cameras and animations from the allowed lists, effect amounts inside the style's
    caps, the user's own texts always win, AI texts trimmed. Anything invalid falls back to the built-in choice."""
    from dataclasses import replace as dc_replace

    from app.product.textass import clean_text

    notes: list[str] = []
    table = {p: (lo_hi) for p, _, lo_hi in PHASES}
    seen: list[tuple[str, float]] = []
    for ph in d.phases[:12]:
        if ph.purpose in table and ph.share == ph.share:
            seen.append((ph.purpose, min(max(float(ph.share), 0.04), 0.35)))
        else:
            notes.append(f"Unknown story phase '{str(ph.purpose)[:20]}' was ignored.")
    if not seen or seen[0][0] != "hook":
        seen.insert(0, ("hook", 0.08))
    final_cta = (cta or d.cta).strip()
    if final_cta and seen[-1][0] != "cta":
        seen = [x for x in seen if x[0] != "cta"] + [("cta", 0.10)]
    purposes = {p for p, _ in seen}
    if not purposes & {"reveal", "hero", "payoff"}:  # the product must be seen whole at least once
        seen.insert(1, ("hero", 0.2))
        notes.append("A hero shot of the whole product was added.")
    if not purposes & {"detail", "macro"} and any(u.regions for u in images):  # and close up, when the photo has detail
        seen.insert(len(seen) - (1 if seen[-1][0] == "cta" else 0), ("detail", 0.15))
        notes.append("A detail close-up was added.")
    if len(seen) < 3:
        notes.append("The AI story was too short; the built-in structure was used.")
        seen = [(p, sh) for p, sh, _ in PHASES]
    total = sum(sh for _, sh in seen)
    phases = [(p, round(sh / total, 4), table[p]) for p, sh in seen]
    cams = {ph.purpose: ph.camera for ph in d.phases if ph.purpose in table and ph.camera in (
        "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "drift", "hold")}  # fmt: skip

    k_sparkle = {"more": 1.5, "less": 0.5, "none": 0.0}.get(d.sparkle, 1.0)
    k_light = {"more": 1, "less": -1}.get(d.light, 0)
    new_style = dc_replace(style, sparkle_max=int(min(round(style.sparkle_max * k_sparkle), 8)),
                           light_sweeps=int(min(max(style.light_sweeps + k_light, 0), 3)))  # fmt: skip

    def short(text: str, words: int) -> str:
        return " ".join(clean_text(text, 60).split()[:words])

    anims = {"hook": d.hook_animation, "tagline": d.tagline_animation, "cta": d.cta_animation}
    anims = {k: v for k, v in anims.items() if v in ("fade", "slide_up", "scale", "mask_reveal", "type_on", "blur_sharp")}
    trans = {ph.purpose: ph.transition for ph in d.phases if ph.purpose in table and ph.transition in PRODUCT_TRANSITIONS}
    bad = [ph.transition for ph in d.phases if ph.transition and ph.transition not in PRODUCT_TRANSITIONS]
    if bad:
        notes.append(f"Unsupported transition(s) {', '.join(sorted(set(bad))[:4])} replaced by the built-in choice.")
    return Direction(
        phases=phases, cameras=cams, transitions=trans, style=new_style, hook=hook.strip() or short(d.hook, 6), tagline=tagline.strip() or short(d.tagline, 6),
        cta=cta.strip() or short(d.cta, 5), animations=anims, notes=notes,
    )  # fmt: skip
