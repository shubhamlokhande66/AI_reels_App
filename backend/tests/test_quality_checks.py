"""Quality control: the new timeline checks (rhythm, registries, framing, on-screen text) and file checks (frozen
frames, loudness, abrupt start), each with its deterministic fix."""

from __future__ import annotations

import subprocess

import pytest

from app.core.ffmpeg import find_binary
from app.models.timeline import Caption, Segment, TextOverlay, Timeline, Transition
from app.quality.checker import check_render_file, check_timeline, fix_for_loudness, fix_operations
from app.video.timeline_ops import OpContext, apply_operations


def seg(i, start, end, **kw):
    return Segment(id=f"s{i}", clip_id="c", video="c.mp4", source_start=0, source_end=end - start, timeline_start=start, timeline_end=end, **kw)


def codes(tl, target=None):
    return [i.code for i in check_timeline(tl, target)]


def ctx():
    return OpContext(clip_durations={"c": 60.0})


def fixed(tl, code, segment_id=None):
    ops = fix_operations(code, tl, tl.duration, segment_id)
    assert ops, code
    return apply_operations(tl, ops[0], ctx())


def test_long_shot_is_flagged_and_split():
    tl = Timeline(duration=12, style="fast_trending", segments=[seg(0, 0, 2), seg(1, 2, 12)])
    assert "LONG_SHOT" in codes(tl)
    after = fixed(tl, "LONG_SHOT", "s1")
    assert len(after.segments) == 3 and "LONG_SHOT" not in codes(after)


def test_flicker_runs_are_flagged():
    segs = [seg(i, i * 0.3, (i + 1) * 0.3) for i in range(5)] + [seg(5, 1.5, 4.0)]
    assert "RAPID_CUTS" in codes(Timeline(duration=4.0, segments=segs))
    ok = [seg(i, i * 1.0, (i + 1) * 1.0) for i in range(4)]
    assert "RAPID_CUTS" not in codes(Timeline(duration=4.0, segments=ok))


def test_unsupported_effects_transitions_and_crops_are_repaired():
    tl = Timeline(duration=4, segments=[seg(0, 0, 2, effect="slow_zoom_in"),
                                        seg(1, 2, 4, focus_x=1.7, transition_in=Transition(type="whip_pan", duration=0.2))])  # fmt: skip
    found = set(codes(tl))
    assert {"UNSUPPORTED_EFFECT", "UNSUPPORTED_TRANSITION", "INVALID_CROP"} <= found
    assert fixed(tl, "UNSUPPORTED_EFFECT", "s0").segments[0].effect == "zoom_in"
    assert fixed(tl, "UNSUPPORTED_TRANSITION", "s1").segments[1].transition_in.type == "slide_left"
    assert fixed(tl, "INVALID_CROP", "s1").segments[1].crop.framing == "auto"


def test_on_screen_text_checks_and_tidy():
    tl = Timeline(duration=6, segments=[seg(0, 0, 6)], captions=[Caption(start=0, end=3, text="hello")],
                  overlays=[TextOverlay(text="Big sale today", start=0.2, end=2.0, position="bottom"),
                            TextOverlay(text="Second line", start=1.0, end=1.3)])  # fmt: skip
    found = set(codes(tl))
    assert "TEXT_TIMING" in found and "CAPTION_OVERLAP" in found
    after = fixed(tl, "TEXT_TIMING")
    assert all(a.end <= b.start for a, b in zip(after.overlays, after.overlays[1:]))
    after = fixed(after, "CAPTION_OVERLAP")
    assert after.overlays[0].position == "top" and "CAPTION_OVERLAP" not in codes(after)


def test_grade_and_overlays_can_be_edited_as_undoable_operations():
    from app.video.timeline_ops import EditError, SetGrade, SetOverlays

    tl = Timeline(duration=6, segments=[seg(0, 0, 6)])
    tl = apply_operations(tl, [SetGrade(grade="luxury"), SetOverlays(overlays=[TextOverlay(text="Shop now", start=5.5, end=9, role="cta")])], ctx())
    assert tl.color_grade == "luxury" and tl.overlays[0].end == 6.0
    with pytest.raises(EditError):
        apply_operations(tl, [SetGrade(grade="rainbow")], ctx())


def _render(tmp_path, name, vf_src, af_src, seconds=4):
    out = tmp_path / name
    subprocess.run([find_binary("ffmpeg"), "-v", "error", "-y", "-f", "lavfi", "-i", vf_src, "-f", "lavfi", "-i", af_src, "-t", str(seconds),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)], check=True)  # fmt: skip
    return out


def test_file_checks_find_frozen_frames_loudness_and_abrupt_start(tmp_path):
    frozen_loud = _render(tmp_path, "a.mp4", "color=c=blue:size=320x568:rate=30", "sine=frequency=440:sample_rate=44100,volume=6")
    issues = {i.code: i for i in check_render_file(frozen_loud, None, 4.0)}
    assert "DUPLICATE_FRAMES" in issues and "AUDIO_LOUDNESS" in issues and "AUDIO_ABRUPT_START" in issues
    assert "too loud" in issues["AUDIO_LOUDNESS"].message
    moving_quiet = _render(tmp_path, "b.mp4", "testsrc2=size=320x568:rate=30", "sine=frequency=440:sample_rate=44100,volume=0.01,afade=t=in:d=1")
    found = {i.code for i in check_render_file(moving_quiet, None, 4.0)}
    assert "DUPLICATE_FRAMES" not in found and "AUDIO_ABRUPT_START" not in found and "AUDIO_LOUDNESS" in found


def test_loudness_fix_moves_the_music_toward_the_target():
    tl = Timeline(duration=4, segments=[seg(0, 0, 4)], music_volume=1.0)
    loud = apply_operations(tl, fix_for_loudness(tl, -6.0)[0], ctx())
    quiet = apply_operations(tl, fix_for_loudness(tl, -30.0)[0], ctx())
    assert loud.music_volume < 1.0 < quiet.music_volume <= 2.0
