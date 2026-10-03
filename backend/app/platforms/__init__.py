"""Social platforms a Reel can be made for. Each one tunes the edit to how that platform ranks videos, checks the result
against its recommendation rules and writes post copy the way it is searched.

``none`` = a general vertical video (the editor's own defaults). Adding a platform = one module like ``instagram.py``.
"""

from __future__ import annotations

PLATFORMS = {
    "none": "General (no platform)",
    "instagram": "Instagram Reels",
}
