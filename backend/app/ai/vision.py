"""Vision-AI interface (Phase 11: design only).

A vision-capable model can later annotate sampled frames (people, products, food, scene,
importance, composition). The rest of the system consumes ``FrameAnnotation``s through this
interface, so adding a real model means writing one ``VisionAnalyzer`` subclass - the renderer,
timeline builder and crop strategies do not change.

TODO: no real vision model is wired up yet. ``NullVisionAnalyzer`` is the default and produces
no annotations, so behaviour today is exactly the OpenCV-only analysis.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

from app.models.analysis import ClipAnalysis


@dataclass(frozen=True)
class FrameRef:
    """A frame sampled from a clip, saved as an image the model can read."""

    clip_id: str
    time: float
    path: Path


@dataclass
class FrameAnnotation:
    clip_id: str
    time: float
    people: int = 0
    faces: int = 0
    labels: list[str] = field(default_factory=list)  # e.g. ["product", "food", "landscape"]
    scene: str | None = None
    importance: float = 0.5  # 0..1: how much this moment matters to the story
    subject_box: tuple[float, float, float, float] | None = None  # normalised x, y, w, h
    composition: dict[str, float] = field(default_factory=dict)  # e.g. {"balance": 0.8}


class VisionAnalyzer(ABC):
    name: str

    @abstractmethod
    def analyze_frames(self, frames: Sequence[FrameRef]) -> list[FrameAnnotation]:
        """Annotate frames. Must return one annotation per frame it understands."""


class NullVisionAnalyzer(VisionAnalyzer):
    name = "none"

    def analyze_frames(self, frames):
        return []


_analyzer: VisionAnalyzer = NullVisionAnalyzer()


def set_vision_analyzer(analyzer: VisionAnalyzer | None) -> None:
    global _analyzer
    _analyzer = analyzer or NullVisionAnalyzer()


def get_vision_analyzer() -> VisionAnalyzer:
    return _analyzer


def apply_annotations(analysis: ClipAnalysis, annotations: Sequence[FrameAnnotation]) -> int:
    """Refine a clip's usable windows with vision results. Returns how many windows changed.

    A subject box inside a window becomes that window's crop focus (source ``subject``), and
    high-importance moments nudge the window's quality so the selector prefers them.
    """
    changed = 0
    for w in analysis.windows:
        inside = [a for a in annotations if a.clip_id == analysis.clip_id and w.start <= a.time <= w.end]
        boxes = [a.subject_box for a in inside if a.subject_box]
        touched = False
        if boxes:
            w.focus_x = round(sum(b[0] + b[2] / 2 for b in boxes) / len(boxes), 3)
            w.focus_y = round(sum(b[1] + b[3] / 2 for b in boxes) / len(boxes), 3)
            w.focus_source = "subject"
            touched = True
        if inside:
            importance = sum(a.importance for a in inside) / len(inside)
            w.quality = round(min(max(w.quality * (0.85 + 0.3 * importance), 0.0), 1.0), 3)
            touched = True
        changed += touched
    return changed
