"""Text layers as animated subtitles (ASS), burned in by FFmpeg's subtitle engine (libass).

Text is an independent layer with its own timing and animation. libass also shapes complex scripts (Hindi/Marathi conjuncts),
which a simple text renderer would get wrong. Everything the user typed is stripped of markup characters before it is placed
in the file, so text can never inject styling tags.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.product.models import TextLayer
from app.product.styles import ProductStyle

_FONT_OK = re.compile(r"[^A-Za-z0-9 \-_.]")
INDIC = re.compile("[" + chr(0x0900) + "-" + chr(0x0DFF) + "]")  # Devanagari ... Sinhala (U+0900-U+0DFF): Indic scripts


def clean_text(text: str, limit: int = 80) -> str:
    """Remove everything libass would read as a tag or a line break; keep letters of every script."""
    t = re.sub(r"[\x00-\x1f\x7f{}\\]", " ", text)
    return re.sub(r"\s+", " ", t).strip()[:limit]


def _ts(sec: float) -> str:
    sec = max(sec, 0.0)
    cs = int(round(sec * 100))
    return f"{cs // 360000}:{cs // 6000 % 60:02d}:{cs // 100 % 60:02d}.{cs % 100:02d}"


def _bgr(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", h):
        h = "FFFFFF"
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}&"  # ASS colours are BGR


def _box(text: str, size_px: float) -> float:
    return max(len(text), 3) * size_px * 0.62  # a generous width estimate, only used to place a reveal mask


def layer_events(t: TextLayer, w: int, h: int) -> list[tuple[float, float, str]]:
    """(start, end, text-with-tags) for one layer. Most animations are one event; type-on is a few."""
    text = clean_text(t.text)
    if not text:
        return []
    x, y = t.x * w, t.y * h
    size_px = t.size * h
    fade_out = 250 if t.animation_out == "fade" else 0
    dur = t.end - t.start
    pos = f"\\an5\\pos({x:.0f},{y:.0f})\\fs{size_px:.0f}"
    out_tag = f"\\fad(0,{fade_out})" if fade_out else ""
    a = t.animation_in
    if a == "fade":
        return [(t.start, t.end, "{" + pos + f"\\fad(350,{fade_out})" + "}" + text)]
    if a == "slide_up":
        return [(t.start, t.end, "{" + f"\\an5\\fs{size_px:.0f}\\move({x:.0f},{y + 0.03 * h:.0f},{x:.0f},{y:.0f},0,380)\\fad(300,{fade_out})" + "}" + text)]
    if a == "scale":
        return [(t.start, t.end, "{" + pos + "\\fscx72\\fscy72\\t(0,320,\\fscx100\\fscy100)" + f"\\fad(200,{fade_out})" + "}" + text)]
    if a == "blur_sharp":
        return [(t.start, t.end, "{" + pos + "\\blur14\\alpha&HFF&\\t(0,520,\\blur0\\alpha&H00&)" + out_tag + "}" + text)]
    if a == "mask_reveal":
        bw = _box(text, size_px) * 1.15
        x0, x1, y0, y1 = x - bw / 2, x + bw / 2, y - size_px, y + size_px
        clip = f"\\clip({x0:.0f},{y0:.0f},{x0:.0f},{y1:.0f})\\t(0,520,\\clip({x0:.0f},{y0:.0f},{x1:.0f},{y1:.0f}))"
        return [(t.start, t.end, "{" + pos + clip + out_tag + "}" + text)]
    # type_on: the whole line is laid out once (so it does not shift), with the not-yet-typed letters invisible
    n = len(text)
    steps = min(n, 24)
    total = min(0.7, max(dur * 0.4, 0.3))
    events: list[tuple[float, float, str]] = []
    for s in range(1, steps + 1):
        k = round(n * s / steps)
        t0 = t.start + total * (s - 1) / steps
        t1 = t.start + total * s / steps if s < steps else t.end
        events.append((t0, t1, "{" + pos + (out_tag if s == steps else "") + "}" + text[:k] + "{\\alpha&HFF&}" + text[k:]))
    return events


def write_text_ass(layers: list[TextLayer], style: ProductStyle, path: Path, w: int, h: int) -> Path | None:
    """Write the file, or return None when there is no text. Sizes are relative to the frame, so any resolution works."""
    events: list[tuple[float, float, str]] = []
    for layer in layers:
        events += layer_events(layer, w, h)
    if not events:
        return None
    font = _FONT_OK.sub("", style.font)[:40] or "Arial"
    # letter spacing makes libass place every glyph on its own: Indic vowel signs and conjuncts would fall apart
    spacing = "0" if any(INDIC.search(layer.text) for layer in layers) else "1.5"
    size_px = int(0.065 * h)
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {w}", f"PlayResY: {h}", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,{font},{size_px},{_bgr(style.text_color)},{_bgr(style.text_color)},{_bgr(style.text_outline)},&H64000000&,"
        f"{-1 if style.bold else 0},0,0,0,100,100,{spacing},0,1,{max(2, h // 640)},{max(1, h // 960)},5,20,20,20,1",
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for start, end, body in sorted(events, key=lambda e: e[0]):
        lines.append(f"Dialogue: 0,{_ts(start)},{_ts(end)},Default,,0,0,0,,{body}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path
