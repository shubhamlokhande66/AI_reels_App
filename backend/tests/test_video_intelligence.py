"""Phase 2.2 video intelligence: shot size, composition, camera vs subject motion, empty frames, best moments and
best segments, product visibility, and that the Creative Director receives them."""

from __future__ import annotations

import subprocess

import cv2
import numpy as np
import pytest

from app.ai.reel_director import clip_facts
from app.core.ffmpeg import find_binary
from app.models.analysis import UsableWindow
from app.video import moments as mom
from app.video import shots
from app.video.analyzer import VIDEO_ANALYSIS_VERSION, analyze_clip, clip_summary
from app.video.timeline import ClipInput

W, H, FPS = 480, 270, 25


def _texture(w: int, h: int, seed: int = 1) -> np.ndarray:
    """A detailed, sharp background (blurred noise + a grid) so frames are usable and phase correlation can track it."""
    rng = np.random.default_rng(seed)
    img = cv2.GaussianBlur(rng.integers(40, 200, (h, w), dtype=np.uint8), (0, 0), 1.2)
    img[::24, :] = 230
    img[:, ::24] = 230
    return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)


def _write(path, frames) -> None:
    proc = subprocess.Popen(
        [find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        stdin=subprocess.PIPE,
    )  # fmt: skip
    for f in frames:
        proc.stdin.write(np.ascontiguousarray(f).tobytes())
    proc.stdin.close()
    assert proc.wait() == 0


@pytest.fixture(scope="module")
def pan_then_hold(tmp_path_factory):
    """The camera pans right for 2.4 s, then holds still on the same scene for 2.6 s."""
    big = _texture(W * 3, H, seed=3)
    frames = []
    for i in range(5 * FPS):
        x = min(i, int(2.4 * FPS)) * 8
        frames.append(big[:, x:x + W])
    p = tmp_path_factory.mktemp("vi") / "pan.mp4"
    _write(p, frames)
    return p


@pytest.fixture(scope="module")
def moving_object(tmp_path_factory):
    """A steady camera; a bright square sweeps across the frame."""
    bg = _texture(W, H, seed=5)
    frames = []
    for i in range(4 * FPS):
        f = bg.copy()
        x = int(20 + (W - 100) * i / (4 * FPS))
        cv2.rectangle(f, (x, 90), (x + 70, 160), (250, 250, 250), -1)
        frames.append(f)
    p = tmp_path_factory.mktemp("vi") / "object.mp4"
    _write(p, frames)
    return p


def test_camera_move_is_told_apart_from_subject_movement(pan_then_hold, moving_object):
    pan = analyze_clip(pan_then_hold, "pan")
    obj = analyze_clip(moving_object, "obj")
    assert pan.analysis_version == obj.analysis_version == VIDEO_ANALYSIS_VERSION >= 3
    assert pan.camera_motion_score > obj.camera_motion_score + 0.15  # the whole picture moves
    assert obj.subject_motion_score > pan.subject_motion_score  # something moves inside a still picture


def test_camera_arriving_is_a_best_moment(pan_then_hold):
    a = analyze_clip(pan_then_hold, "pan")
    settle = [m for m in a.moments if m.kind == "camera_settles"]
    assert settle and 2.2 <= settle[0].t <= 3.0 and 0 < settle[0].score <= 1
    segs = a.best_segments
    assert segs and segs == sorted(segs, key=lambda s: -s.score)
    for s in segs:  # every span is real, usable footage, inside one window, and spans never overlap
        assert any(w.start - 1e-6 <= s.start and s.end <= w.end + 1e-6 for w in a.windows)
        assert 0.5 <= s.end - s.start <= 2.1
    for x, y in zip(segs, segs[1:]):
        assert x.end <= y.start + 0.1 or y.end <= x.start + 0.1
    assert any(s.moment == "camera_settles" for s in segs)
    summary = clip_summary(a)
    assert {"compositionScore", "subjectScore", "shotSizes", "bestSegments"} <= set(summary)


def test_shot_size_composition_and_empty_frames():
    bg = np.full((288, 512), 60, np.uint8)
    close = bg.copy()
    cv2.circle(close, (256, 120), 110, 230, -1)
    wide = bg.copy()
    cv2.circle(wide, (256, 120), 14, 230, -1)
    lc, lw = shots.look_of(close), shots.look_of(wide)
    assert shots.shot_size(lc) == "close" and shots.shot_size(lw) in ("wide", "medium")
    assert shots.subject_value(lc) > shots.subject_value(lw)
    empty = shots.look_of(np.full((288, 512), 128, np.uint8))
    assert empty.empty and shots.composition(empty) < 0.3 and shots.subject_value(empty) == 0
    # a face: size decides the shot, and a head cut by the top edge loses composition
    face_close = shots.FrameLook((0.35, 0.10, 0.65, 0.45), 1.0, 0.05, face_h=0.35)
    face_wide = shots.FrameLook((0.47, 0.30, 0.53, 0.36), 1.0, 0.05, face_h=0.06)
    cut_head = shots.FrameLook((0.35, 0.0, 0.65, 0.35), 1.0, 0.05, face_h=0.35)
    assert shots.shot_size(face_close) == "close" and shots.shot_size(face_wide) == "wide"
    assert shots.composition(face_close) > shots.composition(cut_head)


def test_moment_detection_from_series():
    n = 40
    t = [i * 0.25 for i in range(n)]
    motion = [0.1] * n
    motion[12] = 0.9  # a hand move peaks at 3.0 s
    camera = [0.6] * 20 + [0.05] * 20  # the camera stops at 5.0 s
    faces = [False] * 30 + [True] * 10  # a face turns up at 7.5 s
    sharp = [0.8] * n
    area = [0.0] * n
    empty = [False] * n
    windows = [UsableWindow(start=0, end=10, quality=0.8, motion=0.3, brightness=0.5, sharpness=0.8)]
    found = {m.kind: m.t for m in mom.detect_moments(t, motion, camera, faces, sharp, area, empty, windows)}
    assert found["action_peak"] == 3.0 and found["camera_settles"] == 5.0 and found["face_appears"] == 7.5
    # nothing is reported outside usable footage
    late = [UsableWindow(start=8, end=10, quality=0.8, motion=0.3, brightness=0.5, sharpness=0.8)]
    assert all(m.t >= 8 for m in mom.detect_moments(t, motion, camera, faces, sharp, area, empty, late))


def test_product_visibility_only_for_product_clips():
    close = UsableWindow(start=0, end=3, quality=0.9, motion=0.2, brightness=0.5, sharpness=0.9, shot_size="close", composition=0.8, subject=0.9)
    wide = close.model_copy(update={"shot_size": "wide", "subject": 0.2})
    assert mom.product_visibility([close], "travel") is None
    assert mom.product_visibility([close], "jewelry") > mom.product_visibility([wide], "jewelry") > 0


def test_director_receives_shot_intelligence(pan_then_hold):
    a = analyze_clip(pan_then_hold, "pan")
    a.product_visibility = 0.7
    rows, alias = clip_facts([ClipInput("pan", "pan.mp4", a, None)])
    row = rows[0]
    assert {"composition", "subject", "camera_motion", "subject_motion", "shot_sizes", "best_segments", "moments"} <= set(row)
    assert row["product_visibility"] == 0.7
    assert all({"start", "end", "score", "why"} <= set(s) for s in row["best_segments"])
    assert all("shot" in w for w in row["usable_windows"])


def test_good_seconds_counts_only_the_usable_parts():
    from app.video.analyzer import good_seconds
    from tests.test_timeline import make_clip

    c = make_clip("x", dur=10.0, windows=[
        UsableWindow(start=0.0, end=3.0, quality=0.8, motion=0.3, brightness=0.5, sharpness=0.8),
        UsableWindow(start=3.0, end=4.5, quality=0.8, motion=0.3, brightness=0.5, sharpness=0.8),  # joins the one before
        UsableWindow(start=6.0, end=6.2, quality=0.8, motion=0.3, brightness=0.5, sharpness=0.8),  # too short for a shot
    ])  # fmt: skip
    assert good_seconds(c.analysis) == 4.5 and clip_summary(c.analysis)["goodSeconds"] == 4.5
    c.analysis.usable = False
    assert good_seconds(c.analysis) == 0.0
