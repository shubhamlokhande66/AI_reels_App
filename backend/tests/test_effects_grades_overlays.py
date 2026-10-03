"""Effect registry (incl. pans), colour-grade presets and text overlays: mapping, layout rules and real renders."""

from __future__ import annotations

import subprocess

import pytest

from app.captions.ass import ass_filter
from app.core.ffmpeg import find_binary, probe
from app.models.timeline import EFFECT_TYPES, Caption, Segment, TextOverlay, Timeline, Transition
from app.styles import get_style
from app.video import effects, grades, overlays
from app.video.cutter import RenderConfig, SegmentPlan, SourceClip, build_filter_graph, pan_expression
from app.video.renderer import render_timeline
from pathlib import Path


# ---------------------------------------------------------------------- effect registry
def test_effect_types_come_from_the_registry():
    assert EFFECT_TYPES == tuple(effects.available())
    for e in ("none", "zoom_in", "zoom_out", "zoom_pulse", "punch", "punch_out", "pan_left", "pan_right", "pan_up", "pan_down",
              "ken_burns", "crash_zoom", "shake", "roll", "flash", "black_white"):
        assert e in EFFECT_TYPES
    assert set(effects.catalogue()) == set(EFFECT_TYPES)  # the AI prompt is built from the same list


@pytest.mark.parametrize("asked, got", [
    ("slow_zoom_in", "zoom_in"), ("Ken Burns", "ken_burns"), ("pull-out", "zoom_out"), ("zoom out slowly", "zoom_out"),
    ("tilt up", "pan_up"), ("slide left", "pan_left"), ("camera shake", "shake"), ("beat pulse", "zoom_pulse"),
    ("hologram swirl", "none"), ("pan_right", "pan_right"), ("snap zoom", "crash_zoom"), ("monochrome", "black_white"),
    ("white flash", "flash"), ("dutch angle", "roll"), ("impact", "punch"),
])  # fmt: skip
def test_unsupported_effects_map_to_the_closest_supported(asked, got):
    name, mapped = effects.resolve_effect(asked)
    assert name == got and name in EFFECT_TYPES and mapped == (asked.strip().lower().replace(" ", "_").replace("-", "_") != got)


@pytest.mark.parametrize("asked, got", [
    ("crossfade", "dissolve"), ("fade", "fade"), ("fade to black", "fade"), ("flash", "flash"), ("light leak", "flash"),
    ("whip pan", "slide_left"), ("speed ramp", "speed_ramp"), ("glitch", "pixelize"), ("portal vortex", "cut"),
])  # fmt: skip
def test_transitions_map_onto_the_registry(asked, got):
    assert effects.resolve_transition(asked)[0] == got


def test_pan_filters():
    assert pan_expression("zoom_in", 2) is None
    x, y = pan_expression("pan_right", 2.0)
    assert "cos(PI*min(t/2.000,1))" in x and y == "(in_h-out_h)/2"
    seg = Segment(clip_id="c", video="c.mp4", source_start=0, source_end=2, timeline_start=0, timeline_end=2, effect="pan_up")
    g = build_filter_graph(seg, SourceClip(Path("x.mp4"), 1920, 1080), SegmentPlan(length=2.0, tail=0.0, ramp=False), RenderConfig(framing="fill"))
    assert "crop=w=1080:h=1920:x='(in_w-out_w)/2':y='(in_h-out_h)*(1-" in g


# ---------------------------------------------------------------------- grades
def test_grade_presets():
    assert {"luxury", "cinematic", "warm", "clean", "high_contrast", "soft", "natural"} <= set(grades.available())
    assert grades.grade_filter("luxury", "eq=x") == grades.get_grade("luxury").filter
    assert grades.grade_filter(None, "eq=style") == "eq=style"  # no preset: the style's own grade, as before
    assert grades.grade_filter("made_up", "eq=style") == "eq=style"
    assert grades.resolve_grade("Premium") == "luxury" and grades.resolve_grade("teal-orange") == "cinematic"
    assert grades.resolve_grade("neon rainbow") is None


def test_old_timelines_load_unchanged():
    old = {"duration": 5, "segments": [{"clipId": "a", "video": "a.mp4", "sourceStart": 0, "sourceEnd": 5, "timelineStart": 0, "timelineEnd": 5}]}
    tl = Timeline.model_validate(old)
    assert tl.color_grade is None and tl.overlays == [] and tl.ai is None


# ---------------------------------------------------------------------- overlays
def ov(text, start, end, **kw):
    return TextOverlay(text=text, start=start, end=end, **kw)


def test_overlays_are_readable_and_never_stacked():
    out, notes = overlays.normalize([
        ov("Gold so pure it tells a story you can see in each tiny shine", 0.0, 2.0, role="hook"),
        ov("Second", 1.5, 3.0),  # overlaps the first: moved after it
        ov("Blink", 3.0, 3.1),  # too short: extended to the minimum
        ov("Late", 9.9, 12.0),  # past the end: clamped
    ], duration=10.0)
    # your own text is kept whole up to 12 words (it wraps onto more lines); only longer text is shortened
    assert [o.text for o in out] == ["Gold so pure it tells a story you can see in each", "Second", "Blink", "Late"]
    assert out[1].start == 2.0 and out[2].end - out[2].start >= overlays.MIN_SECONDS - 1e-6
    assert out[3].end <= 10.0 and out[3].end - out[3].start >= overlays.MIN_SECONDS - 1e-6
    assert all(a.end <= b.start for a, b in zip(out, out[1:]))
    assert any("shortened" in n for n in notes)


def test_overlay_layout_stays_in_the_safe_area_and_clear_of_captions():
    W, H = 1080, 1920
    long_text = "Free shipping on every order"
    for pos in ("top", "center", "bottom"):
        for size in ("small", "medium", "large"):
            for caps in (False, True):
                layer = overlays.to_layers([ov(long_text, 0, 2, position=pos, size=size)], caps, W, H)[0]
                left, top, right, bottom = overlays.text_box(layer, W, H)
                assert left >= 0.5 - overlays.MAX_WIDTH / 2 - 1e-6 and right <= 0.5 + overlays.MAX_WIDTH / 2 + 1e-6
                assert top >= overlays.SAFE_TOP and bottom <= 1 - overlays.SAFE_BOTTOM
                if caps:
                    assert bottom < 0.72  # captions sit below ~0.78


def test_brand_typography_is_used():
    tl = Timeline(duration=5, segments=[], caption_font="Montserrat", caption_color="#FFAA00")
    look = overlays.look_for(tl)
    assert look.font == "Montserrat" and look.text_color == "#FFAA00"
    assert overlays.look_for(Timeline(duration=5, segments=[], style="luxury")).font == "Georgia"


def test_overlay_text_cannot_inject_markup(tmp_path):
    tl = Timeline(duration=4, segments=[], overlays=[ov(r"{\fs200}Buy {now}\N", 0, 2)])
    path = overlays.write_overlays_ass(tl, tmp_path / "o.ass", 1080, 1920)
    body = path.read_text(encoding="utf-8").split("[Events]")[1]
    assert "\\fs200" not in body and "{now}" not in body


# ---------------------------------------------------------------------- real render
@pytest.mark.slow
def test_pans_grades_and_overlays_render(media_dir, tmp_path):
    from app.video.analyzer import analyze_clip

    names = ["clip_a.mp4", "clip_portrait.mp4"]
    sources = {}
    for n in names:
        a = analyze_clip(media_dir / n, n)
        sources[n] = SourceClip(media_dir / n, a.metadata.width, a.metadata.height, n)
    fx = list(EFFECT_TYPES)  # every registered effect really renders
    from app.models.timeline import CropSpec

    def segs_for(framing):  # both framings: filling the 9:16 frame, and the whole picture over a blurred backdrop
        return [Segment(clip_id=names[i % 2], video=names[i % 2], source_start=1.0, source_end=2.2, timeline_start=i * 1.2,
                        timeline_end=(i + 1) * 1.2, effect=e, crop=CropSpec(framing=framing),
                        transition_in=Transition(type="dissolve" if i else "cut", duration=0.25 if i else 0)) for i, e in enumerate(fx)]  # fmt: skip
    duration = len(fx) * 1.2
    for grade, framing in [(g, "fill" if i % 2 else "fit") for i, g in enumerate(grades.available())]:
        tl = Timeline(duration=duration, segments=segs_for(framing), color_grade=grade, captions=[Caption(start=0.5, end=2.0, text="hello there")],
                      music_hits=[round(0.3 * i, 2) for i in range(1, int(duration / 0.3))],  # beat-reactive effects really render
                      overlays=[ov("New collection", 0.2, 1.8, role="hook", animation="slide_up"),
                                ov("Shop now", 5.0, 7.0, role="cta", position="bottom", animation="scale")])  # fmt: skip
        post = [ass_filter(overlays.write_overlays_ass(tl, tmp_path / f"{grade}.ass", 1080, 1920))]
        res = render_timeline(tl, sources, media_dir / "beat120.mp3", tmp_path / f"{grade}.mp4", tmp_path / f"w_{grade}", get_style("custom"),
                              RenderConfig(width=540, height=960, segment_preset="ultrafast", final_preset="ultrafast"), video_post=post)  # fmt: skip
        info = probe(res.path)
        assert float(info["format"]["duration"]) == pytest.approx(duration, abs=0.4)
        r = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-i", str(res.path), "-f", "null", "-"], capture_output=True, text=True)
        assert r.returncode == 0 and r.stderr.strip() == "", r.stderr[:300]
