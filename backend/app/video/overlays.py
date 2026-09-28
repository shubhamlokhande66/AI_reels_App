"""Text overlays for video Reels (hook, benefit, product name, emotional line, CTA).

Deterministic layout rules keep text readable and out of the way:
* inside the Reels **safe area** (top 14% and bottom 22% are covered by the app UI; the text box is at most 80% wide),
* above the captions when captions are on,
* at most ``OVERLAY_MAX_WORDS`` words, auto-sized so a line always fits the width,
* shown for at least ``MIN_SECONDS``, never two at the same time (no overloaded screens),
* brand typography when the Reel has a brand font/colour.
Rendering reuses the product Reels' animated text engine (libass), so every script shapes correctly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from app.models.timeline import OVERLAY_MAX_CHARS, OVERLAY_MAX_WORDS, TextOverlay, Timeline
from app.product.models import TextLayer
from app.product.textass import clean_text, write_text_ass

SAFE_TOP = 0.14
SAFE_BOTTOM = 0.22
MAX_WIDTH = 0.80
MIN_SECONDS = 0.8
CHAR_WIDTH = 0.55  # average glyph width as a share of the font size (generous, for bold fonts)
SIZES = {"small": 0.034, "medium": 0.044, "large": 0.056}  # font height as a share of the frame height
Y = {"top": 0.21, "center": 0.44, "bottom": 0.70}
Y_BOTTOM_WITH_CAPTIONS = 0.60  # captions sit near 0.78; keep a clear gap


@dataclass(frozen=True)
class OverlayLook:
    font: str = "Arial"
    text_color: str = "#FFFFFF"
    text_outline: str = "#000000"
    bold: bool = True


def look_for(timeline: Timeline) -> OverlayLook:
    luxury = timeline.style in ("luxury",) or timeline.color_grade == "luxury" or timeline.caption_style == "luxury"
    base = OverlayLook("Georgia", "#F6E7C8", "#000000", False) if luxury else OverlayLook()
    color = timeline.caption_color if timeline.caption_color and re.fullmatch(r"#[0-9A-Fa-f]{6}", timeline.caption_color) else base.text_color
    return OverlayLook(timeline.caption_font or base.font, color, base.text_outline, base.bold)


def tidy_text(text: str) -> str:
    """Clean, at most OVERLAY_MAX_WORDS words and OVERLAY_MAX_CHARS characters (cut at a word boundary)."""
    t = clean_text(text, 200)
    words = t.split()[:OVERLAY_MAX_WORDS]
    out = ""
    for w in words:
        nxt = f"{out} {w}".strip()
        if len(nxt) > OVERLAY_MAX_CHARS:
            break
        out = nxt
    return out


def fit_size(text: str, requested: float, w: int, h: int) -> float:
    """Shrink the font until the single line fits MAX_WIDTH of the frame."""
    max_px = MAX_WIDTH * w / (max(len(text), 1) * CHAR_WIDTH)
    return round(min(requested, max_px / h), 4)


def normalize(overlays: list[TextOverlay], duration: float) -> tuple[list[TextOverlay], list[str]]:
    """Clamp into the Reel, enforce minimum time and no overlap. Returns (overlays, notes about what changed)."""
    notes: list[str] = []
    out: list[TextOverlay] = []
    for o in sorted(overlays, key=lambda x: x.start):
        text = tidy_text(o.text)
        if not text:
            continue
        if text != clean_text(o.text, 200):
            notes.append(f'Text "{o.text[:30]}" was shortened to "{text}" (max {OVERLAY_MAX_WORDS} words on screen).')
        start = min(max(o.start, 0.0), max(duration - MIN_SECONDS, 0.0))
        end = min(max(o.end, start + MIN_SECONDS), duration)
        if out and start < out[-1].end:  # never two texts at once
            start = out[-1].end
            if end - start < MIN_SECONDS:
                notes.append(f'Text "{text}" was dropped: it would overlap another text.')
                continue
        if end - start < MIN_SECONDS - 1e-6:
            notes.append(f'Text "{text}" was dropped: too little time left to read it.')
            continue
        out.append(o.model_copy(update={"text": text, "start": round(start, 3), "end": round(end, 3)}))
    return out, notes


def to_layers(overlays: list[TextOverlay], has_captions: bool, w: int, h: int) -> list[TextLayer]:
    layers = []
    for o in overlays:
        y = Y_BOTTOM_WITH_CAPTIONS if (o.position == "bottom" and has_captions) else Y[o.position]
        size = fit_size(o.text, SIZES[o.size], w, h)
        role = "cta" if o.role == "cta" else ("hook" if o.role == "hook" else "tagline")
        layers.append(TextLayer(id=o.id, text=o.text, start=o.start, end=o.end, x=0.5, y=y, size=size, animation_in=o.animation,
                                animation_out="fade", role=role))  # fmt: skip
    return layers


def text_box(layer: TextLayer, w: int, h: int) -> tuple[float, float, float, float]:
    """(left, top, right, bottom) as fractions of the frame: the area the text covers (for QC)."""
    half_w = len(layer.text) * CHAR_WIDTH * layer.size * h / w / 2
    return layer.x - half_w, layer.y - layer.size * 0.75, layer.x + half_w, layer.y + layer.size * 0.75


def write_overlays_ass(timeline: Timeline, path: Path, w: int, h: int) -> Path | None:
    overlays, _ = normalize(timeline.overlays, timeline.duration)
    if not overlays:
        return None
    return write_text_ass(to_layers(overlays, bool(timeline.captions), w, h), look_for(timeline), path, w, h)  # type: ignore[arg-type]
