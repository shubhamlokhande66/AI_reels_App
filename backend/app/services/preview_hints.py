"""What the renderer will do to each shot, for the editor's live preview to show the same picture.

The browser preview cannot measure the clips; the renderer frames and corrects them from the clip analysis. These are
the renderer's own decisions (video/cutter.py: ``framing``, ``quality_filters``; the style's grade), computed with its
own functions so preview and export cannot drift apart:

- per shot: ``mode`` (fill = a 9:16 crop, fit = the whole picture over a blurred backdrop), the ``crop`` rectangle as
  fractions of the source frame, the brightness ``lift`` / ``gamma`` for a clip that is too dark or too bright, and
  ``stabilized`` (shaky clips are steadied with a slight zoom)
- the colour ``grade`` of the style when no look was chosen (contrast, saturation, brightness)
"""

from __future__ import annotations

import re
from typing import Any

from app.jobs import pipeline as pl
from app.models.timeline import Timeline
from app.storage import get_storage
from app.video.cutter import RenderConfig, SourceClip, framing


def _eq(filter_str: str | None) -> dict[str, float]:
    """contrast / saturation / brightness / gamma of an FFmpeg ``eq=`` filter (others are left to the renderer)."""
    out: dict[str, float] = {}
    for part in re.findall(r"eq=([^,\[]+)", filter_str or ""):
        for kv in part.split(":"):
            if "=" in kv:
                k, v = kv.split("=", 1)
                try:
                    out[k.strip()] = float(v)
                except ValueError:
                    pass
    return out


def _source(clip_id: str, analysis, key: str) -> SourceClip:
    windows = analysis.windows
    brightness = (sum(w.brightness * w.length for w in windows) / max(sum(w.length for w in windows), 1e-6)) if windows else 0.5
    return SourceClip(get_storage().local_path(key), analysis.metadata.width, analysis.metadata.height, clip_id,
                      tuple(analysis.content_rect) if analysis.content_rect else None, analysis.metadata.has_audio,  # type: ignore[arg-type]
                      shaky=analysis.shake_score > 0.35, brightness=brightness)  # fmt: skip


def hints(inp: pl.PipelineInput, timeline: Timeline) -> dict[str, Any]:
    from app.styles import get_style

    storage = get_storage()
    clips = pl.analyze_videos(inp, storage, lambda *_: None)
    keys = {v.id: v.key for v in inp.videos}
    cfg = RenderConfig()
    out: dict[str, Any] = {}
    for seg in timeline.segments:
        a = clips.get(seg.clip_id)
        if a is None:
            continue
        src = _source(seg.clip_id, a, keys[seg.clip_id])
        mode, crop, _ = framing(seg, src, cfg)
        w, h, x, y = (int(v) for v in crop.split("=", 1)[1].split(":"))
        sw, sh = max(src.width, 1), max(src.height, 1)
        lift = gamma = 0.0
        if src.brightness < 0.32:
            lift = min((0.32 - src.brightness) * 0.9, 0.18)
            gamma = 1 + lift * 1.5
        elif src.brightness > 0.8:
            gamma = max(1 - (src.brightness - 0.8) * 1.2, 0.8)
        out[seg.id] = {"mode": mode, "crop": {"x": round(x / sw, 4), "y": round(y / sh, 4), "w": round(w / sw, 4), "h": round(h / sh, 4)},
                       "lift": round(lift, 3), "gamma": round(gamma, 3), "stabilized": bool(cfg.stabilize and src.shaky)}  # fmt: skip
    try:
        style = get_style(timeline.style)
        grade = _eq(style.grade_filter) if not timeline.color_grade else {}
    except Exception:  # noqa: BLE001 - an unknown style has no grade of its own
        grade = {}
    return {"segments": out, "grade": grade}
