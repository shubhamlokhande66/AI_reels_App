"""Video analysis: ffprobe metadata + OpenCV sampling for quality, motion and usable windows."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from app.core.errors import CorruptedMedia, UnsupportedMedia
from app.core.ffmpeg import probe
from app.models.analysis import ClipAnalysis, UsableWindow, VideoMetadata

SAMPLE_FPS = 4.0  # frames analysed per second of footage
MAX_SAMPLES = 320  # hard cap so very long clips stay fast
ANALYSIS_WIDTH = 320
WINDOW_MAX_SECONDS = 6.0
MIN_WINDOW_SECONDS = 0.5
MIN_CLIP_SECONDS = 1.0
DARK_LEVEL = 0.12
BRIGHT_LEVEL = 0.93
BLUR_VARIANCE = 20.0  # Laplacian variance (on a 320px frame) below which a frame is "blurry"

ProgressFn = Callable[[float], None]

# Solid-padding detection
RECT_FRAMES = 24
RECT_SPREAD_MAX = 8.0  # the frame edge must be one flat colour (grey-level spread)
RECT_ROW_FRACTION = 0.6  # a "picture row" has this share of non-padding pixels
RECT_MIN_AREA, RECT_MAX_AREA = 0.12, 0.93
GOOD_WIDTH = 720  # content width (px) that looks fine on a 1080-wide canvas
BLOCKING_WIDTH = 240  # narrower than this the picture is unusable at 1080 wide
LOW_RES_WIDTH = 400


# --------------------------------------------------------------------------- metadata
def parse_video_probe(info: dict) -> VideoMetadata:
    """Turn ffprobe JSON into ``VideoMetadata`` (display size, rotation applied)."""
    stream = next((s for s in info.get("streams", []) if s.get("codec_type") == "video"), None)
    if stream is None:
        raise UnsupportedMedia("This file has no video stream.", code="NO_VIDEO_STREAM")
    fmt = info.get("format", {})
    duration = float(fmt.get("duration") or stream.get("duration") or 0)
    if duration < 0.2:
        raise UnsupportedMedia("The video is too short or has no readable duration.")
    w, h = int(stream.get("width") or 0), int(stream.get("height") or 0)
    rotation = 0
    for sd in stream.get("side_data_list", []) or []:
        if "rotation" in sd:
            rotation = int(round(float(sd["rotation"]))) % 360
    if not rotation:
        rotation = int(stream.get("tags", {}).get("rotate", 0) or 0) % 360
    if rotation in (90, 270):
        w, h = h, w
    if w <= 0 or h <= 0:
        raise CorruptedMedia("The video has invalid dimensions.")
    num, _, den = str(stream.get("avg_frame_rate") or stream.get("r_frame_rate") or "0/1").partition("/")
    try:
        fps = float(num) / float(den) if float(den or 1) else 0.0
    except ValueError:
        fps = 0.0
    bit_rate = fmt.get("bit_rate")
    orientation = "square" if abs(w - h) / max(w, h) < 0.05 else ("landscape" if w > h else "portrait")
    return VideoMetadata(
        duration=round(duration, 3),
        width=w,
        height=h,
        fps=round(fps, 3),
        codec=str(stream.get("codec_name", "")),
        has_audio=any(s.get("codec_type") == "audio" for s in info.get("streams", [])),
        rotation=rotation,
        bit_rate=int(bit_rate) if bit_rate and str(bit_rate).isdigit() else None,
        orientation=orientation,
    )


def read_metadata(path: Path) -> VideoMetadata:
    return parse_video_probe(probe(path))


# --------------------------------------------------------------------------- content rect
def _longest_run(flags: np.ndarray, max_gap: int) -> tuple[int, int] | None:
    """Longest run of True (gaps of up to ``max_gap`` False values are bridged)."""
    best: tuple[int, int] | None = None
    start = last = None
    for i, f in enumerate(flags):
        if not f:
            continue
        if start is None or i - last - 1 > max_gap:
            start = i
        last = i
        if best is None or last - start > best[1] - best[0]:
            best = (start, last)
    return best


def _polish_edges(
    stack: np.ndarray, r0: int, r1: int, c0: int, c1: int, max_frac: float = 0.04
) -> tuple[int, int, int, int]:
    """Trim thin flat white/black lines left along the picture's edges (a few pixels of canvas)."""
    h, w = stack.shape[1:]

    def flat(line: np.ndarray) -> bool:  # line: (frames, pixels)
        med = np.median(line, axis=0)
        return bool(med.std() < 10 and (med.mean() > 225 or med.mean() < 25))

    for _ in range(int(w * max_frac)):
        if c1 - c0 > 8 and flat(stack[:, r0 : r1 + 1, c0]):
            c0 += 1
        else:
            break
    for _ in range(int(w * max_frac)):
        if c1 - c0 > 8 and flat(stack[:, r0 : r1 + 1, c1]):
            c1 -= 1
        else:
            break
    for _ in range(int(h * max_frac)):
        if r1 - r0 > 8 and flat(stack[:, r0, c0 : c1 + 1]):
            r0 += 1
        else:
            break
    for _ in range(int(h * max_frac)):
        if r1 - r0 > 8 and flat(stack[:, r1, c0 : c1 + 1]):
            r1 -= 1
        else:
            break
    return r0, r1, c0, c1


def find_content_rect(frames: list[np.ndarray]) -> tuple[float, float, float, float] | None:
    """Locate the real picture inside solid padding. Returns normalised (x0, y0, x1, y1) or None.

    Handles white/black bars, a small video window on a canvas with a burned-in title, and pictures
    that touch only two sides (padding above and below, edge-to-edge horizontally). Each axis is judged
    on its own: rows are trimmed only if the top and bottom edges are one flat colour, columns only if
    the left and right edges are. A row/column counts as picture only when most of its pixels differ
    from the padding colour, so a line of title text (mostly padding) is excluded.
    """
    if not frames:
        return None
    h, w = frames[0].shape
    stack = np.stack(frames).astype(np.int16)
    rh, rw = max(2, int(h * 0.01)), max(2, int(w * 0.01))

    def flat_colour(ring: np.ndarray) -> float | None:
        bg = float(np.median(ring))
        return bg if float(np.percentile(np.abs(ring - bg), 90)) <= RECT_SPREAD_MAX else None

    bg_tb = flat_colour(np.concatenate([stack[:, :rh, :].ravel(), stack[:, -rh:, :].ravel()]))
    bg_lr = flat_colour(np.concatenate([stack[:, :, :rw].ravel(), stack[:, :, -rw:].ravel()]))

    r0, r1 = 0, h - 1
    if bg_tb is not None:
        mask = np.abs(stack - bg_tb) > 20
        run = _longest_run(np.median(mask.mean(axis=2), axis=0) >= RECT_ROW_FRACTION, max(2, int(h * 0.02)))
        if run is None:
            return None
        r0, r1 = run
    c0, c1 = 0, w - 1
    if bg_lr is not None:
        mask = np.abs(stack[:, r0 : r1 + 1, :] - bg_lr) > 20
        run = _longest_run(np.median(mask.mean(axis=1), axis=0) >= RECT_ROW_FRACTION, max(2, int(w * 0.02)))
        if run is None:
            return None
        c0, c1 = run

    r0, r1, c0, c1 = _polish_edges(stack, r0, r1, c0, c1)
    trimmed = (r0 + (h - 1 - r1)) / h + (c0 + (w - 1 - c1)) / w
    area = (r1 - r0 + 1) * (c1 - c0 + 1) / (h * w)
    if trimmed < 0.008 or area > RECT_MAX_AREA or area < RECT_MIN_AREA:
        return None  # nothing meaningful to trim, or the "picture" is implausibly small
    inset_x = max(1, int(w * 0.006)) if (c0 > 0 or c1 < w - 1) else 0
    inset_y = max(1, int(h * 0.006)) if (r0 > 0 or r1 < h - 1) else 0  # drop the anti-aliased edge
    x0, x1 = (c0 + inset_x) / w, (c1 + 1 - inset_x) / w
    y0, y1 = (r0 + inset_y) / h, (r1 + 1 - inset_y) / h
    return (x0, y0, x1, y1) if x1 > x0 and y1 > y0 else None


def detect_content_rect(path: Path, meta: VideoMetadata) -> tuple[float, float, float, float] | None:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return None
    try:
        total = max(int(meta.duration * (meta.fps or 30)), 1)
        frames: list[np.ndarray] = []
        for i in range(RECT_FRAMES):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / RECT_FRAMES))
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            h, w = frame.shape[:2]
            scale = ANALYSIS_WIDTH / w if w > ANALYSIS_WIDTH else 1.0
            small = cv2.resize(frame, (max(int(w * scale), 8), max(int(h * scale), 8)), interpolation=cv2.INTER_AREA)
            frames.append(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))
        if len(frames) < 4 or len({f.shape for f in frames}) != 1:
            return None
        return find_content_rect(frames)
    finally:
        cap.release()


# --------------------------------------------------------------------------- sampling
@dataclass
class _Sample:
    t: float
    brightness: float
    sharp_var: float
    hist: np.ndarray
    motion: float = 0.0  # diff to previous sample (0..1 raw)
    focus_x: float = 0.5
    focus_y: float = 0.5
    has_focus: bool = False  # focus_* came from real motion
    face: tuple[float, float] | None = None
    shift: tuple[float, float] | None = None  # global translation vs previous sample (px)
    scene_cut: bool = False
    duplicate: bool = False


@dataclass
class _Detectors:
    face: cv2.CascadeClassifier | None = None
    _tried: bool = field(default=False, repr=False)

    @classmethod
    def load(cls) -> "_Detectors":
        try:
            path = Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml"
            c = cv2.CascadeClassifier(str(path))
            return cls(face=None if c.empty() else c)
        except (AttributeError, cv2.error):  # OpenCV builds without objdetect
            return cls()


def _hist(frame_bgr_small: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(frame_bgr_small, cv2.COLOR_BGR2HSV)
    h = cv2.calcHist([hsv], [0, 1], None, [8, 3], [0, 180, 0, 256]).flatten()
    total = h.sum()
    return (h / total).astype(np.float32) if total else h.astype(np.float32)


def _score_brightness(b: float) -> float:
    """1.0 for well-exposed (~0.5), falling off toward black and white."""
    return float(max(0.0, 1.0 - abs(b - 0.5) / 0.5))


def _score_sharpness(var: float) -> float:
    return float(1.0 - math.exp(-max(var, 0.0) / 120.0))


def _score_motion(diff: float) -> float:
    return float(1.0 - math.exp(-max(diff, 0.0) / 0.03))


def sample_video(
    path: Path, meta: VideoMetadata, progress: ProgressFn | None = None,
    rect: tuple[float, float, float, float] | None = None,
) -> list[_Sample]:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise UnsupportedMedia(
            "This video's codec could not be opened for analysis.", code="UNSUPPORTED_CODEC"
        )
    try:
        fps = meta.fps or cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = max(int(meta.duration * fps), 1)
        step = max(int(round(fps / SAMPLE_FPS)), 1)
        step = max(step, math.ceil(total / MAX_SAMPLES))
        detectors = _Detectors.load()
        samples: list[_Sample] = []
        prev_gray: np.ndarray | None = None
        prev_hist: np.ndarray | None = None
        idx = -1
        while True:
            if not cap.grab():
                break
            idx += 1
            if idx % step:
                continue
            ok, frame = cap.retrieve()
            if not ok or frame is None:
                continue
            if rect is not None:  # analyse only the real picture, not the padding around it
                fh, fw = frame.shape[:2]
                frame = frame[int(rect[1] * fh) : int(rect[3] * fh), int(rect[0] * fw) : int(rect[2] * fw)]
            h, w = frame.shape[:2]
            scale = ANALYSIS_WIDTH / w if w > ANALYSIS_WIDTH else 1.0
            small = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            hist = _hist(small)
            s = _Sample(
                t=idx / fps,
                brightness=float(gray.mean() / 255.0),
                sharp_var=float(cv2.Laplacian(gray, cv2.CV_64F).var()),
                hist=hist,
            )
            gh, gw = gray.shape
            if prev_gray is not None and prev_hist is not None and prev_gray.shape == gray.shape:
                diff = cv2.absdiff(gray, prev_gray)
                s.motion = float(diff.mean() / 255.0)
                corr = float(cv2.compareHist(hist, prev_hist, cv2.HISTCMP_CORREL))
                s.scene_cut = corr < 0.55 and s.motion > 0.08 or s.motion > 0.30
                s.duplicate = s.motion < 0.0015
                if not s.scene_cut:
                    mask = diff > 25
                    if mask.sum() > 20:
                        ys, xs = np.nonzero(mask)
                        s.focus_x, s.focus_y, s.has_focus = float(xs.mean() / gw), float(ys.mean() / gh), True
                    if not s.duplicate:
                        (dx, dy), resp = cv2.phaseCorrelate(
                            prev_gray.astype(np.float32), gray.astype(np.float32)
                        )
                        if resp > 0.03:
                            s.shift = (float(dx) / gw, float(dy) / gh)
            if detectors.face is not None and len(samples) % 2 == 0:
                faces = detectors.face.detectMultiScale(
                    gray, scaleFactor=1.15, minNeighbors=5, minSize=(max(gw // 12, 20),) * 2
                )
                if len(faces):
                    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                    s.face = ((fx + fw / 2) / gw, (fy + fh / 2) / gh)
            samples.append(s)
            prev_gray, prev_hist = gray, hist
            if progress:
                progress(min(idx / total, 1.0))
        if not samples:
            raise CorruptedMedia("No frames could be decoded from this video.")
        return samples
    finally:
        cap.release()


# --------------------------------------------------------------------------- scoring
def _shake_score(samples: list[_Sample]) -> float:
    """High-frequency global jitter: change of shift between consecutive samples.

    A smooth pan keeps a constant shift (low score); hand-shake flips direction (high score).
    """
    deltas: list[float] = []
    prev: tuple[float, float] | None = None
    for s in samples:
        if s.shift is None or s.scene_cut:
            prev = None
            continue
        if prev is not None:
            deltas.append(math.hypot(s.shift[0] - prev[0], s.shift[1] - prev[1]))
        prev = s.shift
    if not deltas:
        return 0.0
    return float(min(np.mean(deltas) / 0.04, 1.0))


def _build_windows(samples: list[_Sample], duration: float, shake: float, res_factor: float = 1.0) -> list[UsableWindow]:
    if len(samples) == 0:
        return []
    dt = duration / max(len(samples), 1)
    if len(samples) > 1:
        dt = float(np.median(np.diff([s.t for s in samples])))
    dt = max(dt, 1e-3)

    # 1) split into shots at scene cuts
    shots: list[list[_Sample]] = [[]]
    for s in samples:
        if s.scene_cut and shots[-1]:
            shots.append([])
        shots[-1].append(s)

    windows: list[UsableWindow] = []
    for shot_idx, shot in enumerate(shots):
        # 2) contiguous runs of well-exposed, sharp samples
        run: list[_Sample] = []
        runs: list[list[_Sample]] = []
        for s in shot:
            good = DARK_LEVEL <= s.brightness <= BRIGHT_LEVEL and s.sharp_var >= BLUR_VARIANCE
            if good:
                run.append(s)
            elif run:
                runs.append(run)
                run = []
        if run:
            runs.append(run)
        # 3) chunk long runs
        for r in runs:
            chunks: list[list[_Sample]] = []
            cur: list[_Sample] = []
            for s in r:
                if cur and s.t - cur[0].t >= WINDOW_MAX_SECONDS:
                    chunks.append(cur)
                    cur = []
                cur.append(s)
            if cur:
                chunks.append(cur)
            for ch in chunks:
                start = ch[0].t
                end = min(ch[-1].t + dt, duration)
                if end - start < MIN_WINDOW_SECONDS:
                    continue
                windows.append(_window_from(ch, start, end, shot_idx, dt, shake, res_factor))
    return windows


def _window_from(
    ch: list[_Sample], start: float, end: float, shot: int, dt: float, shake: float, res_factor: float = 1.0
) -> UsableWindow:
    bright = float(np.mean([s.brightness for s in ch]))
    sharp = float(np.mean([_score_sharpness(s.sharp_var) for s in ch]))
    motion_curve = [round(_score_motion(s.motion), 3) for s in ch]
    motion = float(np.mean(motion_curve))
    dup = float(np.mean([s.duplicate for s in ch]))
    faces = [s.face for s in ch if s.face]
    face = len(faces) >= max(1, len(ch) // 4)
    source = "center"
    if face:
        source = "face"
        fx, fy = float(np.mean([f[0] for f in faces])), float(np.mean([f[1] for f in faces]))
    else:
        pts = [(s.focus_x, s.focus_y, s.motion) for s in ch if s.has_focus]
        if pts:
            source = "motion"
            wts = np.array([max(p[2], 1e-4) for p in pts])
            fx = float(np.average([p[0] for p in pts], weights=wts))
            fy = float(np.average([p[1] for p in pts], weights=wts))
        else:
            fx = fy = 0.5
    quality = 0.45 * sharp + 0.25 * _score_brightness(bright) + 0.15 * (1 - shake) + 0.15 * (1 - dup)
    quality *= res_factor  # small pictures look worse once stretched to the output size
    sig = np.mean([s.hist for s in ch], axis=0)
    return UsableWindow(
        start=round(start, 3),
        end=round(end, 3),
        quality=round(float(quality), 3),
        motion=round(motion, 3),
        brightness=round(bright, 3),
        sharpness=round(sharp, 3),
        focus_x=round(min(max(fx, 0.0), 1.0), 3),
        focus_y=round(min(max(fy, 0.0), 1.0), 3),
        face=face,
        focus_source=source,  # type: ignore[arg-type]
        signature=[round(float(x), 4) for x in sig],
        shot=shot,
        motion_curve=motion_curve,
        curve_dt=round(dt, 4),
    )


def analyze_clip(
    path: Path, clip_id: str, progress: ProgressFn | None = None, meta: VideoMetadata | None = None
) -> ClipAnalysis:
    meta = meta or read_metadata(path)
    rect = detect_content_rect(path, meta)
    samples = sample_video(path, meta, progress, rect)
    if rect is not None:
        cx0, cy0 = int(rect[0] * meta.width) // 2 * 2, int(rect[1] * meta.height) // 2 * 2
        cw = max(int((rect[2] - rect[0]) * meta.width) // 2 * 2, 2)
        ch = max(int((rect[3] - rect[1]) * meta.height) // 2 * 2, 2)
        content_rect: list[int] | None = [cx0, cy0, min(cw, meta.width - cx0), min(ch, meta.height - cy0)]
    else:
        content_rect = None
    content_w = content_rect[2] if content_rect else meta.width
    res_score = min(content_w / GOOD_WIDTH, 1.0)
    res_factor = 0.5 + 0.5 * res_score

    brightness = float(np.mean([s.brightness for s in samples]))
    sharp_scores = [_score_sharpness(s.sharp_var) for s in samples]
    sharpness = float(np.mean(sharp_scores))
    median_var = float(np.median([s.sharp_var for s in samples]))
    motion = float(np.mean([_score_motion(s.motion) for s in samples[1:]] or [0.0]))
    shake = _shake_score(samples)
    duplicate_ratio = float(np.mean([s.duplicate for s in samples[1:]] or [0.0]))
    scene_changes = [round(s.t, 3) for s in samples if s.scene_cut]

    windows = _build_windows(samples, meta.duration, shake, res_factor)

    flags: list[str] = []
    if brightness < DARK_LEVEL * 1.4:
        flags.append("too_dark")
    if median_var < BLUR_VARIANCE:
        flags.append("too_blurry")
    if meta.duration < MIN_CLIP_SECONDS:
        flags.append("too_short")
    if content_w < LOW_RES_WIDTH:
        flags.append("low_resolution")
    if meta.orientation == "landscape":
        flags.append("wrong_orientation")  # informational: landscape needs cropping for 9:16
    if shake > 0.6:
        flags.append("shaky")
    if duplicate_ratio > 0.5:
        flags.append("duplicate_heavy")

    if windows:
        weights = np.array([w.length for w in windows])
        quality = float(np.average([w.quality for w in windows], weights=weights))
    else:
        quality = 0.25 * _score_brightness(brightness) + 0.25 * sharpness
    if "wrong_orientation" in flags:
        quality *= 0.92
    if "too_short" in flags:
        quality *= 0.7
    quality *= res_factor
    quality = min(max(quality, 0.0), 1.0)

    blocking = {"too_dark", "too_blurry", "too_short"}
    usable = bool(windows) and not (blocking & set(flags)) and content_w >= BLOCKING_WIDTH

    return ClipAnalysis(
        clip_id=clip_id,
        metadata=meta,
        quality_score=round(quality, 3),
        motion_score=round(motion, 3),
        brightness_score=round(_score_brightness(brightness), 3),
        sharpness_score=round(sharpness, 3),
        shake_score=round(shake, 3),
        content_rect=content_rect,
        resolution_score=round(res_score, 3),
        duplicate_ratio=round(duplicate_ratio, 3),
        scene_changes=scene_changes,
        flags=flags,  # type: ignore[arg-type]
        usable=usable,
        windows=windows,
    )


def clip_summary(a: ClipAnalysis) -> dict:
    """Small, UI-friendly summary (matches the spec example) stored on the media document."""
    return {
        "clipId": a.clip_id,
        "qualityScore": a.quality_score,
        "motionScore": a.motion_score,
        "brightnessScore": a.brightness_score,
        "sharpnessScore": a.sharpness_score,
        "shakeScore": a.shake_score,
        "flags": a.flags,
        "usable": a.usable,
        "sceneChanges": len(a.scene_changes),
        "windows": len(a.windows),
        "orientation": a.metadata.orientation,
        "resolutionScore": a.resolution_score,
        "contentRect": a.content_rect,
    }
