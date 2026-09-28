"""Detecting the real picture inside solid padding (white canvas, black bars, burned-in titles)."""

from __future__ import annotations

import subprocess

import numpy as np
import pytest

from app.core.ffmpeg import find_binary
from app.video.analyzer import analyze_clip, find_content_rect

H, W = 356, 200
RNG = np.random.default_rng(7)


def picture(h: int, w: int, t: int) -> np.ndarray:
    """A textured, moving 'video' that is clearly different from white or black."""
    base = RNG.integers(20, 200, size=(h, w)).astype(np.uint8)
    return np.roll(base, t * 3, axis=1)


def canvas(bg: int, box: tuple[int, int, int, int], n: int = 12, title: bool = False) -> list[np.ndarray]:
    """Frames of a ``bg`` canvas with a picture inside ``box`` = (y0, y1, x0, x1)."""
    y0, y1, x0, x1 = box
    frames = []
    for t in range(n):
        f = np.full((H, W), bg, np.uint8)
        f[y0:y1, x0:x1] = picture(y1 - y0, x1 - x0, t)
        if title:  # a line of title text near the top: sparse dark pixels on the padding
            f[40:52, 30:170:2] = 0
        frames.append(f)
    return frames


def close(rect, box, tol=0.03):
    y0, y1, x0, x1 = box
    exp = (x0 / W, y0 / H, x1 / W, y1 / H)
    return all(abs(a - b) <= tol for a, b in zip(rect, exp))


def test_small_video_on_white_canvas_with_title():
    box = (110, 250, 0, 200)  # full width, white above and below (like the reel in your project)
    rect = find_content_rect(canvas(255, box, title=True))
    assert rect is not None and close(rect, box)
    assert rect[1] > 52 / H  # the title line is excluded from the picture


def test_picture_padded_on_all_four_sides():
    box = (60, 300, 30, 170)
    rect = find_content_rect(canvas(255, box))
    assert rect is not None and close(rect, box)


def test_black_letterbox():
    box = (80, 276, 0, 200)
    rect = find_content_rect(canvas(0, box))
    assert rect is not None and close(rect, box)


def test_thin_white_sliver_next_to_picture_is_trimmed():
    frames = canvas(255, (110, 250, 0, 200))
    for f in frames:
        f[110:250, 0:5] = 255  # 5 px of canvas left along the picture's left edge
    rect = find_content_rect(frames)
    assert rect is not None and rect[0] >= 5 / W - 0.01


def test_full_frame_video_is_left_alone():
    frames = [picture(H, W, t) for t in range(12)]
    assert find_content_rect(frames) is None


def test_edge_that_is_not_flat_is_not_trimmed():
    """A blurred backdrop or scenery at the edge must never be cropped away."""
    frames = []
    for t in range(12):
        f = picture(H, W, t)
        f[:, :] = np.clip(f.astype(int) // 2 + np.linspace(0, 120, W).astype(int)[None, :], 0, 255)
        frames.append(f.astype(np.uint8))
    assert find_content_rect(frames) is None


def test_tiny_picture_is_rejected():
    assert find_content_rect(canvas(255, (170, 190, 90, 110))) is None  # < 12% of the frame


def test_empty_input():
    assert find_content_rect([]) is None


# ------------------------------------------------------------------ end to end with a real file
@pytest.fixture(scope="module")
def padded_clip(tmp_path_factory, media_dir):
    """720x1280 white canvas with a moving 720x405 picture in the middle (a 'reel in a reel')."""
    out = tmp_path_factory.mktemp("padded") / "padded.mp4"
    subprocess.run(
        [find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y",
         "-f", "lavfi", "-i", "color=c=white:size=720x1280:rate=30:duration=6",
         "-f", "lavfi", "-i", "testsrc2=size=720x405:rate=30:duration=6",
         "-filter_complex", "[0][1]overlay=0:437", "-c:v", "libx264", "-preset", "ultrafast",
         "-pix_fmt", "yuv420p", str(out)],
        check=True, capture_output=True,
    )  # fmt: skip
    return out


def test_analyzer_finds_the_picture_in_a_real_file(padded_clip):
    a = analyze_clip(padded_clip, "padded")
    assert a.content_rect is not None
    x, y, w, h = a.content_rect
    assert abs(y - 437) <= 14 and abs(h - 405) <= 24 and w >= 700
    assert a.metadata.width == 720 and a.metadata.height == 1280  # the file itself is untouched


def test_low_resolution_is_scored_and_flagged(padded_clip):
    a = analyze_clip(padded_clip, "padded")
    assert a.resolution_score == pytest.approx(min(a.content_rect[2] / 720, 1.0), abs=0.01)
    assert "low_resolution" not in a.flags


@pytest.mark.slow
def test_render_shows_the_picture_without_the_white_canvas(padded_clip, tmp_path):
    """Full path: analysis -> timeline segment -> FFmpeg. No white bars may survive in the output."""
    from app.models.timeline import Segment
    from app.video.cutter import RenderConfig, SourceClip, build_segment_command, plan_segments
    from app.core.ffmpeg import run_ffmpeg

    a = analyze_clip(padded_clip, "padded")
    src = SourceClip(padded_clip, 720, 1280, "padded", tuple(a.content_rect))
    for effect in ("none", "zoom_in", "punch"):  # zoom + sharpen in fit mode used to crash FFmpeg
        seg = Segment(clip_id="padded", video="p", source_start=1.0, source_end=2.5, timeline_start=0,
                      timeline_end=1.5, effect=effect)  # fmt: skip
        out = tmp_path / f"{effect}.mp4"
        run_ffmpeg(build_segment_command(seg, src, out, plan_segments([seg])[0], RenderConfig(segment_preset="ultrafast")))
        raw = subprocess.run(
            [find_binary("ffmpeg"), "-v", "error", "-ss", "0.7", "-i", str(out), "-frames:v", "1",
             "-vf", "scale=108:192", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
            capture_output=True, check=True,
        ).stdout  # fmt: skip
        img = np.frombuffer(raw, np.uint8).reshape(192, 108)
        # top and bottom rows are the blurred backdrop (dark/coloured), never the source's white canvas
        assert img[:6].mean() < 235 and img[-6:].mean() < 235, effect
        assert img[96 - 10 : 96 + 10].std() > 8, "the picture itself should be in the middle"
