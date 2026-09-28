"""Phase 3: video metadata extraction + OpenCV analysis."""

from __future__ import annotations

import subprocess

import pytest

from app.core.errors import CorruptedMedia, UnsupportedMedia
from app.core.ffmpeg import find_binary, probe
from app.video.analyzer import analyze_clip, clip_summary, parse_video_probe, read_metadata


def ff(*args):
    subprocess.run([find_binary("ffmpeg"), "-hide_banner", "-loglevel", "error", "-y", *args],
                   check=True, capture_output=True)


def enc(*extra):
    return ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", *extra]


@pytest.fixture(scope="module")
def clips(tmp_path_factory, media_dir):
    d = tmp_path_factory.mktemp("clips")
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-vf", "eq=brightness=-0.9", *enc(str(d / "dark.mp4")))
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-vf", "boxblur=25", *enc(str(d / "blurry.mp4")))
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=0.5", *enc(str(d / "short.mp4")))
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
       "-f", "lavfi", "-i", "smptebars=size=640x360:rate=30:duration=3",
       "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0", *enc(str(d / "cut.mp4")))
    ff("-f", "lavfi", "-i", "color=c=gray:size=640x360:rate=30:duration=4", *enc(str(d / "static.mp4")))
    ff("-display_rotation", "90", "-i", str(media_dir / "clip_a.mp4"), "-c", "copy", str(d / "rotated.mp4"))
    return d


def test_metadata_extraction(media_dir):
    m = read_metadata(media_dir / "clip_a.mp4")
    assert (m.width, m.height) == (1280, 720)
    assert m.orientation == "landscape"
    assert m.fps == pytest.approx(30, abs=0.1)
    assert m.duration == pytest.approx(7, abs=0.2)
    assert m.codec == "h264" and m.has_audio is False
    p = read_metadata(media_dir / "clip_portrait.mp4")
    assert p.orientation == "portrait" and (p.width, p.height) == (720, 1280)


def test_rotation_is_applied_to_display_size(clips):
    m = read_metadata(clips / "rotated.mp4")
    assert m.rotation in (90, 270)
    assert (m.width, m.height) == (720, 1280)
    assert m.orientation == "portrait"


def test_parse_probe_errors():
    with pytest.raises(UnsupportedMedia):
        parse_video_probe({"streams": [{"codec_type": "audio"}], "format": {"duration": "5"}})
    with pytest.raises(CorruptedMedia):
        parse_video_probe({"streams": [{"codec_type": "video", "width": 0, "height": 0}], "format": {"duration": "5"}})


def test_probe_rejects_garbage(tmp_path):
    bad = tmp_path / "bad.mp4"
    bad.write_bytes(b"nope" * 500)
    with pytest.raises(CorruptedMedia):
        probe(bad)


def test_good_clip_scores(media_dir):
    a = analyze_clip(media_dir / "clip_a.mp4", "clip_a")
    assert a.usable and a.windows
    assert 0.3 < a.quality_score <= 1
    for v in (a.motion_score, a.brightness_score, a.sharpness_score, a.shake_score):
        assert 0 <= v <= 1
    assert "wrong_orientation" in a.flags  # landscape source
    w = a.windows[0]
    assert 0 <= w.start < w.end <= a.metadata.duration + 0.01
    assert len(w.signature) == 24 and abs(sum(w.signature) - 1) < 0.01
    s = clip_summary(a)
    assert {"clipId", "qualityScore", "motionScore", "brightnessScore", "sharpnessScore"} <= set(s)


def test_dark_clip_is_flagged_and_unusable(clips):
    a = analyze_clip(clips / "dark.mp4", "dark")
    assert "too_dark" in a.flags and not a.usable
    assert a.brightness_score < 0.3


def test_blurry_clip_is_flagged(clips):
    a = analyze_clip(clips / "blurry.mp4", "blurry")
    assert "too_blurry" in a.flags and not a.usable
    sharp = analyze_clip(clips / "static.mp4", "s")  # flat frame is also 'blurry' - just compare scores
    good = analyze_clip(clips / "cut.mp4", "c")
    assert a.sharpness_score < good.sharpness_score


def test_short_clip_flag(clips):
    a = analyze_clip(clips / "short.mp4", "short")
    assert "too_short" in a.flags and not a.usable


def test_scene_change_detected(clips):
    a = analyze_clip(clips / "cut.mp4", "cut")
    assert any(2.5 <= t <= 3.6 for t in a.scene_changes), a.scene_changes
    assert len({w.shot for w in a.windows}) >= 2
    # windows never straddle the cut
    assert not any(w.start < 2.9 and w.end > 3.2 for w in a.windows)


def test_static_clip_has_low_motion_and_duplicates(clips):
    a = analyze_clip(clips / "static.mp4", "static")
    assert a.motion_score < 0.05
    assert a.duplicate_ratio > 0.8


def test_progress_callback(media_dir):
    seen = []
    analyze_clip(media_dir / "clip_b.mp4", "b", progress=seen.append)
    assert seen and seen[-1] > 0.8 and seen == sorted(seen)
