"""Frame effects for product Reels. Every function takes a BGR ``uint8`` frame and returns a new one.

Soft effects (sweeps, glow, leaks) are computed at a fraction of the resolution and scaled up: they are smooth by nature, and it
keeps rendering fast. All of them only add light or blur: they never move or redraw the product.
"""

from __future__ import annotations

import math

import cv2
import numpy as np

WARM = np.array([0.72, 0.9, 1.0], np.float32)  # BGR of a warm white
GOLD = np.array([0.30, 0.62, 1.0], np.float32)  # BGR of a warm amber (light leaks)


def ease(p: float, kind: str = "in_out") -> float:
    p = min(max(p, 0.0), 1.0)
    if kind == "linear":
        return p
    if kind == "out":
        return 1 - (1 - p) ** 2
    if kind == "in":
        return p * p
    return p * p * (3 - 2 * p)


def _up(layer: np.ndarray, w: int, h: int) -> np.ndarray:
    return cv2.resize(layer, (w, h), interpolation=cv2.INTER_LINEAR)


def _screen(frame: np.ndarray, light: np.ndarray) -> np.ndarray:
    """Screen-blend a light layer (float 0..1, same shape as the frame) over a uint8 frame."""
    f = frame.astype(np.float32) / 255.0
    return np.clip((1.0 - (1.0 - f) * (1.0 - np.clip(light, 0, 1))) * 255.0, 0, 255).astype(np.uint8)


class Grid:
    """Coordinate grids for one frame size, made once."""

    def __init__(self, w: int, h: int) -> None:
        self.w, self.h = w, h
        self.lw, self.lh = max(w // 4, 8), max(h // 4, 8)  # the low-resolution working size
        yy, xx = np.mgrid[0 : self.lh, 0 : self.lw].astype(np.float32)
        self.x, self.y = xx / self.lw, yy / self.lh
        # vignette: darker towards the corners
        dx, dy = (self.x - 0.5) / 0.5, (self.y - 0.5) / 0.5
        self.radial = np.clip(np.sqrt(dx * dx + dy * dy) / math.sqrt(2), 0, 1)
        self._sprites: dict[int, np.ndarray] = {}

    def sprite(self, size: int) -> np.ndarray:
        """A four-point sparkle: a bright core with fine cross rays (float, 0..1)."""
        size = max(int(size) | 1, 9)
        if size not in self._sprites:
            c = size // 2
            yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
            dx, dy = xx - c, yy - c
            r = np.sqrt(dx * dx + dy * dy) + 1e-3
            core = np.exp(-(r / (size * 0.06)) ** 2)
            glow = np.exp(-(r / (size * 0.16)) ** 2) * 0.55
            horiz = np.exp(-(np.abs(dy) / (size * 0.018)) ** 2) * np.exp(-(np.abs(dx) / (size * 0.5)) ** 1.6)
            vert = np.exp(-(np.abs(dx) / (size * 0.018)) ** 2) * np.exp(-(np.abs(dy) / (size * 0.5)) ** 1.6)
            self._sprites[size] = np.clip(core + glow + 0.9 * horiz + 0.9 * vert, 0, 1).astype(np.float32)
        return self._sprites[size]


def vignette(frame: np.ndarray, g: Grid, strength: float) -> np.ndarray:
    if strength <= 0:
        return frame
    mask = 1.0 - strength * (g.radial ** 2.2)
    m = _up(mask.astype(np.float32), g.w, g.h)
    return np.clip(frame.astype(np.float32) * m[..., None], 0, 255).astype(np.uint8)


def grade(frame: np.ndarray, contrast: float) -> np.ndarray:
    if abs(contrast - 1.0) < 1e-3:
        return frame
    lut = np.clip((np.arange(256, dtype=np.float32) - 128.0) * contrast + 128.0, 0, 255).astype(np.uint8)
    return cv2.LUT(frame, lut)


def light_sweep(frame: np.ndarray, g: Grid, p: float, strength: float = 0.55, angle_deg: float = 24.0, width: float = 0.11) -> np.ndarray:
    """A soft band of light passing across the picture. It lights the bright parts (metal, stones) most, like a real reflection."""
    th = math.radians(angle_deg)
    u = g.x * math.cos(th) + g.y * math.sin(th)  # 0..~1.4 across the frame
    pos = -0.25 + 1.9 * ease(p, "in_out")
    band = np.exp(-(((u - pos) / width) ** 2)).astype(np.float32)
    small = cv2.resize(frame, (g.lw, g.lh), interpolation=cv2.INTER_AREA)
    lum = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    layer = (band * (0.22 + 1.1 * lum ** 2) * strength)[..., None] * WARM
    fade = math.sin(math.pi * min(max(p, 0.0), 1.0)) ** 0.6
    return _screen(frame, _up(layer * fade, g.w, g.h))


def glow(frame: np.ndarray, g: Grid, strength: float = 0.3, threshold: float = 0.72) -> np.ndarray:
    """A soft bloom around the brightest parts."""
    small = cv2.resize(frame, (g.lw, g.lh), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    bright = np.clip(small - threshold, 0, 1) / (1 - threshold)
    bloom = cv2.GaussianBlur(bright, (0, 0), max(g.lw / 45, 2.0))
    return _screen(frame, _up(bloom * strength, g.w, g.h))


def light_leak(frame: np.ndarray, g: Grid, p: float, strength: float = 0.4) -> np.ndarray:
    """A warm wash of light entering from a corner and leaving again."""
    cx, cy = 1.05 - 0.25 * p, 0.05 + 0.18 * p
    d = np.sqrt((g.x - cx) ** 2 + ((g.y - cy) * 1.4) ** 2)
    layer = np.exp(-(d / 0.5) ** 2)[..., None] * GOLD * strength * math.sin(math.pi * min(max(p, 0.0), 1.0))
    return _screen(frame, _up(layer.astype(np.float32), g.w, g.h))


def sparkle(frame: np.ndarray, g: Grid, x: float, y: float, p: float, strength: float = 0.9, size_frac: float = 0.16) -> np.ndarray:
    """A four-point sparkle at frame position (x, y) as fractions of the frame; it swells and fades over ``p``."""
    env = math.sin(math.pi * min(max(p, 0.0), 1.0)) ** 1.4
    if env < 0.02:
        return frame
    size = int(g.w * size_frac * (0.55 + 0.7 * env))
    spr = g.sprite(size)
    s = spr.shape[0]
    cx, cy = int(x * g.w), int(y * g.h)
    x0, y0 = cx - s // 2, cy - s // 2
    fx0, fy0, fx1, fy1 = max(x0, 0), max(y0, 0), min(x0 + s, g.w), min(y0 + s, g.h)
    if fx1 <= fx0 or fy1 <= fy0:
        return frame
    out = frame.copy()
    roi = out[fy0:fy1, fx0:fx1].astype(np.float32)
    add = spr[fy0 - y0 : fy1 - y0, fx0 - x0 : fx1 - x0][..., None] * (255.0 * strength * env) * np.array([0.92, 0.97, 1.0], np.float32)
    out[fy0:fy1, fx0:fx1] = np.clip(roi + add, 0, 255).astype(np.uint8)
    return out


def dust(frame: np.ndarray, g: Grid, t: float, strength: float = 0.35, count: int = 26, seed: int = 7) -> np.ndarray:
    """A few specks of dust drifting through the light."""
    rng = np.random.default_rng(seed)
    px, py = rng.random(count), rng.random(count)
    vx, vy = rng.uniform(-0.02, 0.02, count), rng.uniform(-0.05, -0.01, count)
    rad = rng.uniform(1.2, 3.4, count) * g.w / 1080
    layer = np.zeros((g.h, g.w), np.uint8)
    for i in range(count):
        x = ((px[i] + vx[i] * t) % 1.0) * g.w
        y = ((py[i] + vy[i] * t) % 1.0) * g.h
        cv2.circle(layer, (int(x), int(y)), max(int(rad[i]), 1), int(120 + 135 * rng.random()), -1, cv2.LINE_AA)
    layer = cv2.GaussianBlur(layer, (0, 0), 1.1)
    return cv2.add(frame, (layer[..., None] * strength).astype(np.uint8).repeat(3, axis=2))


def flash(frame: np.ndarray, amount: float) -> np.ndarray:
    amount = min(max(amount, 0.0), 1.0)
    return cv2.addWeighted(frame, 1.0 - amount, np.full_like(frame, 255), amount, 0) if amount > 0 else frame


def darken(frame: np.ndarray, amount: float) -> np.ndarray:
    """Fade towards black (amount 1 = black)."""
    amount = min(max(amount, 0.0), 1.0)
    return cv2.convertScaleAbs(frame, alpha=1.0 - amount) if amount > 0 else frame


def blur(frame: np.ndarray, radius: float) -> np.ndarray:
    """A soft focus (radius in pixels at the working size); done on a smaller copy for speed."""
    if radius < 0.6:
        return frame
    h, w = frame.shape[:2]
    k = 0.5 if radius > 6 else 1.0
    small = cv2.resize(frame, (max(int(w * k), 8), max(int(h * k), 8)), interpolation=cv2.INTER_AREA) if k < 1 else frame
    out = cv2.GaussianBlur(small, (0, 0), radius * k)
    return cv2.resize(out, (w, h), interpolation=cv2.INTER_LINEAR) if k < 1 else out


def zoom_about_centre(frame: np.ndarray, factor: float) -> np.ndarray:
    if abs(factor - 1.0) < 1e-3:
        return frame
    h, w = frame.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), 0.0, factor)
    return cv2.warpAffine(frame, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)


def whip(frame: np.ndarray, shift: float, direction: int) -> np.ndarray:
    """A fast sideways camera whip: the picture slides and smears along the direction of travel."""
    h, w = frame.shape[:2]
    dx = shift * w * direction
    m = np.float32([[1, 0, dx], [0, 1, 0]])
    out = cv2.warpAffine(frame, m, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    k = int(min(abs(shift) * w * 0.35, 90)) | 1
    if k >= 3:
        kernel = np.zeros((1, k), np.float32)
        kernel[0, :] = 1.0 / k
        out = cv2.filter2D(out, -1, kernel, borderType=cv2.BORDER_REFLECT_101)
    return out
