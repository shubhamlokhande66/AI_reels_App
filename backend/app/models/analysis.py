"""Analysis result models for audio and video."""

from __future__ import annotations

from typing import Literal

from app.models.base import CamelModel


class Section(CamelModel):
    start: float
    end: float


class AudioAnalysis(CamelModel):
    bpm: float
    duration: float
    beats: list[float]
    beat_confidence: float = 0.0  # 0..1 regularity of the beat grid
    strong_beats: list[float] = []  # downbeats / beats landing on high energy
    onsets: list[float] = []
    # The song's strongest individual hits (drum hits, accents): time in seconds and strength (1.0 = the strongest in the song).
    accents: list[float] = []
    accent_strengths: list[float] = []
    analysis_version: int = 1  # 2 = includes accents; older cached analyses are redone
    high_energy_sections: list[Section] = []
    sections: list[Section] = []  # coarse structural sections
    drops: list[float] = []
    # Normalised (0..1) RMS energy sampled every ``energy_hop`` seconds.
    energy_hop: float = 0.1
    energy: list[float] = []

    def energy_at(self, t: float) -> float:
        if not self.energy:
            return 0.5
        i = min(max(int(t / self.energy_hop), 0), len(self.energy) - 1)
        return self.energy[i]

    def mean_energy(self, start: float, end: float) -> float:
        if not self.energy:
            return 0.5
        a = max(int(start / self.energy_hop), 0)
        b = max(min(int(end / self.energy_hop) + 1, len(self.energy)), a + 1)
        seg = self.energy[a:b]
        return sum(seg) / len(seg) if seg else 0.5


class VideoMetadata(CamelModel):
    """Container-level facts from ffprobe."""

    duration: float
    width: int  # display width (rotation applied)
    height: int  # display height (rotation applied)
    fps: float
    codec: str = ""
    has_audio: bool = False
    rotation: int = 0
    bit_rate: int | None = None
    orientation: Literal["landscape", "portrait", "square"] = "landscape"


class UsableWindow(CamelModel):
    """A contiguous, usable section of a clip (no scene cuts, good exposure/sharpness)."""

    start: float
    end: float
    quality: float
    motion: float
    brightness: float
    sharpness: float
    focus_x: float = 0.5  # 0..1 horizontal position of the point of interest
    focus_y: float = 0.5
    face: bool = False
    focus_source: Literal["face", "subject", "motion", "center"] = "center"
    signature: list[float] = []  # coarse colour histogram, used to keep neighbours different
    shot: int = 0  # index of the continuous shot (no scene change) this window belongs to
    # Per-sample motion (0..1) so the selector can pick the best sub-range inside a window.
    motion_curve: list[float] = []
    curve_dt: float = 0.25

    @property
    def length(self) -> float:
        return self.end - self.start

    def motion_between(self, a: float, b: float) -> float:
        """Mean motion of the window sub-range [a, b] (absolute clip time)."""
        if not self.motion_curve:
            return self.motion
        i = max(int((a - self.start) / self.curve_dt), 0)
        j = max(int((b - self.start) / self.curve_dt) + 1, i + 1)
        seg = self.motion_curve[i:j] or self.motion_curve[-1:]
        return sum(seg) / len(seg)


ClipFlag = Literal[
    "too_dark", "too_blurry", "too_short", "wrong_orientation", "shaky", "duplicate_heavy", "low_resolution"
]


class ClipAnalysis(CamelModel):
    clip_id: str
    metadata: VideoMetadata
    quality_score: float
    motion_score: float
    brightness_score: float
    sharpness_score: float
    shake_score: float = 0.0  # 0 = steady, 1 = very shaky
    # The real picture inside the frame, as [x, y, w, h] in pixels, when the file has solid padding
    # (white/black bars, burned-in titles, "reel in a reel"). None = the whole frame is picture.
    content_rect: list[int] | None = None
    resolution_score: float = 1.0  # 1 = sharp enough for a 1080-wide canvas; 0 = hopelessly small
    duplicate_ratio: float = 0.0
    scene_changes: list[float] = []
    flags: list[ClipFlag] = []
    usable: bool = True
    windows: list[UsableWindow] = []
