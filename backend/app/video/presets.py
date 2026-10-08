"""Export presets: resolution, aspect, fps, bitrate. New platforms are one entry here."""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings
from app.core.errors import ValidationFailed
from app.video.cutter import RenderConfig


@dataclass(frozen=True)
class ExportPreset:
    id: str
    name: str
    width: int
    height: int
    fps: int = 30
    crf: int = 18
    max_bitrate: str = "12M"
    audio_bitrate: str = "192k"
    max_seconds: int | None = None  # platform limit, used for warnings

    @property
    def aspect_label(self) -> str:
        from math import gcd

        g = gcd(self.width, self.height)
        return f"{self.width // g}:{self.height // g}"


PRESETS: dict[str, ExportPreset] = {
    p.id: p
    for p in (
        ExportPreset("instagram_reel", "Instagram Reel", 1080, 1920, max_seconds=180),
        ExportPreset("youtube_short", "YouTube Short", 1080, 1920, max_seconds=180),
        ExportPreset("tiktok", "TikTok", 1080, 1920, max_seconds=600),
        ExportPreset("instagram_story", "Instagram Story", 1080, 1920, max_seconds=60),
        ExportPreset("instagram_post", "Instagram Post (4:5)", 1080, 1350, max_seconds=180),
        ExportPreset("square", "Square (1:1)", 1080, 1080, max_seconds=180),
        ExportPreset("youtube", "YouTube (16:9)", 1920, 1080, fps=30, max_bitrate="16M"),
    )
}
DEFAULT_PRESET = "instagram_reel"
PREVIEW_WIDTH = 360


def get_preset(preset_id: str | None) -> ExportPreset:
    if not preset_id or preset_id == "custom":
        s = get_settings()  # "custom" = the OUTPUT_WIDTH/HEIGHT/FPS from .env
        return ExportPreset("custom", "Custom", s.output_width, s.output_height, fps=s.output_fps)
    try:
        return PRESETS[preset_id]
    except KeyError:
        raise ValidationFailed(f"Unknown export preset '{preset_id}'.", code="UNKNOWN_PRESET",
                               details={"available": [*PRESETS, "custom"]}) from None  # fmt: skip


def validate_preset_id(preset_id: str) -> str:
    get_preset(preset_id)
    return preset_id


def config_for(preset_id: str | None, quality: str = "final", encoder: str = "libx264") -> RenderConfig:
    """Render settings for a preset. ``preview`` is small and fast for quick editing feedback."""
    p = get_preset(preset_id)
    if quality == "preview":
        w = PREVIEW_WIDTH
        h = max(round(w * p.height / p.width / 2) * 2, 2)
        return RenderConfig(
            width=w, height=h, fps=24, segment_crf=30, segment_preset="ultrafast", final_crf=30,
            final_preset="ultrafast", max_bitrate="2M", audio_bitrate="96k", encoder="libx264",
            smooth_slowmo=False, stabilize=False,  # previews stay fast
        )  # fmt: skip
    return RenderConfig(
        width=p.width, height=p.height, fps=p.fps, final_crf=p.crf, max_bitrate=p.max_bitrate,
        audio_bitrate=p.audio_bitrate, encoder=encoder,
    )  # fmt: skip
