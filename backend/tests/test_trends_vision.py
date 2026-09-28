"""Phases 11-12: vision interface and Trend Mode."""

from __future__ import annotations

import pytest

from app.ai.vision import (
    FrameAnnotation, FrameRef, NullVisionAnalyzer, VisionAnalyzer, apply_annotations, get_vision_analyzer,
    set_vision_analyzer,
)  # fmt: skip
from app.core.errors import ValidationFailed
from app.schemas.project import ProjectSettings
from app.styles import get_style
from app.styles.resolve import resolve_style
from app.trends.base import TrendPreset, TrendSource, apply_trend
from app.trends.manual import PRESETS, ManualTrendSource, get_trend_source, set_trend_source
from app.video.cropper import Focus, MotionAwareCrop, FaceAwareCrop, SmartCrop
from app.video.timeline import build_timeline
from tests.test_timeline import make_audio, make_clip

# ------------------------------------------------------------------ vision
def test_default_vision_analyzer_is_a_no_op():
    a = get_vision_analyzer()
    assert isinstance(a, NullVisionAnalyzer)
    assert a.analyze_frames([]) == []


class FakeVision(VisionAnalyzer):
    name = "fake"

    def analyze_frames(self, frames):
        return [FrameAnnotation(f.clip_id, f.time, people=1, subject_box=(0.7, 0.2, 0.2, 0.4), importance=1.0) for f in frames]


def test_vision_annotations_refine_windows_and_crop():
    from pathlib import Path

    clip = make_clip("c", dur=6)
    win = clip.analysis.windows[0]
    before_q = win.quality
    set_vision_analyzer(FakeVision())
    try:
        anns = get_vision_analyzer().analyze_frames([FrameRef("c", 1.0, Path("f.jpg")), FrameRef("c", 2.0, Path("g.jpg"))])
    finally:
        set_vision_analyzer(None)
    assert apply_annotations(clip.analysis, anns) == 1
    assert win.focus_source == "subject" and win.focus_x == pytest.approx(0.8) and win.focus_y == pytest.approx(0.4)
    assert win.quality > before_q  # important moments are preferred

    # the crop follows the subject at full strength (not damped like raw motion)
    subject = Focus(win.focus_x, win.focus_y, "subject")
    motion = Focus(win.focus_x, win.focus_y, "motion")
    s = SmartCrop().compute(1920, 1080, 9 / 16, subject)
    m = SmartCrop().compute(1920, 1080, 9 / 16, motion)
    assert s.x > m.x and FaceAwareCrop().compute(1920, 1080, 9 / 16, subject).x == s.x
    assert MotionAwareCrop().compute(1920, 1080, 9 / 16, subject).x == s.x


def test_annotations_for_other_clips_are_ignored():
    clip = make_clip("c", dur=6)
    assert apply_annotations(clip.analysis, [FrameAnnotation("other", 1.0, subject_box=(0, 0, 1, 1))]) == 0
    assert clip.analysis.windows[0].focus_source == "center"


# ------------------------------------------------------------------ trends
def test_presets_match_the_spec_shape():
    p = next(t for t in PRESETS if t.id == "fast_luxury_product")
    assert p.to_doc() == {
        "id": "fast_luxury_product", "trendName": "Fast Luxury Product Reel", "recommendedDuration": 15,
        "cutFrequency": "fast", "transitionStyle": "smooth", "captionStyle": "minimal",
        "description": p.description,
    }  # fmt: skip
    assert len({t.id for t in PRESETS}) == len(PRESETS)


def test_apply_trend_overrides_pacing_and_feel():
    base = get_style("fast_trending")
    slow = apply_trend(base, TrendPreset(id="x", trend_name="x", recommended_duration=30, cut_frequency="slow",
                                         transition_style="smooth", caption_style="luxury"))  # fmt: skip
    assert (slow.cut_beats_high, slow.cut_beats_low) == (4, 8) and slow.min_segment >= 1.5
    assert "dissolve" in slow.transitions and slow.transition_duration > 0.3 and slow.caption_style == "luxury"
    punchy = apply_trend(get_style("cinematic"), next(t for t in PRESETS if t.id == "beat_drop_hype"))
    assert punchy.cut_beats_high == 1 and "flash" in punchy.transitions
    assert get_style("cinematic").cut_beats_high == 4  # the registered style is not mutated


def test_trend_changes_the_generated_timeline():
    clips = [make_clip(f"c{i}", sig_bin=i * 4) for i in range(5)]
    audio = make_audio()
    plain = resolve_style(ProjectSettings(style="luxury"))
    fast = resolve_style(ProjectSettings(style="luxury", trend_id="beat_drop_hype"))
    n_plain = len(build_timeline(audio, clips, 15, plain, seed=1).segments)
    n_fast = len(build_timeline(audio, clips, 15, fast, seed=1).segments)
    assert n_fast > 2 * n_plain


def test_unknown_trend_is_rejected():
    with pytest.raises(ValidationFailed) as e:
        resolve_style(ProjectSettings(trend_id="nope"))
    assert e.value.code == "UNKNOWN_TREND"


def test_trend_source_is_pluggable():
    class Api(TrendSource):
        def list_trends(self):
            return [TrendPreset(id="from_api", trend_name="From API", recommended_duration=20, cut_frequency="medium",
                                transition_style="punchy")]  # fmt: skip

    set_trend_source(Api())
    try:
        assert get_trend_source().get("from_api").trend_name == "From API"
        assert resolve_style(ProjectSettings(trend_id="from_api")).cut_beats_high == 2
    finally:
        set_trend_source(None)
    assert isinstance(get_trend_source(), ManualTrendSource)


async def test_trends_api_and_project_validation(client):
    trends = (await client.get("/api/trends")).json()
    assert {t["id"] for t in trends} >= {"fast_luxury_product", "cinematic_story"}
    assert all(k in trends[0] for k in ("trendName", "recommendedDuration", "cutFrequency", "transitionStyle", "captionStyle"))
    ok = await client.post("/api/projects", json={"name": "t", "settings": {"trendId": "quick_recipe"}})
    assert ok.status_code == 201 and ok.json()["settings"]["trendId"] == "quick_recipe"
    bad = await client.post("/api/projects", json={"name": "t", "settings": {"trendId": "nope"}})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNKNOWN_TREND"
    pid = ok.json()["id"]
    bad2 = await client.patch(f"/api/projects/{pid}", json={"trendId": "nope"})
    assert bad2.status_code == 422
    bad3 = await client.post(f"/api/projects/{pid}/generate", json={"trendId": "nope"})
    assert bad3.status_code in (422,)
