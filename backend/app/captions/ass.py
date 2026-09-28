"""Render caption cues to an ASS subtitle file (burned in by FFmpeg's ``ass`` filter).

Caption text goes into a *file*, never into a filter string, so transcript content cannot
inject FFmpeg filter syntax.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from pathlib import Path

from app.captions.cues import Cue

CAPTION_STYLES = ("minimal", "bold", "karaoke", "highlight", "luxury")


@dataclass(frozen=True)
class CaptionStyle:
    name: str
    font: str
    size: int
    primary: str  # &HAABBGGRR
    secondary: str
    outline_colour: str = "&H00000000"
    bold: int = 0
    outline: float = 3
    shadow: float = 1
    spacing: float = 0
    margin_v: int = 380  # keeps text above the Reels UI
    uppercase: bool = False
    mode: str = "static"  # static | karaoke | highlight
    highlight: str = "&H0000E5FF"  # active-word colour for `highlight` mode (warm yellow)
    fade_ms: int = 0


_STYLES: dict[str, CaptionStyle] = {
    "minimal": CaptionStyle("minimal", "Arial", 56, "&H00FFFFFF", "&H00FFFFFF", outline=3, shadow=0),
    "bold": CaptionStyle("bold", "Arial", 92, "&H00FFFFFF", "&H00FFFFFF", bold=1, outline=7, shadow=2,
                         uppercase=True, margin_v=420),  # fmt: skip
    "karaoke": CaptionStyle("karaoke", "Arial", 84, "&H0000E5FF", "&H00FFFFFF", bold=1, outline=6, shadow=2,
                            uppercase=True, mode="karaoke", margin_v=420),  # fmt: skip
    "highlight": CaptionStyle("highlight", "Arial", 84, "&H00FFFFFF", "&H00FFFFFF", bold=1, outline=6, shadow=2,
                              uppercase=True, mode="highlight", margin_v=420),  # fmt: skip
    "luxury": CaptionStyle("luxury", "Georgia", 54, "&H00B5D9E8", "&H00B5D9E8", outline=1, shadow=0,
                           spacing=7, uppercase=True, margin_v=440, fade_ms=350),  # fmt: skip
}


def get_caption_style(name: str) -> CaptionStyle:
    return _STYLES.get(name) or _STYLES["minimal"]


def _ts(t: float) -> str:
    t = max(t, 0.0)
    cs = int(round(t * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def escape_text(text: str) -> str:
    """Neutralise ASS override syntax and line breaks in transcript text."""
    return (
        text.replace("\\", "／").replace("{", "(").replace("}", ")").replace("\r", " ").replace("\n", " ")
    )


def _word(w_text: str, st: CaptionStyle) -> str:
    t = escape_text(w_text)
    return t.upper() if st.uppercase else t


def _ass_colour(hex_rgb: str) -> str:
    """#RRGGBB -> ASS &H00BBGGRR."""
    h = hex_rgb.lstrip("#")
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def build_ass(
    cues: list[Cue], style_name: str, width: int = 1080, height: int = 1920, font: str | None = None,
    color: str | None = None,
) -> str:
    st = get_caption_style(style_name)
    if font:  # brand overrides (validated by the caller)
        safe = re.sub(r"[^A-Za-z0-9 \-_.]", "", font).strip()[:60]  # whitelist: a font name, never subtitle syntax
        st = replace(st, font=safe) if safe else st
    if color:
        st = replace(st, primary=_ass_colour(color), secondary=_ass_colour(color) if st.mode != "karaoke" else st.secondary,
                     highlight=_ass_colour(color) if st.mode == "highlight" else st.highlight)  # fmt: skip
    side = int(width * 0.08)
    header = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
        "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, "
        "MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Default,{st.font},{st.size},{st.primary},{st.secondary},{st.outline_colour},&H64000000,"
        f"{st.bold},0,0,0,100,100,{st.spacing:g},0,1,{st.outline:g},{st.shadow:g},2,{side},{side},{st.margin_v},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    lines: list[str] = []
    fade = f"{{\\fad({st.fade_ms},{st.fade_ms})}}" if st.fade_ms else ""

    def event(start: float, end: float, text: str) -> str:
        return f"Dialogue: 0,{_ts(start)},{_ts(end)},Default,,0,0,0,,{text}"

    for cue in cues:
        if st.mode == "karaoke":
            # \kf sweeps the fill colour across each word over its duration (centiseconds)
            parts = []
            for i, w in enumerate(cue.words):
                nxt = cue.words[i + 1].start if i + 1 < len(cue.words) else cue.end
                parts.append(f"{{\\kf{max(int(round((nxt - w.start) * 100)), 1)}}}{_word(w.text, st)}")
            lines.append(event(cue.start, cue.end, fade + " ".join(parts)))
        elif st.mode == "highlight":
            for i, w in enumerate(cue.words):
                end = cue.words[i + 1].start if i + 1 < len(cue.words) else cue.end
                start = cue.start if i == 0 else w.start
                parts = [
                    (f"{{\\c{st.highlight}}}{_word(x.text, st)}{{\\c{st.primary}}}" if j == i else _word(x.text, st))
                    for j, x in enumerate(cue.words)
                ]
                lines.append(event(start, end, " ".join(parts)))
        else:
            lines.append(event(cue.start, cue.end, fade + " ".join(_word(w.text, st) for w in cue.words)))
    return header + "\n".join(lines) + "\n"


def write_ass(
    cues: list[Cue], style_name: str, path: Path, width: int = 1080, height: int = 1920, font: str | None = None,
    color: str | None = None,
) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build_ass(cues, style_name, width, height, font, color), encoding="utf-8")
    return path


def ass_filter(path: Path) -> str:
    """The FFmpeg filter that burns the subtitle file in. Path is escaped for filtergraph syntax."""
    p = str(path.resolve()).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    return f"ass=filename='{p}'"
