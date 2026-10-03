"""Instagram mode: the edit is tuned to Instagram's ranking signals, checked against its recommendation rules, and the post
copy is written the way Instagram is searched."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.timeline import Segment, TextOverlay, Timeline, Watermark
from app.platforms import instagram
from app.schemas.project import GenerateRequest, ProjectSettings, ProjectUpdate
from app.styles import get_style, list_styles
from app.video.composer import watermark_filter
from app.video.cutter import RenderConfig
from app.video.timeline import build_timeline, plan_slots
from tests.test_timeline import make_audio, make_clip


def test_platform_setting_defaults_to_none_and_accepts_instagram():
    assert ProjectSettings().platform == "none"
    assert ProjectSettings(platform="instagram").platform == "instagram"
    assert ProjectUpdate(platform="instagram").platform == "instagram"
    assert GenerateRequest(platform="instagram").platform == "instagram"
    with pytest.raises(ValidationError):
        ProjectSettings(platform="myspace")


@pytest.mark.parametrize("style_id", [s.id for s in list_styles()])
def test_tuned_style_cuts_by_the_hook_deadline(style_id):
    audio = make_audio(bpm=90, duration=40)  # slow music: untuned styles often hold the first shot for 2.6 s or more
    style = instagram.tune_style(get_style(style_id))
    slots = plan_slots(audio, 0.0, 20.0, style)
    assert slots[0].end <= instagram.HOOK_CUT + 1e-6
    assert style.fade_in_out == 0 and style.opening == "hook" and style.loop_end
    assert style.max_segment <= max(instagram.MAX_SHOT, style.min_segment)


def test_hook_opening_prefers_the_moving_bright_clip():
    clips = [make_clip("still", motion=0.05, sig_bin=0), make_clip("action", motion=0.9, sig_bin=4), make_clip("mid", motion=0.4, sig_bin=8)]
    style = instagram.tune_style(get_style("cinematic"))
    tl = build_timeline(make_audio(duration=40), clips, 15, style, seed=1)
    assert tl.segments[0].clip_id == "action"


def test_loop_ending_prefers_a_shot_that_looks_like_the_opening():
    # clip a and clip a2 share colours; the closing shot should come from the opening's look when it can
    clips = [make_clip("a", motion=0.9, sig_bin=0, dur=4), make_clip("b", motion=0.3, sig_bin=4), make_clip("c", motion=0.3, sig_bin=8),
             make_clip("a2", motion=0.3, sig_bin=0, dur=4)]
    tl = build_timeline(make_audio(duration=40), clips, 10, instagram.tune_style(get_style("fast_trending")), seed=0)
    assert tl.segments[0].clip_id == "a"
    assert tl.segments[-1].clip_id in ("a", "a2")


def _timeline(**kw) -> Timeline:
    segs = [Segment(clip_id="c1", video="c1.mp4", source_start=0, source_end=1.5, timeline_start=0, timeline_end=1.5),
            Segment(clip_id="c2", video="c2.mp4", source_start=0, source_end=2.5, timeline_start=1.5, timeline_end=4.0),
            Segment(clip_id="c1", video="c1.mp4", source_start=3, source_end=6, timeline_start=4.0, timeline_end=10.0)]
    return Timeline(duration=10.0, segments=segs, **kw)


def test_polish_puts_the_hook_on_the_first_frame_and_moves_the_logo_to_the_end():
    tl = _timeline(watermark=Watermark(logo_key="logo.png"))
    notes = instagram.polish_timeline(tl, hook_text="3 mistakes everyone makes", cta_text="Save this for later")
    hook = next(o for o in tl.overlays if o.role == "hook")
    assert hook.start == 0.0 and hook.text == "3 mistakes everyone makes"
    assert any(o.role == "cta" and o.end == 10.0 for o in tl.overlays)
    assert tl.watermark.show_from == pytest.approx(8.0)
    assert tl.music_fade_in == instagram.MUSIC_FADE_IN
    assert notes


def test_polish_moves_an_ai_hook_to_zero():
    tl = _timeline(overlays=[TextOverlay(text="Wait for it", start=0.3, end=2.0, role="hook")])
    instagram.polish_timeline(tl)
    assert tl.overlays[0].start == 0.0


def test_end_only_watermark_renders_with_an_enable_window():
    cfg = RenderConfig(width=1080, height=1920)
    assert "enable" not in watermark_filter(1, Watermark(logo_key="x"), cfg)
    f = watermark_filter(1, Watermark(logo_key="x", show_from=13.0), cfg)
    assert "enable='gte(t,13.000)'" in f


def test_finalize_copy_caps_hashtags_and_adds_send_line_and_alt_text():
    copy = {"title": "Gold necklace", "description": "Our new gold necklace collection.", "hashtags": [f"tag{i}" for i in range(8)] + ["viral", "#fyp"]}
    out = instagram.finalize_copy(copy, name="Namora", brief="Luxury gold necklace collection.", subjects=["a gold necklace on a model"])
    assert len(out["hashtags"]) == 5 and "viral" not in out["hashtags"]
    assert out["sendPrompt"].startswith("Send this")
    assert "gold necklace" in out["altText"] and out["platform"] == "instagram"


def test_finalize_copy_without_ai_builds_a_marked_template():
    out = instagram.finalize_copy(None, name="Pune street food", brief="Best vada pav in Pune. Crispy and spicy.", language="hinglish")
    assert out["source"] == "template"
    assert out["description"] == "Best vada pav in Pune."
    assert "vada" in out["hashtags"] and "pune" in out["hashtags"]
    assert out["sendPrompt"] == instagram.SEND_PROMPTS["hinglish"]


def _clips():
    return {c.clip_id: c.analysis for c in (make_clip("c1", motion=0.8, sig_bin=0), make_clip("c2", motion=0.4, sig_bin=4))}


def test_report_scores_a_good_reel_high():
    tl = _timeline(overlays=[TextOverlay(text="Wait for it", start=0.0, end=2.0, role="hook")], music_fade_in=0.05)
    copy = instagram.finalize_copy({"title": "t", "description": "A clear caption with words people search for.", "hashtags": ["a", "b", "c"]}, name="x")
    rep = instagram.build_report(tl, _clips(), audio_mode="music", brief="For new runners", cta_text="", post_copy=copy,
                                 render=(1080, 1920, 6_000_000, 10.0), preview=False)
    by = {c["id"]: c["status"] for c in rep["checks"]}
    assert by["first_cut"] == "pass" and by["hook_text"] == "pass" and by["watermark"] == "pass" and by["loop"] == "pass"
    assert by["pacing"] == "warn"  # a 6 s shot inside the first 10 s
    assert 0 <= rep["score"] <= 100 and rep["postingTips"]


def test_report_flags_what_instagram_does_not_recommend():
    tl = _timeline(watermark=Watermark(logo_key="logo.png"))
    rep = instagram.build_report(tl, _clips(), audio_mode="none", brief="", cta_text="", post_copy=None,
                                 render=(720, 1280, 300_000, 10.0), preview=False)
    by = {c["id"]: c["status"] for c in rep["checks"]}
    assert by["watermark"] == "fail" and by["sound"] == "fail"
    assert by["sharp"] == "warn" and by["resolution"] == "warn"
    assert by["hook_text"] == "warn" and by["send_prompt"] == "warn" and by["hashtags"] == "warn"
    assert rep["score"] <= instagram.BLOCKED_SCORE and rep["blocked"]
    assert rep["verdict"].startswith("Not recommended")


def test_director_gets_instagram_rules():
    from app.ai.reel_director import build_request
    from app.director.music_map import build_music_map

    audio = make_audio(duration=40)
    clips = [make_clip("c1"), make_clip("c2", sig_bin=4)]
    mm = build_music_map(audio, 0.0, 15.0)
    kw = dict(brief="", language="en", style_hint=None, captions=False, cta="", hook="", pace="balanced")
    facts, _ = build_request(clips, audio, mm, 0.0, 15.0, {"cinematic": "x"}, platform_rules=instagram.DIRECTOR_RULES, **kw)
    assert facts["platform"]["name"] == "instagram" and facts["platform"]["rules"]
    plain, _ = build_request(clips, audio, mm, 0.0, 15.0, {"cinematic": "x"}, **kw)
    assert "platform" not in plain


# ------------------------------------------------------------------ real renders
def _pixel(path, t: float, crop: str) -> tuple[int, int, int]:
    import subprocess

    from app.core.ffmpeg import find_binary

    r = subprocess.run([find_binary("ffmpeg"), "-v", "error", "-ss", f"{t:.2f}", "-i", str(path), "-frames:v", "1",
                        "-vf", f"crop={crop},scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                       capture_output=True, timeout=60)  # fmt: skip
    return tuple(r.stdout[:3])  # type: ignore[return-value]


@pytest.mark.slow
def test_instagram_reel_end_to_end(media_dir, storage):
    import shutil

    from app.core.ffmpeg import find_binary
    from app.jobs.pipeline import MediaRef, PipelineInput, render_edl, run_pipeline
    from app.storage import project_key

    pid = "igproj"
    videos = []
    for i, n in enumerate(["clip_a.mp4", "clip_b.mp4", "clip_c.mp4", "clip_d.mp4"]):
        key = project_key(pid, "input", n)
        shutil.copy(media_dir / n, storage.new_local_path(key))
        videos.append(MediaRef(id=f"v{i}", name=n, key=key))
    akey = project_key(pid, "input", "beat120.mp3")
    shutil.copy(media_dir / "beat120.mp3", storage.new_local_path(akey))
    settings = ProjectSettings(duration=10, style="cinematic", platform="instagram", hook_text="Watch the last shot",
                               brief="Abstract patterns for a design moodboard.")  # fmt: skip
    inp = PipelineInput(project_id=pid, job_type="generate", videos=videos, audio=MediaRef(id="a", name="beat120.mp3", key=akey),
                        settings=settings, rendering_id="r1", project_name="Pattern study")  # fmt: skip
    res = run_pipeline(inp, storage, lambda *_: None)

    tl = res.timeline
    assert tl.segments[0].length <= instagram.HOOK_CUT + 0.01
    assert tl.overlays[0].role == "hook" and tl.overlays[0].start == 0.0
    rep = res.reel_plan["instagram"]
    assert {c["id"] for c in rep["checks"]} >= {"first_cut", "hook_text", "resolution", "sharp", "watermark", "hashtags"}
    assert next(c for c in rep["checks"] if c["id"] == "resolution")["status"] == "pass"
    assert res.post_copy["source"] == "template" and res.post_copy["sendPrompt"]

    # a brand logo added later is rendered on the closing seconds only
    logo = storage.new_local_path(project_key(pid, "input", "logo.png"))
    import subprocess

    subprocess.run([find_binary("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=200x200", "-frames:v", "1", str(logo)], check=True)
    tl.watermark = Watermark(logo_key=project_key(pid, "input", "logo.png"), opacity=1.0)
    render, key = render_edl(PipelineInput(**{**inp.__dict__, "rendering_id": "r2"}), tl, res.clips, storage, lambda *_: None)
    crop = "120:120:880:1470"  # inside the bottom-right logo box (172 px wide at 1080 x 1920)
    early, late = _pixel(render.path, 1.0, crop), _pixel(render.path, tl.duration - 0.5, crop)
    assert late[0] > 200 and late[1] < 60 and late[2] < 60, late
    assert early != late
