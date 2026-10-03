"""Fonts that can actually draw the text's script.

libass shapes complex scripts (Devanagari conjuncts and vowel signs, Arabic joining ...) only with a font that has the script's
glyphs and shaping tables; Arial and Georgia have none for Indic scripts, and the glyph fallback breaks words into loose
letters. Letter spacing also turns shaping off. So text in such a script gets a font made for it and no extra spacing.
"""

from __future__ import annotations

import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

# (first, last code point, script)
_RANGES = [
    (0x0900, 0x097F, "devanagari"), (0x0980, 0x09FF, "bengali"), (0x0A00, 0x0A7F, "gurmukhi"), (0x0A80, 0x0AFF, "gujarati"),
    (0x0B00, 0x0B7F, "oriya"), (0x0B80, 0x0BFF, "tamil"), (0x0C00, 0x0C7F, "telugu"), (0x0C80, 0x0CFF, "kannada"),
    (0x0D00, 0x0D7F, "malayalam"), (0x0600, 0x06FF, "arabic"), (0x0E00, 0x0E7F, "thai"),
]  # fmt: skip
_INDIC = {"devanagari", "bengali", "gurmukhi", "gujarati", "oriya", "tamil", "telugu", "kannada", "malayalam"}

# Font family candidates per script, best first: Windows 10+ ships Nirmala UI for every Indic script; Linux images use Noto.
_CANDIDATES = {
    **{s: ["Nirmala UI", f"Noto Sans {s.capitalize()}"] for s in _INDIC},
    "devanagari": ["Nirmala UI", "Noto Sans Devanagari", "Mangal"],
    "arabic": ["Segoe UI", "Noto Naskh Arabic", "Arial"],
    "thai": ["Leelawadee UI", "Noto Sans Thai"],
}
# Windows font files of the candidates (DirectWrite/fontconfig find them by family name; this only checks they exist)
_WIN_FILES = {"Nirmala UI": ("Nirmala.ttf", "Nirmala.ttc"), "Mangal": ("mangal.ttf",), "Segoe UI": ("segoeui.ttf",),
              "Leelawadee UI": ("LeelawUI.ttf", "LeelaUIb.ttf")}  # fmt: skip


def script_of(text: str) -> str | None:
    """The first complex script found in the text (None = Latin and other simple scripts)."""
    for ch in text or "":
        cp = ord(ch)
        if cp < 0x0600:
            continue
        for lo, hi, name in _RANGES:
            if lo <= cp <= hi:
                return name
    return None


def needs_shaping(text: str) -> bool:
    return script_of(text) is not None


@lru_cache(maxsize=1)
def _families() -> frozenset[str]:
    """Installed font families (lower case). Empty when it cannot be determined."""
    if sys.platform == "win32":
        dirs = [Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts", Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft/Windows/Fonts"]
        files = {p.name.lower() for d in dirs if d.is_dir() for p in d.iterdir()}
        return frozenset(fam.lower() for fam, names in _WIN_FILES.items() if any(n.lower() in files for n in names))
    try:
        out = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return frozenset()
    return frozenset(f.strip().lower() for line in out.splitlines() for f in line.split(","))


def font_for(text: str, preferred: str) -> str:
    """``preferred`` for simple scripts; for a complex script, the first installed font made for it."""
    script = script_of(text)
    if script is None:
        return preferred
    cands = _CANDIDATES.get(script, [])
    have = _families()
    for c in cands:
        if c.lower() in have:
            return c
    return cands[0] if cands else preferred
