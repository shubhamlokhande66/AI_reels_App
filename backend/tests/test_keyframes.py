"""The keyframe engine (video/keyframes.py): checking, the FFmpeg expressions, and the renderer's effects as keyframes
rendering the same picture as the effects themselves."""

from __future__ import annotations

import math
import re
import subprocess
from pathlib import Path

import pytest

from app.models.timeline import Keyframe as K
from app.models.timeline import Segment
from app.video import keyframes as kf


def _eval(expr: str, t: float) -> float:
    """Evaluate a keyframe expression the way FFmpeg does (the few functions it uses)."""
    py = expr.replace("PI", "math.pi")
    py = re.sub(r"\bclip\(", "_clip(", py)
    py = re.sub(r"\bgte\(", "_gte(", py)
    return float(eval(py, {"math": math, "pow": pow, "cos": math.cos, "t": t, "_clip": lambda v, a, b: min(max(v, a), b),
                           "_gte": lambda a, b: 1.0 if a >= b else 0.0, "max": max}))  # fmt: skip


def test_validation_orders_clamps_merges_and_says_what_changed():
    raw = [K(t=1.5, zoom=9.0), K(t=-0.2, x=0.5), K(t=0.5, opacity=1.0), K(t=0.5005, opacity=0.2), K(t=3.0, rotation=40.0), K(t=1.0)]
    out, notes = kf.validate(raw, length=2.0)
    assert [k.t for k in out] == [0.0, 0.5, 1.5, 2.0]
    assert out[1].opacity == 0.2  # the same moment twice: the later value wins
    assert out[2].zoom == 3.0 and out[3].rotation == 20.0  # in range
    text = " ".join(notes)
    assert "zoom 9 -> 3" in text and "rotation 40 -> 20" in text and "outside the 2.000 s shot" in text


@pytest.mark.parametrize("ease", ["linear", "ease_in", "ease_out", "ease_in_out", "hold"])
def test_the_ffmpeg_expression_is_the_animation(ease):
    track = [(0.2, 1.0, "linear"), (1.0, 1.4, ease), (1.6, 1.1, "ease_out")]
    expr = kf.expression(track, 1.0)
    for t in (0.0, 0.2, 0.45, 0.6, 0.99, 1.0, 1.3, 1.6, 2.5):
        assert _eval(expr, t) == pytest.approx(kf.value_at(track, t), abs=1e-6), t
    assert "if(" not in expr  # a flat sum: long animations stay short


def test_rotation_enlarges_just_enough_that_no_corner_shows():
    assert kf._rotation_cover(0, 9 / 16) == pytest.approx(1.0)
    c = kf._rotation_cover(6, 9 / 16)
    w, h, a = 9.0, 16.0, math.radians(6)
    corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    for x, y in corners:  # every frame corner, rotated back into the picture, lies inside the enlarged picture
        rx, ry = x * math.cos(a) + y * math.sin(a), -x * math.sin(a) + y * math.cos(a)
        assert abs(rx) <= w * c / 2 + 1e-9 and abs(ry) <= h * c / 2 + 1e-9


def test_presets_are_the_effects_and_merge_keeps_what_is_not_overridden():
    assert kf.preset("zoom_in", 2.0)[-1].zoom == pytest.approx(1.08) and kf.preset("beat_punch", 2.0) == []
    flash = kf.preset("flash", 2.0)
    zoom = [K(t=0, zoom=1.0), K(t=2, zoom=1.2)]
    merged = kf.merge(flash, zoom)
    assert kf.animates(merged, ["brightness"]) and [k.zoom for k in merged if k.zoom is not None] == [1.0, 1.2]
    assert not kf.animates(kf.merge(kf.preset("zoom_in", 2.0), zoom), ["x"])  # the hand-made zoom replaced the preset's


# ------------------------------------------------------------------ rendered: keyframes == the renderer's effects
@pytest.fixture(scope="module")
def source(tmp_path_factory):
    from app.core.ffmpeg import find_binary

    d = tmp_path_factory.mktemp("kf")
    src = d / "src.mp4"
    subprocess.run([find_binary("ffmpeg"), "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=480x854:r=30:d=3", "-c:v", "libx264",
                    "-pix_fmt", "yuv420p", str(src)], check=True)  # fmt: skip
    return d, src


def _render(d: Path, src: Path, name: str, seg: Segment) -> Path:
    from app.core.ffmpeg import find_binary
    from app.video.cutter import RenderConfig, SegmentPlan, SourceClip, build_segment_command

    out = d / f"{name}.mp4"
    cfg = RenderConfig(width=270, height=480, segment_preset="ultrafast")
    cmd = build_segment_command(seg, SourceClip(src, 480, 854), out, SegmentPlan(length=2.0, tail=0.0, ramp=False), cfg)
    subprocess.run([find_binary("ffmpeg"), "-y", "-v", "error", *cmd], check=True, capture_output=True, timeout=300)
    return out


def _psnr(a: Path, b: Path) -> float:
    from app.core.ffmpeg import find_binary

    log = subprocess.run([find_binary("ffmpeg"), "-i", str(a), "-i", str(b), "-lavfi", "psnr", "-f", "null", "-"],
                         capture_output=True, timeout=300).stderr.decode()  # fmt: skip
    m = re.search(r"average:([0-9.inf]+)", log)
    return float("inf") if m and m[1] == "inf" else float(m[1]) if m else 0.0


@pytest.mark.parametrize("effect", ["zoom_in", "zoom_out", "punch", "crash_zoom", "ken_burns", "pan_right", "pan_up", "flash"])
def test_an_effect_rendered_as_keyframes_looks_like_the_effect(source, effect):
    d, src = source
    base = dict(clip_id="a", video="a", source_start=0.0, source_end=2.0, timeline_start=0.0, timeline_end=2.0)
    old = _render(d, src, f"{effect}_old", Segment(**base, effect=effect))
    new = _render(d, src, f"{effect}_kf", Segment(**base, effect="none", keyframes=kf.preset(effect, 2.0)))
    # visually the same picture (above ~30 dB nobody can tell them apart). The old pans move in whole pixels at 1x size;
    # keyframes move in half pixels at 2x: same position, smoother, so a little below the zooms
    assert _psnr(old, new) >= (28 if effect.startswith("pan_") else 32), effect


def test_a_full_animation_renders(source):
    d, src = source
    seg = Segment(clip_id="a", video="a", source_start=0.0, source_end=2.0, timeline_start=0.0, timeline_end=2.0, looks=["glow"],
                  keyframes=[K(t=0, zoom=1.0, rotation=0, opacity=1, blur=0), K(t=0.8, zoom=1.3, ease="ease_out"),
                             K(t=1.2, zoom=1.05, x=0.8, blur=0.4), K(t=2, zoom=1.0, x=-0.8, rotation=6, opacity=0.4, blur=0, ease="ease_in_out")])  # fmt: skip
    out = _render(d, src, "full", seg)
    from app.core.ffmpeg import probe

    info = probe(out)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    assert (int(v["width"]), int(v["height"])) == (270, 480) and abs(float(info["format"]["duration"]) - 2.0) < 0.1


def test_the_editor_can_set_keyframes_and_looks_by_hand():
    from app.models.timeline import Timeline
    from app.video.timeline_ops import EditError, OpContext, SetKeyframes, SetLooks, apply_operations

    seg = Segment(id="s1", clip_id="a", video="a", source_start=0, source_end=2, timeline_start=0, timeline_end=2)
    tl = Timeline(duration=2, segments=[seg])
    ctx = OpContext(clip_durations={"a": 10.0})
    out = apply_operations(tl, [SetKeyframes(segment_id="s1", keyframes=[K(t=3.0, zoom=5.0), K(t=0, zoom=1.0)]),
                                SetLooks(segment_id="s1", looks=["glow", "glow", "black_white"])], ctx)  # fmt: skip
    s = out.segments[0]
    assert [(k.t, k.zoom) for k in s.keyframes] == [(0.0, 1.0), (2.0, 3.0)]  # made safe: inside the shot, zoom in range
    assert s.looks == ["glow", "black_white"]
    with pytest.raises(EditError):
        apply_operations(tl, [SetLooks(segment_id="s1", looks=["sparkles"])], ctx)


# ------------------------------------------------------------------ speed ramps
def test_a_speed_ramp_plays_the_footage_its_speed_track_says():
    ramp = [K(t=0, speed=1.0), K(t=1.0, speed=1.0), K(t=2.0, speed=3.0)]  # normal, then accelerating to 3x
    assert kf.source_seconds(ramp, 1.0) == pytest.approx(1.0, abs=1e-3)
    assert kf.source_seconds(ramp, 2.0) == pytest.approx(1.0 + 2.0, abs=1e-3)  # the second second averages 2x
    assert kf.average_speed(ramp, 2.0) == pytest.approx(1.5, abs=1e-3) and kf.slowest(ramp) == 1.0
    assert kf.source_seconds([K(t=0, zoom=1.2)], 2.0, base=0.5) == pytest.approx(1.0)  # no ramp: the shot's own speed
    for kind in ("into_drop", "slow_hit", "out_of_drop", "slow_fast_slow"):
        assert kf.has_speed(kf.ramp_preset(kind, 2.0, 1.0)), kind


def test_a_rendered_speed_ramp_shows_the_right_moment_of_the_clip(tmp_path):
    """A clip whose brightness is its own clock: every frame of the ramped shot shows the source moment the ramp says."""
    import numpy as np

    from app.core.ffmpeg import find_binary
    from app.video.cutter import RenderConfig, SegmentPlan, SourceClip, build_segment_command

    ff = find_binary("ffmpeg")
    clock = tmp_path / "clock.mp4"
    subprocess.run([ff, "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x114:r=30:d=4,geq=lum='min(255,16+N*2)':cb=128:cr=128",
                    "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv420p", str(clock)], check=True)  # fmt: skip
    ramp = kf.ramp_preset("slow_hit", 2.0, 1.0)
    seg = Segment(clip_id="a", video="a", source_start=0, source_end=kf.source_seconds(ramp, 2.0), timeline_start=0, timeline_end=2.0,
                  keyframes=ramp, speed=kf.average_speed(ramp, 2.0))  # fmt: skip
    out = tmp_path / "ramp.mp4"
    cmd = build_segment_command(seg, SourceClip(clock, 64, 114), out, SegmentPlan(length=2.0, tail=0, ramp=False),
                                RenderConfig(width=64, height=114, smooth_slowmo=False, segment_preset="ultrafast"))  # fmt: skip
    subprocess.run([ff, "-y", "-v", "error", *cmd], check=True, capture_output=True, timeout=300)

    def read(p):
        raw = subprocess.run([ff, "-v", "error", "-i", str(p), "-vf", "crop=8:8:28:52,format=gray", "-f", "rawvideo", "-"], capture_output=True).stdout
        return np.frombuffer(raw, np.uint8).reshape(-1, 64).mean(axis=1)

    src, shot = read(clock), read(out)
    assert len(shot) == 60  # exactly the shot's 2 s
    shown = np.interp(shot, src, np.arange(len(src)) / 30.0)
    want = np.array([kf.source_seconds(ramp, i / 30.0) for i in range(len(shot))])
    assert np.median(np.abs(shown - want)) < 0.02 and np.max(np.abs(shown - want)[2:]) < 0.05  # within about a frame


def test_a_hand_made_ramp_sets_the_footage_and_is_refused_past_the_clip():
    from app.models.timeline import Timeline
    from app.video.timeline_ops import EditError, OpContext, SetKeyframes, apply_operations

    tl = Timeline(duration=2, segments=[Segment(id="s1", clip_id="a", video="a", source_start=1.0, source_end=3.0, timeline_start=0, timeline_end=2)])
    out = apply_operations(tl, [SetKeyframes(segment_id="s1", keyframes=[K(t=0, speed=1.0), K(t=1.0, speed=1.0), K(t=2.0, speed=3.0)])], OpContext(clip_durations={"a": 10.0}))
    s = out.segments[0]
    assert s.source_end == pytest.approx(4.0, abs=0.01) and s.speed == pytest.approx(1.5, abs=0.01)
    with pytest.raises(EditError):
        apply_operations(tl, [SetKeyframes(segment_id="s1", keyframes=[K(t=0, speed=4.0), K(t=2, speed=4.0)])], OpContext(clip_durations={"a": 5.0}))
