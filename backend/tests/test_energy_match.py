"""The picture follows the song's energy: quick cuts in loud parts, longer shots in calm parts, and beat-reactive
effects that pulse on the strong hits between cuts."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ai.reel_director import ReelDirectorPlan, clip_facts
from app.director.ai_plan import plan_to_timeline
from app.director.music_map import build_music_map, loud_limit, song_hits
from app.director.review import energy_check
from app.models.timeline import Segment, Timeline
from app.styles import get_style, list_styles
from app.video import effects
from app.video.cutter import RenderConfig, SegmentPlan, SourceClip, build_filter_graph, look_filters, plan_segments, zoom_expression
from tests.test_timeline import make_audio, make_clip

STYLES = {s.id for s in list_styles() if s.id not in ("custom", "auto")}


def _direct(shots, clips, audio, duration, pace="balanced"):
    mm = build_music_map(audio, 0.0, duration)
    _, alias = clip_facts(clips)
    plan = ReelDirectorPlan.model_validate({"style": "cinematic", "grade": "warm", "shots": shots})
    return plan_to_timeline(plan, alias, clips, mm, 0.0, duration, get_style("cinematic"), style_ids=STYLES, keep_style=True, pace=pace), mm


# ---------------------------------------------------------------------- the music side
def test_loud_parts_of_the_song_limit_the_shot_length_by_pace():
    mm = build_music_map(make_audio(duration=30, loud_from=15.0), 0.0, 30.0)
    assert loud_limit(mm, 2.0, 8.0) is None  # calm music: long shots are right
    level, lim = loud_limit(mm, 18.0, 24.0)
    assert level in ("high", "very_high") and lim <= 3.0
    assert loud_limit(mm, 18.0, 24.0, "calm")[1] > lim > loud_limit(mm, 18.0, 24.0, "fast")[1]


def test_every_strong_hit_is_kept_once():
    audio = make_audio(duration=10, accents=[(1.02, 0.9), (1.05, 0.9), (3.3, 0.3), (7.7, 0.8)])
    hits = song_hits(audio)
    assert 3.3 not in hits and 7.7 in hits  # weak accents are not hits
    assert all(b - a >= 0.08 - 1e-9 for a, b in zip(hits, hits[1:]))  # two hits a few ms apart are one hit


# ---------------------------------------------------------------------- the AI plan follows the energy
def test_a_long_shot_in_a_loud_part_is_cut_on_the_beat_with_fresh_footage():
    audio = make_audio(duration=40, loud_from=10.0)
    clips = [make_clip(f"id{i}", dur=12.0, sig_bin=i) for i in range(5)]
    shots = [{"clip": "c1", "source_start": 0.5, "source_end": 5.5, "duration": 5.0},
             {"clip": "c2", "source_start": 0.5, "source_end": 5.5, "duration": 5.0},
             {"clip": "c3", "source_start": 0.5, "source_end": 6.0, "duration": 5.0},  # 10-15 s: loud music
             {"clip": "c4", "source_start": 0.5, "source_end": 6.0, "duration": 5.0}]  # fmt: skip
    d, mm = _direct(shots, clips, audio, 20.0)
    segs = d.timeline.segments
    assert len(segs) > 4
    assert energy_check(d.timeline, mm, "balanced").ok
    loud = [s for s in segs if s.timeline_start >= 10.0 - 1e-6]
    assert all(s.length <= 3.0 * 1.15 + 1e-6 for s in loud)
    assert all(abs(s.timeline_start - min(mm.snap_points, key=lambda p: abs(p - s.timeline_start))) < 1e-3 for s in segs[1:])  # on beats
    assert any("the music is" in c for row in d.log for c in row["changes"])
    assert any("in a high part" in p or "in a very high part" in p for p in d.problems)  # the AI's revision round learns it
    assert all(s.speed == pytest.approx(1.0) for s in segs)


def test_a_calm_pace_keeps_long_shots_in_loud_music():
    audio = make_audio(duration=40, loud_from=0.0)
    clips = [make_clip(f"id{i}", dur=12.0, sig_bin=i) for i in range(4)]
    shots = [{"clip": f"c{i + 1}", "source_start": 0.5, "source_end": 4.5, "duration": 4.0} for i in range(3)]
    d, mm = _direct(shots, clips, audio, 12.0, pace="calm")
    assert len(d.timeline.segments) == 3 and d.pace == "calm"  # the user asked for calm: no extra cuts
    assert energy_check(d.timeline, mm, "calm").ok


def test_with_no_footage_left_a_long_loud_shot_pulses_on_every_hit():
    audio = make_audio(duration=40, loud_from=0.0)
    clips = [make_clip("id0", dur=5.0), make_clip("id1", dur=5.0, sig_bin=3)]
    shots = [{"clip": "c1", "source_start": 0.0, "source_end": 5.0, "duration": 5.0},
             {"clip": "c2", "source_start": 0.0, "source_end": 5.0, "duration": 5.0}]  # fmt: skip
    d, _ = _direct(shots, clips, audio, 10.0)
    assert {s.effect for s in d.timeline.segments} == {"beat_punch"}
    assert all(any("pulses on every hit" in c for c in row["changes"]) for row in d.log)


# ---------------------------------------------------------------------- the renderer
def test_beat_reactive_effects_follow_the_hits_inside_each_shot():
    segs = [Segment(clip_id="a", video="a", source_start=0, source_end=2, timeline_start=0, timeline_end=2, effect="beat_punch"),
            Segment(clip_id="a", video="a", source_start=2, source_end=4, timeline_start=2, timeline_end=4, effect="zoom_pulse")]
    plans = plan_segments(segs, [0.0, 0.5, 1.99, 2.5, 3.25, 9.0])
    assert plans[0].hits == (0.5,) and plans[1].hits == (0.5, 1.25)  # the cut itself and hits at the very edge are left out
    z = zoom_expression("beat_punch", 2.0, plans[0].hits)
    assert "gte(t,0.500)" in z
    assert "sin(" in zoom_expression("zoom_pulse", 2.0)  # no music: a steady pulse, as before
    assert "gte(t,0.500)" in look_filters("beat_flash", (0.5,))[0]
    assert look_filters("beat_flash") == look_filters("flash")  # no music: one flash at the start
    g = build_filter_graph(segs[1], SourceClip(Path("x.mp4"), 1920, 1080), plans[1], RenderConfig(framing="fill"))
    assert "gte(t,1.250)" in g


def test_the_beat_effects_are_offered_to_the_ai():
    cat = effects.catalogue()
    assert {"beat_punch", "beat_flash", "zoom_pulse"} <= set(cat)
    assert effects.resolve_effect("punch on beat")[0] in ("beat_punch", "punch")


def test_the_renderer_uses_the_playing_part_of_the_song():
    tl = Timeline(duration=2.0, audio_start=10.0, music_hits=[10.5, 30.0],
                  segments=[Segment(clip_id="a", video="a", source_start=0, source_end=2, timeline_start=0, timeline_end=2, effect="beat_punch")])
    hits = [h - tl.audio_start for h in tl.music_hits]
    assert plan_segments(tl.segments, hits)[0].hits == (0.5,)
    assert SegmentPlan(length=1.0, tail=0.0, ramp=False).hits == ()  # older plans: no hits
