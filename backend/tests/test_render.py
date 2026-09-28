"""Phase 6: crop calculation, FFmpeg command generation, and real end-to-end renders."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from app.audio.analyzer import analyze_audio
from app.core.errors import FFmpegError, InsufficientStorage, RenderTimeout, ValidationFailed
from app.core.ffmpeg import find_binary, probe, run_ffmpeg
from app.models.timeline import Segment, Timeline, Transition
from app.styles import get_style
from app.video import transitions as tr
from app.video.analyzer import analyze_clip
from app.video.composer import build_audio_filter, build_compose_command, build_video_graph
from app.video.cropper import (
    CenterCrop, FaceAwareCrop, Focus, MotionAwareCrop, SmartCrop, crop_to_aspect, get_crop_strategy,
)  # fmt: skip
from app.video.cutter import (
    RenderConfig, SourceClip, build_filter_graph, build_segment_command, plan_segments, source_read_seconds,
    zoom_expression,
)  # fmt: skip
from app.video.renderer import render_timeline
from app.video.timeline import ClipInput, build_timeline

ASPECT = 9 / 16
CFG = RenderConfig(width=1080, height=1920)
FILL = RenderConfig(width=1080, height=1920, framing="fill")


# ------------------------------------------------------------------ crop calculation
def test_center_crop_landscape():
    r = CenterCrop().compute(1920, 1080, ASPECT, Focus())
    assert (r.w, r.h) == (608, 1080) and r.y == 0  # 1080*9/16 = 607.5 -> nearest even
    assert abs(r.x - (1920 - 608) / 2) <= 2
    assert abs(r.w / r.h - ASPECT) < 0.005


def test_portrait_9_16_is_not_cropped():
    r = CenterCrop().compute(1080, 1920, ASPECT, Focus())
    assert (r.x, r.y, r.w, r.h) == (0, 0, 1080, 1920)


def test_tall_source_crops_top_bottom():
    r = CenterCrop().compute(1000, 2400, ASPECT, Focus())
    assert r.w == 1000 and r.h == 1778 and r.x == 0


def test_focus_shifts_crop_and_is_clamped():
    left = FaceAwareCrop().compute(1920, 1080, ASPECT, Focus(0.1, 0.5, "face"))
    right = FaceAwareCrop().compute(1920, 1080, ASPECT, Focus(0.9, 0.5, "face"))
    assert left.x == 0 and right.x + right.w == 1920 or right.x + right.w >= 1918
    mid = FaceAwareCrop().compute(1920, 1080, ASPECT, Focus(0.5, 0.5, "face"))
    assert left.x < mid.x < right.x
    # a face at the very edge never pushes the window outside the frame
    edge = crop_to_aspect(1920, 1080, ASPECT, 1.5, 0.5)
    assert 0 <= edge.x and edge.x + edge.w <= 1920


def test_strategies_respect_focus_source():
    face = Focus(0.9, 0.5, "face")
    motion = Focus(0.9, 0.5, "motion")
    none = Focus(0.9, 0.5, "center")
    assert FaceAwareCrop().compute(1920, 1080, ASPECT, motion) == CenterCrop().compute(1920, 1080, ASPECT, motion)
    assert MotionAwareCrop().compute(1920, 1080, ASPECT, none) == CenterCrop().compute(1920, 1080, ASPECT, none)
    m = MotionAwareCrop().compute(1920, 1080, ASPECT, motion)
    f = MotionAwareCrop().compute(1920, 1080, ASPECT, face)
    assert CenterCrop().compute(1920, 1080, ASPECT, motion).x < m.x < f.x  # damped vs undamped
    assert isinstance(get_crop_strategy("smart"), SmartCrop) and get_crop_strategy("bogus").name == "smart"


def test_all_crops_have_even_dimensions():
    for w, h in [(1919, 1079), (1281, 721), (853, 481)]:
        r = crop_to_aspect(w, h, ASPECT, 0.37, 0.5)
        assert all(v % 2 == 0 for v in (r.x, r.y, r.w, r.h))


# ------------------------------------------------------------------ command generation
def seg(**kw):
    base = dict(clip_id="c1", video="c1.mp4", source_start=2.0, source_end=3.0, timeline_start=0.0, timeline_end=1.0)
    base.update(kw)
    return Segment(**base)


SRC = SourceClip(path=Path("/tmp/x/clip.mp4"), width=1920, height=1080)


def test_segment_command_shape_and_args_are_a_list():
    s = seg()
    plan = plan_segments([s])[0]
    cmd = build_segment_command(s, SRC, Path("out.mp4"), plan, FILL)
    assert isinstance(cmd, list) and all(isinstance(a, str) for a in cmd)
    assert cmd[:2] == ["-ss", "2.000"]
    assert cmd.index("-ss") < cmd.index("-i") and "-an" in cmd
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "crop=608:1080" in graph and "scale=1080:1920" in graph and "fps=30" in graph
    assert graph.endswith("[v]") and "setsar=1" in graph


def test_slow_motion_stretches_pts_and_reads_less_source():
    s = seg(speed=0.5, source_start=1.0, source_end=1.5, timeline_end=1.0)
    plan = plan_segments([s])[0]
    graph = build_filter_graph(s, SRC, plan, CFG)
    assert "setpts=(PTS-STARTPTS)/0.5000" in graph
    assert source_read_seconds(s, plan) == pytest.approx(1.0 * 0.5 + 0.15)


def test_zoom_effects_use_time_expressions():
    assert zoom_expression("none", 1) is None
    assert "min(t/2.000,1)" in zoom_expression("zoom_in", 2)
    assert "1-min" in zoom_expression("zoom_out", 2)
    assert "max(0,1-t/" in zoom_expression("punch", 2)
    s = seg(effect="zoom_in")
    g = build_filter_graph(s, SRC, plan_segments([s])[0], FILL)
    assert "eval=frame" in g and "crop=1080:1920" in g


def test_plan_tail_and_ramp_come_from_next_transition():
    a = seg()
    b = seg(timeline_start=1.0, timeline_end=2.0, transition_in=Transition(type="dissolve", duration=0.3))
    c = seg(timeline_start=2.0, timeline_end=3.0, transition_in=Transition(type="speed_ramp", duration=0.3))
    d = seg(timeline_start=3.0, timeline_end=4.0)
    p = plan_segments([a, b, c, d])
    assert (p[0].tail, p[0].ramp) == (0.3, False)
    assert (p[1].tail, p[1].ramp) == (0.0, True)  # ramp applies to the segment *before* the ramp transition
    assert p[3].tail == 0 and p[0].out_length == pytest.approx(1.3)
    ramp_graph = build_filter_graph(b, SRC, p[1], CFG)
    assert "split[a][b]" in ramp_graph and "concat=n=2" in ramp_graph


def test_compose_graph_offsets_account_for_overlap():
    segs = [
        seg(timeline_start=0, timeline_end=2),
        seg(timeline_start=2, timeline_end=4, transition_in=Transition(type="dissolve", duration=0.5)),
        seg(timeline_start=4, timeline_end=6, transition_in=Transition(type="cut")),
        seg(timeline_start=6, timeline_end=8, transition_in=Transition(type="flash", duration=0.25)),
    ]
    plans = plan_segments(segs)
    graph, total = build_video_graph(segs, plans, CFG)
    assert "xfade=transition=fade:duration=0.500:offset=2.000" in graph  # starts at the cut point
    assert "concat=n=2:v=1:a=0" in graph
    assert "xfade=transition=fadewhite:duration=0.250:offset=6.000" in graph
    assert total == pytest.approx(8.0)  # overlaps do not change the reel length


def test_compose_command_maps_audio_and_targets_reel_format():
    style = get_style("luxury")
    s = seg(timeline_start=0, timeline_end=15)
    plans = plan_segments([s])
    cmd = build_compose_command([s], plans, [Path("seg0.mp4")], Path("song.mp3"), 12.5, 15, style, CFG, Path("o.mp4"))
    j = " ".join(cmd)
    for needle in ("libx264", "aac", "+faststart", "yuv420p", "loudnorm", "-ss 12.500", "fade=t=in", "[a]"):
        assert needle in j, needle
    assert cmd[-1] == "o.mp4"
    assert "afade=t=out" in build_audio_filter(15, style, CFG)


def test_user_supplied_text_cannot_inject_arguments(tmp_path):
    """File names are display-only; even a hostile clip name never reaches the command."""
    evil = 'x";rm -rf /;".mp4'
    s = seg(video=evil)
    cmd = build_segment_command(s, SRC, tmp_path / "o.mp4", plan_segments([s])[0], CFG)
    assert not any(evil in a for a in cmd)


def test_registry_extensible():
    tr.register(tr.TransitionSpec("wipe_test", "xfade", "wipeleft"))
    assert tr.get_transition("wipe_test").xfade == "wipeleft"
    assert tr.get_transition("does-not-exist").name == "cut"


# ------------------------------------------------------------------ run_ffmpeg behaviour
def test_run_ffmpeg_reports_failure_details(tmp_path):
    with pytest.raises(FFmpegError) as e:
        run_ffmpeg(["-i", str(tmp_path / "missing.mp4"), str(tmp_path / "o.mp4")])
    assert e.value.code in {"FFMPEG_RENDER_FAILED", "CORRUPTED_MEDIA"} and e.value.details


def test_run_ffmpeg_timeout(tmp_path):
    with pytest.raises(RenderTimeout):
        run_ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "600", "-f", "null", "-"], timeout=1)


# ------------------------------------------------------------------ real renders
def _sources(media_dir, names):
    out, clips = {}, []
    for n in names:
        a = analyze_clip(media_dir / n, n)
        out[n] = SourceClip(media_dir / n, a.metadata.width, a.metadata.height, n)
        clips.append(ClipInput(n, n, a))
    return out, clips


def _assert_playable(path: Path, duration: float, w=1080, h=1920):
    info = probe(path)
    v = next(s for s in info["streams"] if s["codec_type"] == "video")
    a = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert (v["codec_name"], int(v["width"]), int(v["height"])) == ("h264", w, h)
    assert v["pix_fmt"] == "yuv420p" and a["codec_name"] == "aac"
    assert float(info["format"]["duration"]) == pytest.approx(duration, abs=0.4)
    # decode every frame; any error fails the process
    r = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-i", str(path), "-f", "null", "-"],
                       capture_output=True, text=True)
    assert r.returncode == 0 and r.stderr.strip() == "", r.stderr[:500]


@pytest.fixture(scope="module")
def prepared(media_dir):
    names = ["clip_a.mp4", "clip_b.mp4", "clip_c.mp4", "clip_d.mp4", "clip_portrait.mp4"]
    sources, clips = _sources(media_dir, names)
    audio = analyze_audio(media_dir / "beat120.mp3")
    return sources, clips, audio


@pytest.mark.slow
def test_acceptance_5_clips_mp3_15s_fast_trending(prepared, media_dir, tmp_path):
    sources, clips, audio = prepared
    style = get_style("fast_trending")
    tl = build_timeline(audio, clips, 15, style, seed=0)
    progress: list[float] = []
    res = render_timeline(
        tl, sources, media_dir / "beat120.mp3", tmp_path / "out" / "reel.mp4", tmp_path / "work",
        style, RenderConfig(), progress.append,
    )  # fmt: skip
    _assert_playable(res.path, 15)
    assert res.width == 1080 and res.height == 1920 and res.size > 50_000
    assert progress == sorted(progress) and progress[-1] == 1.0
    assert not (tmp_path / "work").exists(), "temporary files must be cleaned up"
    assert len({s.clip_id for s in tl.segments}) == 5


@pytest.mark.slow
@pytest.mark.parametrize("style_id", ["cinematic", "luxury", "food", "travel"])
def test_every_style_renders_a_playable_reel(prepared, media_dir, tmp_path, style_id):
    sources, clips, audio = prepared
    style = get_style(style_id)
    tl = build_timeline(audio, clips, 10, style, seed=2)
    res = render_timeline(
        tl, sources, media_dir / "beat120.mp3", tmp_path / "r.mp4", tmp_path / "w", style,
        RenderConfig(segment_preset="ultrafast", final_preset="ultrafast"),
    )  # fmt: skip
    _assert_playable(res.path, 10)


@pytest.mark.slow
def test_all_transition_types_render(prepared, media_dir, tmp_path):
    """Every registered transition (the full paid-app-style catalogue) is a real FFmpeg xfade — render all of them at once."""
    sources, clips, audio = prepared
    style = get_style("custom")
    kinds = list(tr.available())
    assert len(kinds) >= 50  # the expanded catalogue; fails loudly if the registry ever shrinks back down
    effects = ["none", "zoom_in", "zoom_out", "punch", "zoom_pulse", "punch_out"]
    segs = []
    for i, k in enumerate(kinds):
        clip = clips[i % len(clips)]
        segs.append(Segment(
            clip_id=clip.clip_id, video=clip.name, source_start=1.0, source_end=2.5,
            timeline_start=i * 1.5, timeline_end=(i + 1) * 1.5,
            effect=effects[i % len(effects)],
            transition_in=Transition(type=k, duration=0.0 if k in ("cut",) else 0.3),
        ))  # fmt: skip
    duration = len(kinds) * 1.5
    tl = Timeline(duration=duration, segments=segs)
    res = render_timeline(
        tl, sources, media_dir / "beat120.mp3", tmp_path / "t.mp4", tmp_path / "w", style,
        RenderConfig(segment_preset="ultrafast", final_preset="ultrafast"),
    )  # fmt: skip
    _assert_playable(res.path, duration)


@pytest.mark.slow
def test_slow_motion_and_source_shortfall(prepared, media_dir, tmp_path):
    """A shot that asks for more source than exists must still come out full length."""
    sources, clips, audio = prepared
    seg1 = Segment(clip_id="clip_a.mp4", video="a", source_start=6.5, source_end=7.5, timeline_start=0,
                   timeline_end=2, speed=0.5)
    seg2 = Segment(clip_id="clip_b.mp4", video="b", source_start=0, source_end=2, timeline_start=2, timeline_end=4)
    res = render_timeline(
        Timeline(duration=4, segments=[seg1, seg2]), sources, media_dir / "beat120.mp3",
        tmp_path / "s.mp4", tmp_path / "w", get_style("custom"),
        RenderConfig(segment_preset="ultrafast", final_preset="ultrafast"),
    )  # fmt: skip
    _assert_playable(res.path, 4)


def test_render_preflight_errors(prepared, media_dir, tmp_path):
    sources, clips, audio = prepared
    style = get_style("custom")
    cfg = RenderConfig()
    with pytest.raises(ValidationFailed) as e:
        render_timeline(Timeline(duration=1, segments=[]), sources, media_dir / "beat120.mp3", tmp_path / "o.mp4",
                        tmp_path / "w", style, cfg)  # fmt: skip
    assert e.value.code == "EMPTY_TIMELINE"
    s = Segment(clip_id="ghost", video="g", source_start=0, source_end=1, timeline_start=0, timeline_end=1)
    with pytest.raises(ValidationFailed) as e:
        render_timeline(Timeline(duration=1, segments=[s]), sources, media_dir / "beat120.mp3", tmp_path / "o.mp4",
                        tmp_path / "w", style, cfg)  # fmt: skip
    assert e.value.code == "MISSING_SOURCE"
    real = Segment(clip_id="clip_a.mp4", video="a", source_start=0, source_end=1, timeline_start=0, timeline_end=1)
    with pytest.raises(InsufficientStorage):
        render_timeline(Timeline(duration=1, segments=[real]), sources, media_dir / "beat120.mp3", tmp_path / "o.mp4",
                        tmp_path / "w", style, cfg, free_bytes=lambda: 1024)  # fmt: skip


# ------------------------------------------------------------------ framing: content rect, fill vs fit
def test_choose_framing_auto():
    from app.video.cutter import choose_framing

    assert choose_framing(1920, 1080, CFG) == "fit"  # 16:9 would lose 68% of the width
    assert choose_framing(1080, 1080, CFG) == "fit"  # square would lose 44%
    assert choose_framing(1080, 1350, CFG) == "fill"  # 4:5 loses ~30%: cover-crop is fine
    assert choose_framing(1080, 1920, CFG) == "fill"
    assert choose_framing(1920, 1080, RenderConfig(framing="fill")) == "fill"


def test_fit_mode_builds_blurred_backdrop_graph():
    g = build_filter_graph(seg(), SRC, plan_segments([seg()])[0], CFG)
    assert "split[bgs][fgs]" in g and "gblur" in g and "overlay=x=(W-w)/2:y=(H-h)/2" in g
    assert "scale=1080:1080:flags=lanczos" in g or "scale=1080:" in g  # whole picture at full width
    assert g.endswith("[v]")


def test_content_rect_is_cropped_before_framing():
    src = SourceClip(path=Path("x.mp4"), width=720, height=1280, content=(0, 294, 720, 688))
    g = build_filter_graph(seg(), src, plan_segments([seg()])[0], CFG)
    assert g.startswith("[0:v]crop=720:688:0:294")  # the white canvas is gone before anything else
    fill = build_filter_graph(seg(), src, plan_segments([seg()])[0], FILL)
    m = __import__("re").search(r"crop=(\d+):(\d+):(\d+):(\d+)", fill)
    w, h, x, y = map(int, m.groups())
    assert 294 <= y and y + h <= 294 + 688 and x + w <= 720  # the 9:16 window stays inside the picture


def test_big_upscales_get_denoise_and_sharpen_small_ones_do_not():
    from app.video.cutter import _enhance

    assert _enhance(1.2) == ("", "")
    pre, post = _enhance(3.0)
    assert pre.startswith("hqdn3d") and post.startswith("unsharp")
    low = SourceClip(path=Path("x.mp4"), width=360, height=640)
    g = build_filter_graph(seg(), low, plan_segments([seg()])[0], FILL)
    assert "hqdn3d" in g and "unsharp" in g
    hi = SourceClip(path=Path("x.mp4"), width=1080, height=1920)
    assert "hqdn3d" not in build_filter_graph(seg(), hi, plan_segments([seg()])[0], FILL)


# ------------------------------------------------------------------ long Reels are joined in chunks
def _transition_timeline(clips, n=8, each=1.5):
    kinds = ["cut", "fade", "dissolve", "zoom", "slide", "blur", "flash", "speed_ramp"]
    segs = []
    for i in range(n):
        clip = clips[i % len(clips)]
        k = kinds[i % len(kinds)]
        segs.append(Segment(
            clip_id=clip.clip_id, video=clip.name, source_start=1.0, source_end=1.0 + each,
            timeline_start=i * each, timeline_end=(i + 1) * each, effect=["none", "zoom_in", "zoom_out", "punch"][i % 4],
            transition_in=Transition(type=k, duration=0.0 if k == "cut" else 0.3),
        ))  # fmt: skip
    return Timeline(duration=n * each, segments=segs)


def _psnr(a: Path, b: Path) -> float:
    r = subprocess.run([find_binary("ffmpeg"), "-hide_banner", "-i", str(a), "-i", str(b), "-lavfi", "psnr", "-f", "null", "-"],
                       capture_output=True, text=True)
    line = [ln for ln in r.stderr.splitlines() if "average:" in ln][-1]
    return float(line.split("average:")[1].split()[0])


@pytest.mark.slow
def test_chunked_join_matches_the_flat_join(prepared, media_dir, tmp_path, monkeypatch):
    """Long Reels are joined chunk by chunk: same length, same picture (within one extra encode), audio intact."""
    import app.video.renderer as rr

    sources, clips, audio = prepared
    style = get_style("custom")
    tl = _transition_timeline(clips, n=8)  # every transition type, incl. cuts and a speed ramp
    cfg = RenderConfig(segment_preset="ultrafast", final_preset="ultrafast")
    flat = render_timeline(tl, sources, media_dir / "beat120.mp3", tmp_path / "flat.mp4", tmp_path / "w1", style, cfg)
    monkeypatch.setattr(rr, "CHUNK_AT", 3)
    monkeypatch.setattr(rr, "CHUNK_SIZE", 3)  # 8 shots -> chunks of 3, 3, 2 (boundaries fall on different transitions)
    seen: list[float] = []
    chunked = render_timeline(tl, sources, media_dir / "beat120.mp3", tmp_path / "chunked.mp4", tmp_path / "w2", style, cfg, seen.append)
    _assert_playable(chunked.path, tl.duration)
    assert chunked.duration == pytest.approx(flat.duration, abs=0.1)
    assert _psnr(flat.path, chunked.path) > 30  # the same picture: only one more generation of compression
    assert seen == sorted(seen) and seen[-1] == 1.0
    assert not (tmp_path / "w2").exists()


def test_chunk_command_is_a_list_and_can_carry_the_shots_own_audio():
    segs = [Segment(clip_id="a", video="a", source_start=0, source_end=2, timeline_start=i * 2, timeline_end=i * 2 + 2,
                    transition_in=Transition(type="dissolve" if i else "cut", duration=0.3 if i else 0.0)) for i in range(3)]
    plans = plan_segments(segs)
    from app.video.composer import build_chunk_command

    cmd, length = build_chunk_command(segs, plans, [Path(f"s{i}.mp4") for i in range(3)], Path("c.mp4"), CFG, with_audio=True)
    assert all(isinstance(x, str) for x in cmd) and length == pytest.approx(6.0 + 0.0, abs=0.7)
    graph = cmd[cmd.index("-filter_complex") + 1]
    assert "acrossfade" in graph and "[v]" in graph and "-c:a" in cmd
    silent, _ = build_chunk_command(segs, plans, [Path(f"s{i}.mp4") for i in range(3)], Path("c.mp4"), CFG, with_audio=False)
    assert "-an" in silent and "acrossfade" not in silent[silent.index("-filter_complex") + 1]


@pytest.mark.slow
def test_a_two_minute_reel_renders_through_the_chunked_path(prepared, media_dir, tmp_path):
    """Custom lengths: 2 minutes = ~100 shots. Must come out at the requested length, playable, with temp files removed."""
    import time

    from tests.conftest import make_click_track
    from app.video import renderer as rr

    sources, clips, _ = prepared
    song = tmp_path / "long.mp3"
    make_click_track(song, bpm=120, seconds=200)
    audio = analyze_audio(song)
    style = get_style("fast_trending")
    tl = build_timeline(audio, clips, 120, style, seed=1)
    assert tl.duration == 120 and len(tl.segments) > rr.CHUNK_AT * 2  # really exercises the chunked path
    t0 = time.monotonic()
    res = render_timeline(tl, sources, song, tmp_path / "long.mp4", tmp_path / "w", style,
                          RenderConfig(segment_preset="ultrafast", final_preset="ultrafast"))  # fmt: skip
    print(f"\n2 min reel: {len(tl.segments)} shots rendered in {time.monotonic() - t0:.0f}s")
    _assert_playable(res.path, 120)
    assert not (tmp_path / "w").exists()


@pytest.mark.slow
def test_a_reel_with_accent_hits_renders_at_exactly_the_planned_length(prepared, media_dir, tmp_path):
    """Long shots split at strong hits (with a quick punch) must still render to the exact length, playable, with no error frames."""
    sources, clips, audio = prepared
    assert audio.accents, "the analysed click track should have accents"
    steady = get_style("fast_trending").with_overrides(cut_beats_high=4, cut_beats_low=4)  # 2 s shots
    with_hits = build_timeline(audio, clips, 12, steady, seed=3)
    without = build_timeline(audio.model_copy(update={"accents": [], "accent_strengths": []}), clips, 12, steady, seed=3)
    assert len(with_hits.segments) > len(without.segments) and any("strong hits" in n for n in with_hits.notes)
    for prev, nxt in zip(with_hits.segments, with_hits.segments[1:]):
        assert nxt.timeline_start == prev.timeline_end
    res = render_timeline(with_hits, sources, media_dir / "beat120.mp3", tmp_path / "hits.mp4", tmp_path / "w", steady,
                          RenderConfig(segment_preset="ultrafast", final_preset="ultrafast"))  # fmt: skip
    _assert_playable(res.path, 12)
