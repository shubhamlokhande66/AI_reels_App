"""Smart cropping to 9:16 via a pluggable strategy.

A strategy maps (source size, target aspect, focus hint) -> a crop rectangle. New strategies
(saliency, subject tracking, vision-model boxes) subclass ``CropStrategy`` and register; the
renderer only ever sees ``CropRegion``.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class Focus:
    x: float = 0.5  # 0..1 across the frame
    y: float = 0.5
    source: str = "center"  # "face" | "subject" | "motion" | "center"


@dataclass(frozen=True)
class CropRegion:
    x: int
    y: int
    w: int
    h: int

    def as_filter(self) -> str:
        return f"crop={self.w}:{self.h}:{self.x}:{self.y}"


def _even(v: float) -> int:
    """Even size (>= 2); H.264 4:2:0 needs even dimensions."""
    return max(int(v) // 2 * 2, 2)


def _even_offset(v: float) -> int:
    """Even offset (>= 0); 0 must stay 0 or a full-frame crop would fall outside the source."""
    return max(int(v) // 2 * 2, 0)


def crop_to_aspect(src_w: int, src_h: int, aspect: float, fx: float, fy: float) -> CropRegion:
    """Largest ``aspect`` (w/h) rectangle inside the source, centred as near (fx, fy) as fits."""
    fx, fy = min(max(fx, 0.0), 1.0), min(max(fy, 0.0), 1.0)
    if src_w / src_h > aspect:  # source too wide -> trim the sides
        h = _even(src_h)
        w = min(_even(round(h * aspect)), _even(src_w))
        x = _even_offset(min(max(fx * src_w - w / 2, 0), src_w - w))
        return CropRegion(x, 0, w, h)
    w = _even(src_w)  # source too tall (or equal) -> trim top/bottom
    h = min(_even(round(w / aspect)), _even(src_h))
    y = _even_offset(min(max(fy * src_h - h / 2, 0), src_h - h))
    return CropRegion(0, y, w, h)


class CropStrategy(ABC):
    name: str

    @abstractmethod
    def compute(self, src_w: int, src_h: int, aspect: float, focus: Focus) -> CropRegion: ...


class CenterCrop(CropStrategy):
    name = "center"

    def compute(self, src_w, src_h, aspect, focus):
        return crop_to_aspect(src_w, src_h, aspect, 0.5, 0.5)


class FaceAwareCrop(CropStrategy):
    """Follow a detected face; otherwise centre."""

    name = "face"

    def compute(self, src_w, src_h, aspect, focus):
        if focus.source in ("face", "subject"):
            return crop_to_aspect(src_w, src_h, aspect, focus.x, focus.y)
        return crop_to_aspect(src_w, src_h, aspect, 0.5, 0.5)


class MotionAwareCrop(CropStrategy):
    """Follow the centre of motion, damped toward the centre so noisy motion cannot drag the frame."""

    name = "motion"
    damping = 0.6

    def compute(self, src_w, src_h, aspect, focus):
        if focus.source in ("motion", "face", "subject"):
            d = self.damping if focus.source == "motion" else 1.0
            return crop_to_aspect(
                src_w, src_h, aspect, 0.5 + d * (focus.x - 0.5), 0.5 + d * (focus.y - 0.5)
            )
        return crop_to_aspect(src_w, src_h, aspect, 0.5, 0.5)


class SmartCrop(CropStrategy):
    """Face if one was found, else motion, else centre (default)."""

    name = "smart"

    def __init__(self) -> None:
        self._motion = MotionAwareCrop()

    def compute(self, src_w, src_h, aspect, focus):
        return self._motion.compute(src_w, src_h, aspect, focus)


_STRATEGIES: dict[str, CropStrategy] = {}


def register_crop_strategy(strategy: CropStrategy) -> CropStrategy:
    _STRATEGIES[strategy.name] = strategy
    return strategy


for _s in (CenterCrop(), FaceAwareCrop(), MotionAwareCrop(), SmartCrop()):
    register_crop_strategy(_s)


def get_crop_strategy(name: str = "smart") -> CropStrategy:
    return _STRATEGIES.get(name) or _STRATEGIES["smart"]
