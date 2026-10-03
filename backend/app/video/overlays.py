"""Text overlays for video Reels (hook, benefit, product name, emotional line, CTA).

Deterministic layout rules keep text readable and out of the way:
* inside the Reels **safe area** (top 14% and bottom 22% are covered by the app UI; the text box is at most 80% wide),
* above the captions when captions are on,
* at most ``OVERLAY_MAX_WORDS`` words, wrapped onto up to 3 balanced lines and auto-sized so each line fits the width,
* on a soft dark box (readable over busy footage), in a font that has the text's script (English, Hindi, Marathi ...),
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
WRAP_AT = 22  # characters: a longer text is set on two balanced lines
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


_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿⬀-⯿️‍\U000E0020-\U000E007F]")


def strip_emoji(text: str) -> str:
    """Emoji out: the video text engine draws them as grey outlines, not in colour. They belong in the post caption."""
    return re.sub(r"\s+", " ", _EMOJI.sub("", text)).strip()


def tidy_text(text: str) -> str:
    """Clean, no emoji, at most OVERLAY_MAX_WORDS words and OVERLAY_MAX_CHARS characters (cut at a word boundary)."""
    t = clean_text(strip_emoji(text), 200)
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


def wrap_lines(text: str, max_line: int = WRAP_AT, max_lines: int = 3) -> list[str]:
    """One line when it fits, else 2-3 lines of about equal length, split between words. A long text on one line would be
    shrunk until it fits the width; on several lines it stays big enough to read on a phone."""
    from itertools import combinations

    words = text.split()
    n = min(max(-(-len(text) // max_line), 1), max_lines, len(words))
    if n <= 1:
        return [text]
    best: list[str] = [text]
    for cuts in combinations(range(1, len(words)), n - 1):  # at most 12 words: a handful of combinations
        edges = (0, *cuts, len(words))
        lines = [" ".join(words[a:b]) for a, b in zip(edges, edges[1:])]
        if best == [text] or max(map(len, lines)) < max(map(len, best)):
            best = lines
    return best


def to_layers(overlays: list[TextOverlay], has_captions: bool, w: int, h: int) -> list[TextLayer]:
    layers = []
    for o in overlays:
        y = Y_BOTTOM_WITH_CAPTIONS if (o.position == "bottom" and has_captions) else Y[o.position]
        lines = wrap_lines(o.text)
        size = fit_size(max(lines, key=len), SIZES[o.size], w, h)
        half = size * (0.75 + 0.6 * (len(lines) - 1))  # half the text block's height (see text_box)
        y = min(max(y, SAFE_TOP + half), (Y_BOTTOM_WITH_CAPTIONS + 0.1 if has_captions else 1 - SAFE_BOTTOM) - half)  # more lines: keep the block inside
        role = "cta" if o.role == "cta" else ("hook" if o.role == "hook" else "tagline")
        layers.append(TextLayer(id=o.id, text="\n".join(lines), start=o.start, end=o.end, x=0.5, y=y, size=size, animation_in=o.animation,
                                animation_out="fade", role=role))  # fmt: skip
    return layers


def text_box(layer: TextLayer, w: int, h: int) -> tuple[float, float, float, float]:
    """(left, top, right, bottom) as fractions of the frame: the area the text covers (for QC)."""
    lines = layer.text.split("\n")
    half_w = max(len(x) for x in lines) * CHAR_WIDTH * layer.size * h / w / 2
    half_h = layer.size * (0.75 + 0.6 * (len(lines) - 1))
    return layer.x - half_w, layer.y - half_h, layer.x + half_w, layer.y + half_h


def write_overlays_ass(timeline: Timeline, path: Path, w: int, h: int) -> Path | None:
    overlays, _ = normalize(timeline.overlays, timeline.duration)
    if not overlays:
        return None
    return write_text_ass(to_layers(overlays, bool(timeline.captions), w, h), look_for(timeline), path, w, h, boxed=True)  # type: ignore[arg-type]
