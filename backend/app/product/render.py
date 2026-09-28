"""Render a product Reel plan: every frame is made from the original photos, then encoded together with the music.

The camera is a 9:16 window over the photo. Each frame is one affine transform of the original pixels (crop + uniform scale +
a degree of roll), so the product is never redrawn, stretched or regenerated. Light, sparkle, glow and transitions are added on top.
"""

from __future__ import annotations

import math
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from app.core.errors import FFmpegError
from app.core.ffmpeg import find_binary
from app.captions.ass import ass_filter
from app.product import effects as fx
from app.product.models import ProductReelPlan, Shot, View
from app.product.styles import ProductStyle
from app.product.textass import write_text_ass
from app.product.understand import load_bgr

MAX_WORLD_SIDE = 4096  # photos larger than this are scaled down once (still far more than a 1080x1920 frame needs)


@dataclass(frozen=True)
class RenderSettings:
    width: int = 1080
    height: int = 1920
    fps: int = 30
    crf: int = 18
    preset: str = "medium"
    music_volume: float = 1.0


FINAL = RenderSettings()
PREVIEW = RenderSettings(width=540, height=960, fps=24, crf=27, preset="ultrafast")


class _World:
    """One photo, ready to be looked at: an image pyramid for sharp downscaling, and a soft backdrop for views past its edge."""

    def __init__(self, path: Path) -> None:
        img = load_bgr(path)
        h, w = img.shape[:2]
        if max(h, w) > MAX_WORLD_SIDE:
            k = MAX_WORLD_SIDE / max(h, w)
            img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
        self.levels = [img]
        self.h, self.w = img.shape[:2]
        bw = 256
        bh = max(int(bw * self.h / self.w), 8)
        small = cv2.resize(img, (bw, bh), interpolation=cv2.INTER_AREA)
        soft = cv2.GaussianBlur(small, (0, 0), 6)
        self.backdrop = cv2.convertScaleAbs(soft, alpha=0.5)  # dimmed, so the product stays the brightest thing
        self.mask = np.full((bh, bw), 255, np.uint8)
        self.bw, self.bh = bw, bh

    def level(self, n: int) -> np.ndarray:
        while len(self.levels) <= n:
            prev = self.levels[-1]
            self.levels.append(cv2.resize(prev, (max(prev.shape[1] // 2, 1), max(prev.shape[0] // 2, 1)), interpolation=cv2.INTER_AREA))
        return self.levels[n]


def _matrix(view: View, iw: float, ih: float, w: int, h: int) -> np.ndarray:
    """Photo pixels -> frame pixels for a view: a uniform scale, a small roll, and a shift. Nothing else."""
    s = h / (view.hh * ih)
    th = math.radians(view.roll)
    c, sn = math.cos(th), math.sin(th)
    cx, cy = view.cx * iw, view.cy * ih
    return np.float32([[s * c, s * sn, w / 2 - s * (c * cx + sn * cy)], [-s * sn, s * c, h / 2 - s * (-sn * cx + c * cy)]])


def _mix(a: View, b: View, p: float) -> View:
    return View(cx=a.cx + (b.cx - a.cx) * p, cy=a.cy + (b.cy - a.cy) * p, hh=a.hh * (b.hh / a.hh) ** p, roll=a.roll + (b.roll - a.roll) * p)  # zoom is geometric: even to the eye


def compose(world: _World, view: View, w: int, h: int) -> np.ndarray:
    """The frame for a view: the original pixels through one affine transform (over a soft backdrop past the photo's edge)."""
    m = _matrix(view, world.w, world.h, w, h)
    s = float(np.hypot(m[0, 0], m[0, 1]))
    lvl = max(int(math.floor(math.log2(1.0 / s))) if s < 1 else 0, 0)
    src = world.level(lvl)
    k = 1.0 / (2**lvl)
    ml = m.copy()
    ml[:, :2] /= k  # the level image is k times smaller: its pixels are 1/k the size
    interp = cv2.INTER_CUBIC if s > 1.0 else cv2.INTER_LINEAR
    corners = np.float32([[0, 0, 1], [w, 0, 1], [0, h, 1], [w, h, 1]])
    inv = cv2.invertAffineTransform(m)
    pts = corners @ inv.T
    inside = bool((pts[:, 0] >= 0).all() and (pts[:, 0] <= world.w).all() and (pts[:, 1] >= 0).all() and (pts[:, 1] <= world.h).all())
    fg = cv2.warpAffine(src, ml, (w, h), flags=interp, borderMode=cv2.BORDER_REFLECT_101 if inside else cv2.BORDER_CONSTANT)
    if inside:
        return fg
    kb = world.bw / world.w  # the backdrop is a small copy: the same transform in its own pixels
    mb = m.copy()
    mb[:, :2] /= kb
    bg = cv2.warpAffine(world.backdrop, mb, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    alpha = cv2.warpAffine(world.mask, mb, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    return np.clip(bg.astype(np.float32) * (1 - a) + fg.astype(np.float32) * a, 0, 255).astype(np.uint8)


class FrameMaker:
    """Makes the frame at time t of a plan."""

    def __init__(self, plan: ProductReelPlan, images: list[Path], style: ProductStyle, rs: RenderSettings) -> None:
        self.plan, self.style, self.rs = plan, style, rs
        self.worlds = [_World(p) for p in images]
        self.grid = fx.Grid(rs.width, rs.height)
        self.starts = [s.start for s in plan.shots]

    def _shot_at(self, t: float) -> Shot:
        i = max(int(np.searchsorted(self.starts, t, side="right")) - 1, 0)
        return self.plan.shots[min(i, len(self.plan.shots) - 1)]

    def _base(self, shot: Shot, t: float) -> np.ndarray:
        p = (t - shot.start) / max(shot.length, 1e-6)
        cam = shot.camera
        view = _mix(cam.start, cam.end, fx.ease(p, cam.ease))
        return compose(self.worlds[shot.image_index], view, self.rs.width, self.rs.height)

    def _transition(self, frame: np.ndarray, kind: str, p: float, side: str) -> np.ndarray:
        """``p`` runs 0..1 across the half of the transition on this side; ``side`` is "out" (leaving a shot) or "in" (entering)."""
        q = p if side == "out" else 1.0 - p  # 0 = untouched, 1 = the moment of the cut
        e = fx.ease(q, "in")
        if kind == "blur":
            return fx.blur(frame, 16 * e * self.rs.width / 1080)
        if kind == "light":
            return fx.flash(fx.blur(frame, 4 * e), 0.45 * e)
        if kind == "flash":
            return fx.flash(frame, 0.9 * e)
        if kind == "zoom":
            z = 1.0 + 0.32 * e if side == "out" else 1.0 + 0.32 * e
            return fx.blur(fx.zoom_about_centre(frame, z), 8 * e * self.rs.width / 1080)
        if kind in ("whip_left", "whip_right"):
            d = -1 if kind == "whip_left" else 1
            return fx.whip(frame, 0.55 * e, d if side == "out" else -d)
        if kind == "dip_to_black":
            return fx.darken(frame, e)
        return frame  # "dissolve" is a blend of both shots, done in frame()

    def frame(self, t: float) -> np.ndarray:
        shot = self._shot_at(t)
        idx = shot.index
        local = t - shot.start
        img = self._base(shot, t)

        # ---- effects planned for this shot
        for e in shot.effects:
            if not (e.at - 1e-6 <= local <= e.at + e.duration + 1e-6):
                continue
            p = (local - e.at) / max(e.duration, 1e-6)
            if e.type == "light_sweep":
                img = fx.light_sweep(img, self.grid, p, e.strength)
            elif e.type == "glow":
                img = fx.glow(img, self.grid, e.strength)
            elif e.type == "light_leak":
                img = fx.light_leak(img, self.grid, p, e.strength)
            elif e.type == "dust":
                img = fx.dust(img, self.grid, t, e.strength)
            elif e.type == "flash":
                img = fx.flash(img, e.strength * (1 - p))
            elif e.type == "sparkle" and e.x is not None and e.y is not None:
                cam = shot.camera
                pp = (t - shot.start) / max(shot.length, 1e-6)
                view = _mix(cam.start, cam.end, fx.ease(pp, cam.ease))
                w = self.worlds[shot.image_index]
                m = _matrix(view, w.w, w.h, self.rs.width, self.rs.height)
                fx_px = m[0, 0] * e.x * w.w + m[0, 1] * e.y * w.h + m[0, 2]
                fy_px = m[1, 0] * e.x * w.w + m[1, 1] * e.y * w.h + m[1, 2]
                img = fx.sparkle(img, self.grid, fx_px / self.rs.width, fy_px / self.rs.height, p, e.strength)

        # ---- transitions: half on the way out of a shot, half on the way into the next
        tin = shot.transition_in
        if idx > 0 and tin.type not in ("cut", "match") and tin.type != "fade_from_black":
            half = tin.duration / 2
            if half > 0 and local < half:  # p runs 0 -> 1 away from the cut, so the effect is strongest AT the cut
                img = self._transition(img, tin.type, local / half, "in")
        if idx + 1 < len(self.plan.shots):
            nxt = self.plan.shots[idx + 1].transition_in
            if nxt.type not in ("cut", "match", "fade_from_black") and nxt.duration > 0:
                half = nxt.duration / 2
                left = shot.end - t
                if left < half:
                    img = self._transition(img, nxt.type, 1 - left / half, "out")
        # ---- dissolve: a real cross-fade, blending this shot with the neighbouring one (50/50 exactly at the cut)
        if idx > 0 and tin.type == "dissolve" and tin.duration > 0 and local < tin.duration / 2:
            prev = self.plan.shots[idx - 1]
            w = 0.5 + 0.5 * local / (tin.duration / 2)  # this shot's share
            img = cv2.addWeighted(img, w, self._base(prev, prev.end), 1.0 - w, 0.0)
        if idx + 1 < len(self.plan.shots):
            nxt_shot = self.plan.shots[idx + 1]
            nt = nxt_shot.transition_in
            if nt.type == "dissolve" and nt.duration > 0 and shot.end - t < nt.duration / 2:
                w = 0.5 + 0.5 * (shot.end - t) / (nt.duration / 2)
                img = cv2.addWeighted(img, w, self._base(nxt_shot, nxt_shot.start), 1.0 - w, 0.0)
        if idx == 0 and tin.type == "fade_from_black" and tin.duration > 0:
            img = fx.darken(img, 1 - fx.ease(local / tin.duration, "out"))

        img = fx.grade(img, self.style.contrast)
        return fx.vignette(img, self.grid, self.style.vignette)


class _Encoder:
    """FFmpeg reading raw frames from a pipe, with the music and the text layer. Argument list only: no shell."""

    def __init__(self, cmd: list[str], err_path: Path) -> None:
        self.err_path = err_path
        self.err = open(err_path, "wb")  # noqa: SIM115 - closed in finish()
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.err)

    def write(self, frame: np.ndarray) -> None:
        assert self.proc.stdin is not None
        try:
            self.proc.stdin.write(frame.tobytes())
        except (BrokenPipeError, OSError):
            self.finish(True)

    def finish(self, broken: bool = False) -> None:
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
        except OSError:
            pass
        code = self.proc.wait()
        self.err.close()
        if code != 0 or broken:
            tail = self.err_path.read_text(errors="replace")[-600:] if self.err_path.exists() else ""
            raise FFmpegError(f"The video encoder stopped (exit code {code}).", details=tail)


def render_reel(
    plan: ProductReelPlan,
    images: list[Path],
    style: ProductStyle,
    out_path: Path,
    work_dir: Path,
    music: Path | None = None,
    settings: RenderSettings = FINAL,
    progress: Callable[[float], None] | None = None,
) -> Path:
    """Make the finished MP4. ``images`` are in the order ``plan.images`` refers to."""
    rs = settings
    maker = FrameMaker(plan, images, style, rs)
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    ass = write_text_ass(plan.texts, style, work_dir / "text.ass", rs.width, rs.height)
    total = max(int(round(plan.duration * rs.fps)), 1)
    tmp_out = work_dir / "reel.mp4"
    cmd = [find_binary("ffmpeg"), "-y", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{rs.width}x{rs.height}",
           "-r", str(rs.fps), "-i", "pipe:0"]  # fmt: skip
    if music is not None:
        cmd += ["-ss", f"{plan.audio_start:.3f}", "-t", f"{plan.duration + 0.5:.3f}", "-i", str(music)]
    if ass is not None:
        cmd += ["-vf", ass_filter(ass)]
    cmd += ["-map", "0:v"]
    if music is not None:
        fo = min(0.9, plan.duration / 3)
        cmd += ["-map", "1:a", "-af", f"afade=t=in:st=0:d=0.2,afade=t=out:st={max(plan.duration - fo, 0):.3f}:d={fo:.3f},volume={rs.music_volume:.2f}",
                "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"]  # fmt: skip
    else:
        cmd += ["-an"]
    cmd += ["-c:v", "libx264", "-preset", rs.preset, "-crf", str(rs.crf), "-pix_fmt", "yuv420p", "-r", str(rs.fps), "-t", f"{plan.duration:.3f}",
            "-movflags", "+faststart", str(tmp_out)]  # fmt: skip
    enc = _Encoder(cmd, work_dir / "ffmpeg.err")
    try:
        for i in range(total):
            enc.write(maker.frame(min(i / rs.fps, plan.duration - 1e-4)))
            if progress and i % 6 == 0:
                progress(i / total)
        enc.finish()
    except BaseException:
        try:
            enc.proc.kill()
        except OSError:
            pass
        raise
    tmp_out.replace(out_path)
    if progress:
        progress(1.0)
    return out_path


def temp_work_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="product_reel_"))
